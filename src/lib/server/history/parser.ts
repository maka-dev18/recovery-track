import { generateObject } from 'ai';
import { GoogleGenAI } from '@google/genai';
import { eq } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { getRiskModel } from '$lib/server/ai/provider';
import { aiConfig, requireGoogleApiKey } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { patientHistoryFile, patientHistorySignal } from '$lib/server/db/schema';
import {
	clamp,
	extractSignalsFromCsvText,
	inferTextRiskWeight,
	type HistorySignalCandidate
} from '$lib/server/history/parser-core';
import { isRateLimitError } from '$lib/server/jobs/queue';
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

const geminiHistoryExtractionSchema = z.object({
	summary: z.string().min(1).max(1000),
	journeySummary: z.string().min(1).max(1200),
	baselineRisk: z.number().int().min(0).max(100),
	recoveryStage: z.string().max(80).optional().nullable(),
	goals: z.array(z.string().min(1).max(120)).max(10).default([]),
	mainTriggers: z.array(z.string().min(1).max(100)).max(12).default([]),
	returnPatterns: z.array(z.string().min(1).max(180)).max(10).default([]),
	protectiveFactors: z.array(z.string().min(1).max(120)).max(12).default([]),
	warningSignals: z
		.array(
			z.object({
				label: z.string().min(1).max(100),
				severity: z.number().int().min(0).max(100),
				note: z.string().max(400).optional().nullable()
			})
		)
		.max(16)
		.default([]),
	timeline: z
		.array(
			z.object({
				date: z.string().max(40).optional().nullable(),
				event: z.string().min(1).max(240),
				riskWeight: z.number().int().min(0).max(100).optional().nullable()
			})
		)
		.max(25)
		.default([]),
	rawExtractedFacts: z.array(z.string().min(1).max(240)).max(30).default([])
});

type GeminiHistoryExtraction = z.infer<typeof geminiHistoryExtractionSchema>;
const GEMINI_FILE_POLL_INTERVAL_MS = 1_000;
const GEMINI_FILE_POLL_ATTEMPTS = 30;

function parseGeminiJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) {
		throw new Error('Gemini returned an empty extraction response.');
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ?? trimmed.match(/(\{[\s\S]*\})/);
		if (!match?.[1]) {
			throw new Error('Gemini extraction response was not valid JSON.');
		}

		return JSON.parse(match[1]);
	}
}

