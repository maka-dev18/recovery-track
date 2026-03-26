import { parse as parseCsv } from 'csv-parse/sync';
import { generateObject } from 'ai';
import { eq } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { getRiskModel } from '$lib/server/ai/provider';
import { db } from '$lib/server/db';
import { patientHistoryFile, patientHistorySignal } from '$lib/server/db/schema';
import { syncPatientRecoveryProfile } from '$lib/server/recovery-profile';
import { recalculatePatientRisk } from '$lib/server/risk';
import { getS3ObjectBytes } from '$lib/server/storage/s3';
import { logError, logInfo, logWarn } from '$lib/server/utils/log';

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function parseNumeric(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return null;
}

function parseDateCandidate(record: Record<string, unknown>): Date | null {
	const dateKeys = ['date', 'timestamp', 'created_at', 'recorded_at', 'occurred_at'];

	for (const key of dateKeys) {
		const value = record[key];
		if (typeof value !== 'string' || value.trim() === '') continue;
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}

	return null;
}

function scoreHistoricalRecord(record: Record<string, unknown>): number {
	const mood = parseNumeric(record.mood);
	const craving = parseNumeric(record.craving);
	const stress = parseNumeric(record.stress);
	const sleepHours = parseNumeric(record.sleepHours ?? record.sleep_hours);
	const explicitScore = parseNumeric(record.riskScore ?? record.risk_score ?? record.score);

	if (explicitScore !== null) {
		return clamp(Math.round(explicitScore), 0, 100);
	}

	let score = 0;
	if (mood !== null) score += clamp((5 - mood) * 10, 0, 40);
	if (craving !== null) score += clamp(craving * 4, 0, 40);
	if (stress !== null) score += clamp(stress * 2.5, 0, 25);
	if (sleepHours !== null) score += clamp((8 - sleepHours) * 3, 0, 24);

	return clamp(Math.round(score), 0, 100);
}

function extractSignalsFromCsvText(
	csvText: string
): Array<{ signalType: string; signalValue: Record<string, unknown>; confidence: number; occurredAt: Date | null }> {
	const rows = parseCsv(csvText, {
		columns: true,
		skip_empty_lines: true,
		trim: true,
		relax_column_count: true
	}) as Array<Record<string, unknown>>;

	return rows.slice(0, 500).map((row) => {
		const riskWeight = scoreHistoricalRecord(row);
		const occurredAt = parseDateCandidate(row);

		return {
			signalType: 'historical_record',
			signalValue: {
				riskWeight,
				source: 'csv',
				row
			},
			confidence: 80,
			occurredAt
		};
	});
}

const pdfSignalSchema = z.object({
	summary: z.string().max(1000),
	baselineRisk: z.number().int().min(0).max(100),
	warningSignals: z.array(
		z.object({
			label: z.string().min(1).max(80),
			severity: z.number().int().min(0).max(100),
			note: z.string().max(300).optional()
		})
	)
});

async function extractSignalsFromPdfText(
	pdfText: string
): Promise<Array<{ signalType: string; signalValue: Record<string, unknown>; confidence: number; occurredAt: Date | null }>> {
	const compactText = pdfText.replace(/\s+/g, ' ').trim().slice(0, 18_000);
	const deidentified = deidentifyText(compactText);

	const fallbackSignals = [
		{
			signalType: 'history_summary',
			signalValue: {
				riskWeight: inferTextRiskWeight(deidentified),
				source: 'pdf_fallback',
				summary: deidentified.slice(0, 600)
			},
			confidence: 45,
			occurredAt: null
		}
	];

	if (!deidentified) {
		return fallbackSignals;
	}

	try {
		const result = await generateObject({
			model: getRiskModel(),
			schema: pdfSignalSchema,
			system:
				'You analyze historical rehabilitation notes. Return objective JSON with risk baseline and warning signals only.',
			prompt: [
				'Extract clinically relevant risk signals from this rehabilitation history.',
				'Focus on relapse indicators, adherence, crisis patterns, and protective factors.',
				'Input:',
				deidentified
			].join('\n\n')
		});

		const parsed = result.object;
		const signals: Array<{
			signalType: string;
			signalValue: Record<string, unknown>;
			confidence: number;
			occurredAt: Date | null;
		}> = [
			{
				signalType: 'history_summary',
				signalValue: {
					riskWeight: parsed.baselineRisk,
					source: 'pdf_ai',
					summary: parsed.summary
				},
				confidence: 75,
				occurredAt: null
			}
		];

		for (const warning of parsed.warningSignals.slice(0, 12)) {
			signals.push({
				signalType: 'warning_signal',
				signalValue: {
					label: warning.label,
					riskWeight: warning.severity,
					note: warning.note ?? null,
					source: 'pdf_ai'
				},
				confidence: 70,
				occurredAt: null
			});
		}

		return signals;
	} catch (error) {
		logWarn('PDF AI extraction failed, using heuristic fallback', {
			error: error instanceof Error ? error.message : String(error)
		});
		return fallbackSignals;
	}
}

