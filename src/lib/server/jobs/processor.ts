import { processHistoryFile } from '$lib/server/history/parser';
import { claimNextJob, completeJob, failJob } from '$lib/server/jobs/queue';
import { logError, logInfo } from '$lib/server/utils/log';

export async function processQueuedJobs(maxJobs = 5) {
	let processed = 0;
	let failed = 0;

	for (let index = 0; index < maxJobs; index += 1) {
		const job = await claimNextJob();
		if (!job) {
			break;
		}

		try {
			if (job.type === 'history.parse') {
				const payload = job.payload as { fileId?: string };
				if (!payload.fileId) {
					throw new Error('Missing fileId in history.parse payload');
				}

				await processHistoryFile(payload.fileId);
			} else {
				throw new Error(`Unsupported job type: ${job.type}`);
			}

			await completeJob(job.id);
			processed += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const shouldRetry = job.attempts < 5;
			await failJob(job.id, message.slice(0, 1_000), { retry: shouldRetry });
			failed += 1;

			logError('Queue job failed', {
				jobId: job.id,
				type: job.type,
				attempts: job.attempts,
				willRetry: shouldRetry,
				error: message
			});
		}
	}

	logInfo('Queue processor run completed', { processed, failed, maxJobs });
	return { processed, failed };
}