function parseFlexibleDate(value: string | null | undefined) {
	if (!value) {
		return null;
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function signalsFromGeminiExtraction(extraction: GeminiHistoryExtraction): HistorySignalCandidate[] {
	const signals: HistorySignalCandidate[] = [
		{
			signalType: 'history_summary',
			signalValue: {
				riskWeight: extraction.baselineRisk,
				source: 'gemini_file',
				summary: extraction.summary
			},
			confidence: 82,
			occurredAt: null
		},
		{
			signalType: 'rehab_journey',
			signalValue: {
				source: 'gemini_file',
				summary: extraction.journeySummary,
				recoveryStage: extraction.recoveryStage ?? null,
				goals: extraction.goals
			},
			confidence: 80,
			occurredAt: null
		}
	];

	for (const trigger of extraction.mainTriggers) {
		signals.push({
			signalType: 'relapse_trigger',
			signalValue: {
				label: trigger,
				source: 'gemini_file'
			},
			confidence: 78,
			occurredAt: null
		});
	}

	for (const pattern of extraction.returnPatterns) {
		signals.push({
			signalType: 'return_pattern',
			signalValue: {
				summary: pattern,
				source: 'gemini_file'
			},
			confidence: 78,
			occurredAt: null
		});
	}

	for (const protective of extraction.protectiveFactors) {
		signals.push({
			signalType: 'protective_factor',
			signalValue: {
				label: protective,
				source: 'gemini_file'
			},
			confidence: 78,
			occurredAt: null
		});
	}

	for (const warning of extraction.warningSignals) {
		signals.push({
			signalType: 'warning_signal',
			signalValue: {
				label: warning.label,
				riskWeight: warning.severity,
				note: warning.note ?? null,
				source: 'gemini_file'
			},
			confidence: 76,
			occurredAt: null
		});
	}

	for (const event of extraction.timeline) {
		signals.push({
			signalType: 'historical_record',
			signalValue: {
				riskWeight: event.riskWeight ?? extraction.baselineRisk,
				source: 'gemini_file',
				row: {
					date: event.date ?? null,
					event: event.event
				}
			},
			confidence: 72,
			occurredAt: parseFlexibleDate(event.date)
		});
	}

	return signals;
}

async function extractHistoryWithGeminiFile(args: {
	fileName: string;
	mimeType: string;
	bytes: Buffer;
}): Promise<{
	extraction: GeminiHistoryExtraction;
	signals: HistorySignalCandidate[];
	geminiFileName: string | null;
	geminiFileUri: string | null;
	model: string;
}> {
	const client = new GoogleGenAI({ apiKey: requireGoogleApiKey() });
	const blob = new Blob([new Uint8Array(args.bytes)], { type: args.mimeType });
	const uploadedFile = await client.files.upload({
		file: blob,
		config: {
			mimeType: args.mimeType,
			displayName: args.fileName
		}
	});

	if (!uploadedFile.uri) {
		throw new Error('Gemini file upload did not return a usable file URI.');
	}

	if (uploadedFile.name) {
		let fileState = uploadedFile.state ?? null;

		for (let attempt = 0; attempt < GEMINI_FILE_POLL_ATTEMPTS; attempt += 1) {
			if (fileState && fileState !== 'PROCESSING') {
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, GEMINI_FILE_POLL_INTERVAL_MS));
			const refreshedFile = await client.files.get({ name: uploadedFile.name });
			fileState = refreshedFile.state ?? null;
		}

		if (fileState === 'FAILED') {
			throw new Error('Gemini file processing failed before extraction started.');
		}

		if (fileState === 'PROCESSING') {
			throw new Error('Gemini file processing timed out before extraction started.');
		}
	}

	const response = await client.models.generateContent({
		model: aiConfig.riskModel,
		contents: [
			{
				role: 'user',
				parts: [
					{
						text: [
							'Extract structured historical rehabilitation data from the attached patient history file.',
							'Return objective JSON only. Focus on relapse indicators, warning signs, return-to-use patterns, protective factors, baseline risk, and dated events.',
							'Do not invent facts. If a field is unknown, use an empty array or null where appropriate.'
						].join('\n')
					},
					{
						fileData: {
							fileUri: uploadedFile.uri,
							mimeType: uploadedFile.mimeType ?? args.mimeType
						}
					}
				]
			}
		],
		config: {
			responseMimeType: 'application/json',
			temperature: 0.1,
			maxOutputTokens: 8192
		}
	});

	const extraction = geminiHistoryExtractionSchema.parse(parseGeminiJson(response.text ?? ''));
	return {
		extraction,
		signals: signalsFromGeminiExtraction(extraction),
		geminiFileName: uploadedFile.name ?? null,
		geminiFileUri: uploadedFile.uri ?? null,
		model: aiConfig.riskModel
	};
}

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
		.set({ parseStatus: 'parsing', parseError: null, parsedAt: null, extractedAt: null })
		.where(eq(patientHistoryFile.id, fileId));

	try {
		const objectBytes = await getS3ObjectBytes(historyFile.s3Key);
		const isCsv = historyFile.mimeType.includes('csv') || historyFile.fileName.toLowerCase().endsWith('.csv');
		const isPdf =
			historyFile.mimeType.includes('pdf') || historyFile.fileName.toLowerCase().endsWith('.pdf');

		let signals: HistorySignalCandidate[] = [];
		let extractionJson = '{}';
		let geminiFileName: string | null = null;
		let geminiFileUri: string | null = null;
		let extractionModel: string | null = null;

		if (!isCsv && !isPdf) {
			throw new Error(`Unsupported history file type: ${historyFile.mimeType}`);
		}

		if (isCsv) {
			signals = extractSignalsFromCsvText(objectBytes.toString('utf8'));
			extractionJson = JSON.stringify({
				summary: 'CSV history file parsed locally.',
				signalCount: signals.length
			});
			extractionModel = 'local-csv';
		} else {
			try {
				const geminiResult = await extractHistoryWithGeminiFile({
					fileName: historyFile.fileName,
					mimeType: historyFile.mimeType,
					bytes: objectBytes
				});
				signals = geminiResult.signals;
				extractionJson = JSON.stringify(geminiResult.extraction);
				geminiFileName = geminiResult.geminiFileName;
				geminiFileUri = geminiResult.geminiFileUri;
				extractionModel = geminiResult.model;
			} catch (error) {
				const extractionError = error instanceof Error ? error.message : String(error);
				if (isRateLimitError(extractionError)) {
					throw error;
				}

				logWarn('Gemini file extraction failed, using local history parser fallback', {
					error: extractionError,
					fileId
				});

				const pdfText = await parsePdfBuffer(objectBytes);
				signals = await extractSignalsFromPdfText(pdfText);
				extractionJson = JSON.stringify({
					summary: 'Gemini file extraction failed. Local fallback parser was used.',
					error: extractionError,
					signalCount: signals.length
				});
				extractionModel = 'local-fallback';
			}
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
				geminiFileName,
				geminiFileUri,
				extractionModel,
				extractionJson,
				extractedAt: new Date(),
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
