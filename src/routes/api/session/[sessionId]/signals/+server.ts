import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import {
	appendSessionSignal,
	getAccessibleTherapySession,
	listSessionSignals
} from '$lib/server/session-calls';
import {
	badRequest,
	created,
	forbidden,
	ok,
	rethrowControlFlowError,
	serverError
} from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const postSchema = z.object({
	signalType: z.enum(['offer', 'answer', 'ice', 'hangup', 'ready']),
	payload: z.record(z.string(), z.unknown()).default({})
});

function parseSince(value: string | null): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET: RequestHandler = async (event) => {
	try {
		const user = requireRole(event, ['patient', 'therapist']);
		const sessionId = event.params.sessionId;
		if (!sessionId) {
			return badRequest('Missing therapy session identifier.');
		}

		const session = await getAccessibleTherapySession(sessionId, user.id);
		if (!session) {
			return forbidden('You do not have access to this therapy session.');
		}

		const signals = await listSessionSignals({
			sessionId,
			since: parseSince(event.url.searchParams.get('since')),
			excludeUserId: user.id
		});

		return ok({ signals });
	} catch (error) {
		rethrowControlFlowError(error);

		logError('Failed to fetch therapy session signals', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});
		return serverError('Unable to load therapy session signals.');
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const user = requireRole(event, ['patient', 'therapist']);
		const sessionId = event.params.sessionId;
		if (!sessionId) {
			return badRequest('Missing therapy session identifier.');
		}

		const session = await getAccessibleTherapySession(sessionId, user.id);
		if (!session) {
			return forbidden('You do not have access to this therapy session.');
		}

		const payload = postSchema.parse(await event.request.json());
		const signalId = await appendSessionSignal({
			sessionId,
			senderUserId: user.id,
			signalType: payload.signalType,
			payload: payload.payload
		});

		return created({ signalId });
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid therapy session signal payload.', error.flatten());
		}

		logError('Failed to create therapy session signal', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});
		return serverError('Unable to send therapy session signal.');
	}
};
