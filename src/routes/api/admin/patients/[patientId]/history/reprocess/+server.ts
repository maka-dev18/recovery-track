import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import { isAIFeatureEnabled } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { patientHistoryFile } from '$lib/server/db/schema';
import { enqueueJob } from '$lib/server/jobs/queue';
import { badRequest, created, forbidden, notFound, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const requestSchema = z.object({
	fileId: z.string().uuid()
});

export const POST: RequestHandler = async (event) => {
	try {
		requireRole(event, 'admin');
		if (!isAIFeatureEnabled('historyIngest')) {
			return forbidden('Historical rehab ingestion is currently disabled.');
		}

		const patientId = event.params.patientId;
		if (!patientId) {
			return badRequest('Missing patient identifier.');
		}

		const payload = requestSchema.parse(await event.request.json());
		const historyFile = await db.query.patientHistoryFile.findFirst({
			where: and(eq(patientHistoryFile.id, payload.fileId), eq(patientHistoryFile.patientId, patientId))
		});

		if (!historyFile) {
			return notFound('History file was not found for this patient.');
		}

		await db
			.update(patientHistoryFile)
			.set({
				parseStatus: 'pending',
				parseError: null
			})
			.where(eq(patientHistoryFile.id, historyFile.id));

		const jobId = await enqueueJob({
			type: 'history.parse',
			payload: { fileId: historyFile.id }
		});

		return created({
			fileId: historyFile.id,
			jobId,
			message: 'File reprocessing has been queued.'
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid reprocess payload.', error.flatten());
		}

		logError('Failed to queue file reprocess', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to queue reprocessing right now.');
	}
};
