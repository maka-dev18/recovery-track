import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import { isAIFeatureEnabled } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { aiMessage, aiSession } from '$lib/server/db/schema';
import { analyzeConversationRisk, recalculatePatientRisk } from '$lib/server/risk';
import { badRequest, created, forbidden, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError, logInfo } from '$lib/server/utils/log';

const eventSchema = z.object({
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string().trim().min(1).max(4_000),
	modality: z.enum(['text', 'voice']).default('voice'),
	occurredAt: z.string().datetime().optional()
});

const requestSchema = z.object({
	sessionId: z.string().uuid().optional(),
	events: z.array(eventSchema).min(1).max(20)
});

async function getOrCreateLiveSession(patientId: string, sessionId?: string) {
	if (sessionId) {
		const existing = await db.query.aiSession.findFirst({
			where: and(eq(aiSession.id, sessionId), eq(aiSession.patientId, patientId), eq(aiSession.mode, 'live_voice'))
		});

		if (existing) {
			return existing;
		}
	}

	const id = crypto.randomUUID();
	await db.insert(aiSession).values({
		id,
		patientId,
		mode: 'live_voice',
		status: 'active'
	});

	const createdSession = await db.query.aiSession.findFirst({
		where: eq(aiSession.id, id)
	});

	if (!createdSession) {
		throw new Error('Unable to create live voice session.');
	}

	return createdSession;
}

export const POST: RequestHandler = async (event) => {
	try {
		const patientUser = requireRole(event, 'patient');
		if (!isAIFeatureEnabled('liveVoice')) {
			return forbidden('Live voice therapist sessions are currently disabled.');
		}

		const payload = requestSchema.parse(await event.request.json());
		const session = await getOrCreateLiveSession(patientUser.id, payload.sessionId);
		logInfo('Live events received', {
			patientId: patientUser.id,
			sessionId: session.id,
			eventCount: payload.events.length,
			userEvents: payload.events.filter((entry) => entry.role === 'user').length
		});

		await db.insert(aiMessage).values(
			payload.events.map((entry) => ({
				id: crypto.randomUUID(),
				sessionId: session.id,
				role: entry.role,
				content: entry.content,
				modality: entry.modality,
				createdAt: entry.occurredAt ? new Date(entry.occurredAt) : new Date()
			}))
		);

		const combinedUserText = payload.events
			.filter((entry) => entry.role === 'user')
			.map((entry) => entry.content)
			.join('\n')
			.trim();

		if (combinedUserText) {
			await analyzeConversationRisk({
				patientId: patientUser.id,
				sessionId: session.id,
				text: combinedUserText,
				triggeredByUserId: patientUser.id
			});

			await recalculatePatientRisk({
				patientId: patientUser.id,
				source: 'chat',
				triggeredByUserId: patientUser.id
			});
		}

		return created({
			sessionId: session.id,
			storedEvents: payload.events.length
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid live event payload.', error.flatten());
		}

		logError('Failed to store live events', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});
		return serverError('Unable to store live events right now.');
	}
};
