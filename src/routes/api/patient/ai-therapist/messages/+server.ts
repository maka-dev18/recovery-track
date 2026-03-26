import { and, eq } from 'drizzle-orm';
import { stepCountIs, streamText } from 'ai';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { getTextModel } from '$lib/server/ai/provider';
import { buildPatientAiTherapistSystemPrompt } from '$lib/server/ai-therapist';
import { buildPatientContextTools } from '$lib/server/ai-therapist-tools';
import { aiConfig, isAIFeatureEnabled } from '$lib/server/config/ai';
import { requireRole } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { aiMessage, aiSession } from '$lib/server/db/schema';
import { analyzeConversationRisk, recalculatePatientRisk } from '$lib/server/risk';
import { badRequest, forbidden, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';
import { virtualTherapistProfile } from '$lib/shared/virtual-therapist';

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

export const POST: RequestHandler = async (event) => {
	try {
		const patientUser = requireRole(event, 'patient');
		if (!isAIFeatureEnabled('chat')) {
			return forbidden(`${virtualTherapistProfile.name} chat is currently disabled.`);
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

		const modelMessages = historicalMessages.map((message) => ({
			role:
				message.role === 'assistant'
					? ('assistant' as const)
					: message.role === 'system'
						? ('system' as const)
						: ('user' as const),
			content: deidentifyText(message.content).slice(0, 1_200)
		}));
		const systemPrompt = await buildPatientAiTherapistSystemPrompt({
			patientId: patientUser.id,
			patientName: patientUser.name,
			channel: 'text',
			hasAssistantHistory: historicalMessages.some((message) => message.role === 'assistant')
		});

		let assistantOutput = '';
		const result = streamText({
			model: getTextModel(),
			system: systemPrompt,
			messages: modelMessages,
			tools: buildPatientContextTools(patientUser.id),
			stopWhen: stepCountIs(5),
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
