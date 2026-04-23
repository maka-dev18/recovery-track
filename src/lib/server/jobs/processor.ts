import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { patientHistoryFile } from '$lib/server/db/schema';
import { processHistoryFile } from '$lib/server/history/parser';
import {
	claimJobById,
	claimNextJob,
	completeJob,
	failJob,
	getRetryRunAfter,
	shouldRetryJob
} from '$lib/server/jobs/queue';
import { logError, logInfo } from '$lib/server/utils/log';

type HistoryParseJobResult =
	| { status: 'done'; attempts: number; retryAt: null }
	| { status: 'retry'; attempts: number; retryAt: Date; error: string }
	| { status: 'failed'; attempts: number; retryAt: null; error: string };

async function markHistoryFileRetrying(fileId: string, message: string) {
	await db
		.update(patientHistoryFile)
		.set({
			parseStatus: 'retry',
			parseError: message.slice(0, 1_000),
			parsedAt: null
		})
		.where(eq(patientHistoryFile.id, fileId));
}

async function handleJobFailure(job: { id: string; attempts: number }, fileId: string, message: string) {
	const errorMessage = message.slice(0, 1_000);
	const retry = shouldRetryJob(job.attempts);
	const retryAt = retry ? getRetryRunAfter(job.attempts, message) : undefined;
	await failJob(job.id, errorMessage, { retry, runAfter: retryAt });

	if (retry && retryAt) {
		await markHistoryFileRetrying(fileId, errorMessage);
	}

	return { retry, retryAt };
}

export async function processHistoryParseJob(
	jobId: string,
	fileId: string
): Promise<HistoryParseJobResult> {
	const job = await claimJobById(jobId);
	if (!job) {
		throw new Error('History parse job is not available for processing.');
	}

	try {
		await processHistoryFile(fileId);
		await completeJob(job.id);
		return { status: 'done', attempts: job.attempts, retryAt: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const { retry, retryAt } = await handleJobFailure(job, fileId, message);

		logError('History parse job failed', {
			jobId: job.id,
			fileId,
			attempts: job.attempts,
			willRetry: retry,
			retryAt,
			error: message
		});

		if (retry && retryAt) {
			return { status: 'retry', attempts: job.attempts, retryAt, error: message };
		}

		return { status: 'failed', attempts: job.attempts, retryAt: null, error: message };
	}
}

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
			const fileId =
				job.type === 'history.parse' ? (job.payload as { fileId?: string }).fileId : undefined;
			const { retry, retryAt } = fileId
				? await handleJobFailure(job, fileId, message)
				: {
						retry: shouldRetryJob(job.attempts),
						retryAt: shouldRetryJob(job.attempts) ? getRetryRunAfter(job.attempts, message) : undefined
					};
			if (!fileId) {
				await failJob(job.id, message.slice(0, 1_000), { retry, runAfter: retryAt });
			}
			failed += 1;

			logError('Queue job failed', {
				jobId: job.id,
				type: job.type,
				attempts: job.attempts,
				willRetry: retry,
				retryAt,
				error: message
			});
		}
	}

	logInfo('Queue processor run completed', { processed, failed, maxJobs });
	return { processed, failed };
}
