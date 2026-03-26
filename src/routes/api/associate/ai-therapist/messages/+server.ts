import { and, asc, desc, eq } from 'drizzle-orm';
import { streamText } from 'ai';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { summarizeCheckins, summarizeHistorySignals } from '$lib/server/ai-therapist';
import { getTextModel } from '$lib/server/ai/provider';
import { requireRole } from '$lib/server/authz';
import { aiConfig, isAIFeatureEnabled } from '$lib/server/config/ai';
import { appendAssociateAiMessage, findAssociateAiThread } from '$lib/server/care-team';
import { db } from '$lib/server/db';
import { conversationMessage, patientCheckin, patientHistorySignal, user } from '$lib/server/db/schema';
import { analyzeTextIntoPatientSignal } from '$lib/server/patient-signals';
import { getPatientPersonalizationContext } from '$lib/server/recovery-profile';
import { recalculatePatientRisk } from '$lib/server/risk';
import { badRequest, forbidden, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';
import { getPreferredName, virtualTherapistProfile } from '$lib/shared/virtual-therapist';

const requestSchema = z.object({
	patientId: z.string().uuid(),
	text: z.string().trim().min(1).max(4_000)
});

export const POST: RequestHandler = async (event) => {
	try {
		const associateUser = requireRole(event, 'associate');
		if (!isAIFeatureEnabled('chat')) {
			return forbidden(`${virtualTherapistProfile.name} support chat is currently disabled.`);
		}

		if (!aiConfig.googleApiKey) {
			return serverError('AI provider is not configured.');
		}

		const payload = requestSchema.parse(await event.request.json());
		if (payload.text.length > aiConfig.maxMessageChars) {
			return badRequest(`Message exceeds max length (${aiConfig.maxMessageChars} characters).`);
		}

		const patientRecord = await db.query.user.findFirst({
			where: and(eq(user.id, payload.patientId), eq(user.role, 'patient')),
			columns: {
				id: true,
				name: true
			}
		});

		if (!patientRecord) {
			return badRequest('Selected patient account was not found.');
		}

		const associateMessage = await appendAssociateAiMessage({
			associateId: associateUser.id,
			patientId: payload.patientId,
			role: 'associate',
			content: payload.text,
			senderUserId: associateUser.id,
			metadataJson: JSON.stringify({
				author: 'associate',
				patientName: patientRecord.name
			})
		});

		const thread = await findAssociateAiThread(associateUser.id, payload.patientId);
		if (!thread) {
			throw new Error('Associate AI thread was not created.');
		}

		const historicalMessages = await db.query.conversationMessage.findMany({
			where: eq(conversationMessage.threadId, thread.id),
			orderBy: (table, { asc: orderAsc }) => [orderAsc(table.occurredAt), orderAsc(table.createdAt)],
			limit: 30
		});
		const recentCheckins = await db.query.patientCheckin.findMany({
			where: eq(patientCheckin.patientId, payload.patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 6
		});
		const recentHistorySignals = await db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, payload.patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 8
		});
		const personalizationContext = await getPatientPersonalizationContext(payload.patientId);
		const patientPreferredName = getPreferredName(patientRecord.name);

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
				`You are ${virtualTherapistProfile.name}, a recovery-support assistant speaking with a patient associate or guardian.`,
				`The patient is ${patientRecord.name}. You already know ${patientPreferredName}'s recovery history and should speak as someone who understands their context.`,
				'Help the associate report daily habits, sleep, diet, mood changes, relapse warning signs, and protective factors.',
				'Encourage escalation to the therapist for medium or high-risk concerns. Be concrete and concise.',
				`Patient context:\n${personalizationContext}`,
				`Recent patient self-check-ins:\n${summarizeCheckins(recentCheckins)}`,
				`Historical rehab context:\n${summarizeHistorySignals(recentHistorySignals)}`
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

					await appendAssociateAiMessage({
						associateId: associateUser.id,
						patientId: payload.patientId,
						role: 'assistant',
						content: assistantOutput,
						metadataJson: JSON.stringify({
							patientName: patientRecord.name
						})
					});

					await analyzeTextIntoPatientSignal({
						patientId: payload.patientId,
						text: payload.text,
						source: 'conversation',
						originLabel: 'Associate AI report',
						threadId: thread.id,
						messageId: associateMessage.messageId,
						detectedByUserId: associateUser.id,
						extraPayload: {
							channel: 'associate_ai',
							associateId: associateUser.id
						}
					});

					await recalculatePatientRisk({
						patientId: payload.patientId,
						source: 'chat',
						triggeredByUserId: associateUser.id
					});
				} catch (finishError) {
					logError('Associate AI post-response processing failed', {
						error: finishError instanceof Error ? finishError.message : String(finishError),
						patientId: payload.patientId,
						associateId: associateUser.id
					});
				}
			},
			onError(streamError) {
				logError('Associate AI streaming error', {
					error: streamError.error instanceof Error ? streamError.error.message : String(streamError.error),
					patientId: payload.patientId,
					associateId: associateUser.id
				});
			}
		});

		return result.toTextStreamResponse({
			headers: {
				'x-conversation-thread-id': thread.id
			}
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid associate AI request payload.', error.flatten());
		}

		logError('Associate AI chat request failed', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to process associate AI chat right now.');
	}
};
