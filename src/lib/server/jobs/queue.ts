import { and, eq, inArray, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { jobQueue } from '$lib/server/db/schema';

export type QueueJobType = 'history.parse';
export type QueueJobStatus = 'pending' | 'running' | 'retry' | 'done' | 'failed';

export type QueueJob<TPayload = unknown> = {
	id: string;
	type: QueueJobType;
	payload: TPayload;
	status: QueueJobStatus;
	attempts: number;
	runAfter: Date;
};

export const HISTORY_PARSE_MAX_ATTEMPTS = 4;

const RATE_LIMIT_RETRY_DELAYS_MS = [120_000, 300_000, 600_000, 1_200_000];
const DEFAULT_RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 600_000];

function serializePayload(payload: unknown): string {
	return JSON.stringify(payload ?? {});
}

function deserializePayload<TPayload>(payloadJson: string): TPayload {
	return JSON.parse(payloadJson) as TPayload;
}

export async function enqueueJob<TPayload>(args: {
	type: QueueJobType;
	payload: TPayload;
	runAfter?: Date;
}) {
	const id = crypto.randomUUID();
	await db.insert(jobQueue).values({
		id,
		type: args.type,
		payloadJson: serializePayload(args.payload),
		status: 'pending',
		runAfter: args.runAfter ?? new Date()
	});

	return id;
}

export async function claimNextJob(): Promise<QueueJob | null> {
	const now = new Date();
	const next = await db.query.jobQueue.findFirst({
		where: and(inArray(jobQueue.status, ['pending', 'retry']), lte(jobQueue.runAfter, now)),
		orderBy: (table, { asc }) => [asc(table.runAfter), asc(table.createdAt)]
	});

	if (!next) {
		return null;
	}

	await db
		.update(jobQueue)
		.set({
			status: 'running',
			attempts: next.attempts + 1,
			updatedAt: new Date()
		})
		.where(eq(jobQueue.id, next.id));

	return {
		id: next.id,
		type: next.type as QueueJobType,
		payload: deserializePayload(next.payloadJson),
		status: 'running',
		attempts: next.attempts + 1,
		runAfter: next.runAfter
	};
}

export async function claimJobById(jobId: string): Promise<QueueJob | null> {
	const job = await db.query.jobQueue.findFirst({
		where: and(eq(jobQueue.id, jobId), inArray(jobQueue.status, ['pending', 'retry']))
	});

	if (!job) {
		return null;
	}

	await db
		.update(jobQueue)
		.set({
			status: 'running',
			attempts: job.attempts + 1,
			updatedAt: new Date()
		})
		.where(eq(jobQueue.id, job.id));

	return {
		id: job.id,
		type: job.type as QueueJobType,
		payload: deserializePayload(job.payloadJson),
		status: 'running',
		attempts: job.attempts + 1,
		runAfter: job.runAfter
	};
}

export async function completeJob(jobId: string) {
	await db
		.update(jobQueue)
		.set({
			status: 'done',
			lastError: null,
			updatedAt: new Date()
		})
		.where(eq(jobQueue.id, jobId));
}

export function isRateLimitError(message: string) {
	return /(rate.?limit|quota|429|resource exhausted|too many requests)/i.test(message);
}

export function shouldRetryJob(attempts: number) {
	return attempts < HISTORY_PARSE_MAX_ATTEMPTS;
}

export function getRetryRunAfter(attempts: number, message: string) {
	const delays = isRateLimitError(message) ? RATE_LIMIT_RETRY_DELAYS_MS : DEFAULT_RETRY_DELAYS_MS;
	const delay = delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)];
	return new Date(Date.now() + delay);
}

export async function failJob(
	jobId: string,
	message: string,
	options?: { retry?: boolean; runAfter?: Date }
) {
	await db
		.update(jobQueue)
		.set({
			status: options?.retry ? 'retry' : 'failed',
			lastError: message,
			runAfter: options?.retry ? (options.runAfter ?? new Date(Date.now() + 30_000)) : new Date(),
			updatedAt: new Date()
		})
		.where(eq(jobQueue.id, jobId));
}

export async function getRecentJobs(limit = 25) {
	const rows = await db.query.jobQueue.findMany({
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit
	});

	return rows.map((row) => ({
		id: row.id,
		type: row.type,
		status: row.status,
		attempts: row.attempts,
		runAfter: row.runAfter,
		lastError: row.lastError,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		payload: deserializePayload(row.payloadJson)
	}));
}
