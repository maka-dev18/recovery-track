import { and, eq } from 'drizzle-orm';
import { streamText } from 'ai';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { getTextModel } from '$lib/server/ai/provider';
import { aiConfig, isAIFeatureEnabled } from '$lib/server/config/ai';
import { requireRole } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { aiMessage, aiSession, patientCheckin, patientHistorySignal } from '$lib/server/db/schema';
import { analyzeConversationRisk, recalculatePatientRisk } from '$lib/server/risk';
import { badRequest, forbidden, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const requestSchema = z.object({
	sessionId: z.string().uuid().optional(),
	text: z.string().trim().min(1).max(4_000)
});

async function getOrCreateTextSession(patientId: string, sessionId?: string) {
	if (sessionId) {
		const existing = await db.query.aiSession.findFirst({
			where: and(eq(aiSession.id, sessionId), eq(aiSession.patientId, patientId), eq(aiSession.mode, 'text'))
		});

		if (existing) {
			return existing;
		}
	}

	const id = crypto.randomUUID();
	await db.insert(aiSession).values({
		id,
		patientId,
		mode: 'text',
		status: 'active'
	});

	const created = await db.query.aiSession.findFirst({
		where: eq(aiSession.id, id)
	});

	if (!created) {
		throw new Error('Unable to create chat session.');
	}

	return created;
}

function summarizeCheckins(
	checkins: Array<{
		mood: number;
		craving: number;
		stress: number;
		sleepHours: number;
		note: string | null;
		createdAt: Date;
	}>
): string {
	if (checkins.length === 0) {
		return 'No recent check-ins available.';
	}

	return checkins
		.map((checkin) => {
			const note = checkin.note ? ` note=${deidentifyText(checkin.note).slice(0, 120)}` : '';
			return `${checkin.createdAt.toISOString()}: mood=${checkin.mood}, craving=${checkin.craving}, stress=${checkin.stress}, sleep=${checkin.sleepHours}${note}`;
		})
		.join('\n');
}

function summarizeHistorySignals(
	historySignals: Array<{ signalType: string; signalValueJson: string; confidence: number; createdAt: Date }>
): string {
	if (historySignals.length === 0) {
		return 'No historical rehabilitation signals parsed yet.';
	}

	return historySignals
		.map((signal) => {
			let riskWeight = 'n/a';
			let excerpt = '';
			try {
				const parsed = JSON.parse(signal.signalValueJson) as { riskWeight?: unknown; summary?: unknown; label?: unknown };
				if (typeof parsed.riskWeight === 'number') {
					riskWeight = String(Math.round(parsed.riskWeight));
				}

				if (typeof parsed.summary === 'string') {
					excerpt = parsed.summary.slice(0, 120);
				} else if (typeof parsed.label === 'string') {
					excerpt = parsed.label.slice(0, 80);
				}
			} catch {
				excerpt = '';
			}

			return `${signal.createdAt.toISOString()}: ${signal.signalType} riskWeight=${riskWeight} confidence=${signal.confidence}${excerpt ? ` summary=${deidentifyText(excerpt)}` : ''}`;
		})
		.join('\n');
}

export const POST: RequestHandler = async (event) => {
	try {
		const patientUser = requireRole(event, 'patient');
		if (!isAIFeatureEnabled('chat')) {
			return forbidden('AI therapist chat is currently disabled.');
		}

		if (!aiConfig.googleApiKey) {
			return serverError('AI provider is not configured.');
		}

		const payload = requestSchema.parse(await event.request.json());
		if (payload.text.length > aiConfig.maxMessageChars) {
			return badRequest(`Message exceeds max length (${aiConfig.maxMessageChars} characters).`);
		}

		const session = await getOrCreateTextSession(patientUser.id, payload.sessionId);
		const userMessageId = crypto.randomUUID();
		await db.insert(aiMessage).values({
			id: userMessageId,
			sessionId: session.id,
			role: 'user',
			content: payload.text,
			modality: 'text'
		});

		const historicalMessages = await db.query.aiMessage.findMany({
			where: eq(aiMessage.sessionId, session.id),
			orderBy: (table, { asc }) => [asc(table.createdAt)],
			limit: 30
		});

		const recentCheckins = await db.query.patientCheckin.findMany({
			where: eq(patientCheckin.patientId, patientUser.id),
			orderBy: (table, { desc }) => [desc(table.createdAt)],
			limit: 6
		});

		const recentHistorySignals = await db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, patientUser.id),
			orderBy: (table, { desc }) => [desc(table.createdAt)],
			limit: 10
		});

		const modelMessages = historicalMessages.map((message) => ({
			role:
				message.role === 'assistant'
					? ('assistant' as const)
					: message.role === 'system'
						? ('system' as const)
						: ('user' as const),
			content: deidentifyText(message.content).slice(0, 1_200)
		}));

		let assistantOutput = '';
		const result = streamText({
			model: getTextModel(),
			system: [
				'You are an AI therapist assistant for recovery support.',
				'Use motivational interviewing style and avoid medical diagnosis claims.',
				'If high-risk intent is expressed, urge immediate human support and emergency services when needed.',
				`Recent check-in summary:\n${summarizeCheckins(recentCheckins)}`,
				`Historical rehab signal summary:\n${summarizeHistorySignals(recentHistorySignals)}`
			].join('\n\n'),
			messages: modelMessages,
			onChunk(eventChunk) {
				if (eventChunk.chunk.type === 'text-delta') {
					assistantOutput += eventChunk.chunk.text;
				}
			},
			onFinish: async () => {
				try {
					if (!assistantOutput.trim()) {
						return;
					}

					await db.insert(aiMessage).values({
						id: crypto.randomUUID(),
						sessionId: session.id,
						role: 'assistant',
						content: assistantOutput,
						modality: 'text'
					});

					await analyzeConversationRisk({
						patientId: patientUser.id,
						sessionId: session.id,
						text: payload.text,
						triggeredByUserId: patientUser.id
					});

					await recalculatePatientRisk({
						patientId: patientUser.id,
						source: 'chat',
						triggeredByUserId: patientUser.id
					});
				} catch (finishError) {
					logError('Post-response chat processing failed', {
						error: finishError instanceof Error ? finishError.message : String(finishError),
						patientId: patientUser.id,
						sessionId: session.id
					});
				}
			},
			onError(streamError) {
				logError('AI streaming error in patient chat', {
					error: streamError.error instanceof Error ? streamError.error.message : String(streamError.error),
					patientId: patientUser.id,
					sessionId: session.id
				});
			}
		});

		return result.toTextStreamResponse({
			headers: {
				'x-ai-session-id': session.id
			}
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid chat request payload.', error.flatten());
		}

		logError('Patient chat request failed', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to process chat message right now.');
	}
};