function inferTextRiskWeight(text: string): number {
	const lowered = text.toLowerCase();
	const rules: Array<{ pattern: RegExp; points: number }> = [
		{ pattern: /relapse|reuse|using again|recurrence/g, points: 18 },
		{ pattern: /overdose|self harm|suicid|unsafe/g, points: 28 },
		{ pattern: /missed session|noncompliant|dropout/g, points: 10 },
		{ pattern: /support network|stable housing|adherent|improving/g, points: -8 }
	];

	let score = 35;
	for (const rule of rules) {
		const matches = lowered.match(rule.pattern)?.length ?? 0;
		score += matches * rule.points;
	}

	return clamp(score, 0, 100);
}

async function parsePdfBuffer(buffer: Buffer) {
	const parser = new PDFParse({ data: buffer });
	try {
		const result = await parser.getText();
		return result.text;
	} finally {
		await parser.destroy();
	}
}

export async function processHistoryFile(fileId: string) {
	const historyFile = await db.query.patientHistoryFile.findFirst({
		where: (table, { eq }) => eq(table.id, fileId)
	});

	if (!historyFile) {
		logWarn('History file missing for parse job', { fileId });
		return;
	}

	await db
		.update(patientHistoryFile)
		.set({ parseStatus: 'parsing', parseError: null })
		.where(eq(patientHistoryFile.id, fileId));

	try {
		const objectBytes = await getS3ObjectBytes(historyFile.s3Key);
		const isCsv = historyFile.mimeType.includes('csv') || historyFile.fileName.toLowerCase().endsWith('.csv');
		const isPdf =
			historyFile.mimeType.includes('pdf') || historyFile.fileName.toLowerCase().endsWith('.pdf');

		let signals: Array<{
			signalType: string;
			signalValue: Record<string, unknown>;
			confidence: number;
			occurredAt: Date | null;
		}> = [];

		if (isCsv) {
			signals = extractSignalsFromCsvText(objectBytes.toString('utf8'));
		} else if (isPdf) {
			const pdfText = await parsePdfBuffer(objectBytes);
			signals = await extractSignalsFromPdfText(pdfText);
		} else {
			throw new Error(`Unsupported history file type: ${historyFile.mimeType}`);
		}

		await db.delete(patientHistorySignal).where(eq(patientHistorySignal.fileId, fileId));

		if (signals.length > 0) {
			await db.insert(patientHistorySignal).values(
				signals.map((signal) => ({
					id: crypto.randomUUID(),
					patientId: historyFile.patientId,
					fileId,
					signalType: signal.signalType,
					signalValueJson: JSON.stringify(signal.signalValue),
					confidence: clamp(Math.round(signal.confidence), 0, 100),
					occurredAt: signal.occurredAt
				}))
			);
		}

		await db
			.update(patientHistoryFile)
			.set({
				parseStatus: 'parsed',
				parseError: null,
				parsedAt: new Date()
			})
			.where(eq(patientHistoryFile.id, fileId));

		await recalculatePatientRisk({
			patientId: historyFile.patientId,
			source: 'history',
			triggeredByUserId: historyFile.uploadedByUserId
		});
		await syncPatientRecoveryProfile(historyFile.patientId);

		logInfo('History file parsed successfully', {
			fileId,
			patientId: historyFile.patientId,
			signalCount: signals.length
		});
	} catch (error) {
		const parseError = error instanceof Error ? error.message : String(error);
		await db
			.update(patientHistoryFile)
			.set({
				parseStatus: 'failed',
				parseError: parseError.slice(0, 1_000)
			})
			.where(eq(patientHistoryFile.id, fileId));

		logError('History file parsing failed', {
			fileId,
			patientId: historyFile.patientId,
			error: parseError
		});

		throw error;
	}
}
