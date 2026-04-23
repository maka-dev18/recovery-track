import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import { isAIFeatureEnabled } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { patientHistoryFile } from '$lib/server/db/schema';
import { enqueueJob } from '$lib/server/jobs/queue';
import { processHistoryParseJob } from '$lib/server/jobs/processor';
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
				parseError: null,
				extractionJson: '{}',
				extractedAt: null,
				parsedAt: null
			})
			.where(eq(patientHistoryFile.id, historyFile.id));

		const jobId = await enqueueJob({
			type: 'history.parse',
			payload: { fileId: historyFile.id }
		});
		const jobResult = await processHistoryParseJob(jobId, historyFile.id);
		const processResult = {
			processed: jobResult.status === 'done' ? 1 : 0,
			failed: jobResult.status === 'failed' ? 1 : 0,
			retry: jobResult.status === 'retry' ? 1 : 0,
			attempts: jobResult.attempts,
			retryAt: jobResult.retryAt
		};

		return created({
			fileId: historyFile.id,
			jobId,
			processResult,
			message:
				processResult.processed > 0
					? 'File reprocessed and extracted.'
					: processResult.retry > 0
						? `File reprocessing hit a temporary error. The next retry is scheduled for ${processResult.retryAt?.toLocaleString()}.`
						: processResult.failed > 0
							? 'File reprocessing failed after the retry limit. Check the run details for the parser error.'
					: 'File reprocessing has been queued.'
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
