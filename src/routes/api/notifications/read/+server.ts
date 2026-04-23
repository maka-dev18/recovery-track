import type { RequestHandler } from './$types';
import { requireSession } from '$lib/server/authz';
import { markUserNotificationsRead } from '$lib/server/notifications';
import { ok, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

export const POST: RequestHandler = async (event) => {
	try {
		const user = requireSession(event);
		await markUserNotificationsRead(user.id);
		return ok({ success: true });
	} catch (error) {
		rethrowControlFlowError(error);
		logError('Mark notifications read failed', {
			error: error instanceof Error ? error.message : String(error)
		});
		return serverError('Unable to update notifications.');
	}
};
