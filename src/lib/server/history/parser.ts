import { generateObject } from 'ai';
import { eq } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { getRiskModel } from '$lib/server/ai/provider';
import { db } from '$lib/server/db';
import { patientHistoryFile, patientHistorySignal } from '$lib/server/db/schema';
import {
	clamp,
	extractSignalsFromCsvText,
	inferTextRiskWeight,
	type HistorySignalCandidate
} from '$lib/server/history/parser-core';
import { syncPatientRecoveryProfile } from '$lib/server/recovery-profile';
import { recalculatePatientRisk } from '$lib/server/risk';
import { getS3ObjectBytes } from '$lib/server/storage/s3';
import { logError, logInfo, logWarn } from '$lib/server/utils/log';

const pdfSignalSchema = z.object({
	summary: z.string().max(1000),
	journeySummary: z.string().max(1000),
	baselineRisk: z.number().int().min(0).max(100),
	mainTriggers: z.array(z.string().min(1).max(80)).max(8),
	returnPatterns: z.array(z.string().min(1).max(140)).max(6),
	protectiveFactors: z.array(z.string().min(1).max(80)).max(8),
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
): Promise<HistorySignalCandidate[]> {
	const compactText = pdfText.replace(/\s+/g, ' ').trim().slice(0, 18_000);
	if (!compactText) {
		throw new Error('PDF history file did not contain readable text.');
	}

	const deidentified = deidentifyText(compactText);
	if (!deidentified) {
		throw new Error('PDF history file could not be converted into usable clinical text.');
	}

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

	try {
		const result = await generateObject({
			model: getRiskModel(),
			schema: pdfSignalSchema,
			system:
				'You analyze historical rehabilitation notes. Return objective JSON with a concise rehab journey summary, relapse triggers, return-to-use patterns, protective factors, baseline risk, and warning signals only.',
			prompt: [
				'Extract clinically relevant risk signals from this rehabilitation history.',
				'Focus on relapse indicators, adherence, crisis patterns, repeated triggers, and protective factors.',
				'Input:',
				deidentified
			].join('\n\n')
		});

		const parsed = result.object;
		const signals: HistorySignalCandidate[] = [
			{
				signalType: 'history_summary',
				signalValue: {
					riskWeight: parsed.baselineRisk,
					source: 'pdf_ai',
					summary: parsed.summary
				},
				confidence: 75,
				occurredAt: null
			},
			{
				signalType: 'rehab_journey',
				signalValue: {
					source: 'pdf_ai',
					summary: parsed.journeySummary
				},
				confidence: 72,
				occurredAt: null
			}
		];

		for (const trigger of parsed.mainTriggers.slice(0, 8)) {
			signals.push({
				signalType: 'relapse_trigger',
				signalValue: {
					label: trigger,
					source: 'pdf_ai'
				},
				confidence: 72,
				occurredAt: null
			});
		}

		for (const pattern of parsed.returnPatterns.slice(0, 6)) {
			signals.push({
				signalType: 'return_pattern',
				signalValue: {
					summary: pattern,
					source: 'pdf_ai'
				},
				confidence: 72,
				occurredAt: null
			});
		}

		for (const protective of parsed.protectiveFactors.slice(0, 8)) {
			signals.push({
				signalType: 'protective_factor',
				signalValue: {
					label: protective,
					source: 'pdf_ai'
				},
				confidence: 72,
				occurredAt: null
			});
		}

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
		.set({ parseStatus: 'parsing', parseError: null, parsedAt: null })
		.where(eq(patientHistoryFile.id, fileId));

	try {
		const objectBytes = await getS3ObjectBytes(historyFile.s3Key);
		const isCsv = historyFile.mimeType.includes('csv') || historyFile.fileName.toLowerCase().endsWith('.csv');
		const isPdf =
			historyFile.mimeType.includes('pdf') || historyFile.fileName.toLowerCase().endsWith('.pdf');

		let signals: HistorySignalCandidate[] = [];

		if (isCsv) {
			signals = extractSignalsFromCsvText(objectBytes.toString('utf8'));
		} else if (isPdf) {
			const pdfText = await parsePdfBuffer(objectBytes);
			signals = await extractSignalsFromPdfText(pdfText);
		} else {
			throw new Error(`Unsupported history file type: ${historyFile.mimeType}`);
		}

		if (signals.length === 0) {
			throw new Error('History file did not produce any usable clinical signals.');
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

		await recalculatePatientRisk({
			patientId: historyFile.patientId,
			source: 'history',
			triggeredByUserId: historyFile.uploadedByUserId
		});
		await syncPatientRecoveryProfile(historyFile.patientId);

		await db
			.update(patientHistoryFile)
			.set({
				parseStatus: 'parsed',
				parseError: null,
				parsedAt: new Date()
			})
			.where(eq(patientHistoryFile.id, fileId));

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
				parseError: parseError.slice(0, 1_000),
				parsedAt: null
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
