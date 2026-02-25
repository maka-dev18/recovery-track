import { z } from 'zod';
import type { RequestHandler } from './$types';
import { aiConfig } from '$lib/server/config/ai';
import { processQueuedJobs } from '$lib/server/jobs/processor';
import { badRequest, forbidden, ok, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const requestSchema = z.object({
	maxJobs: z.number().int().min(1).max(25).optional()
});

function hasInternalAccess(request: Request): boolean {
	if (!aiConfig.internalCronSecret) {
		return true;
	}

	const providedSecret = request.headers.get('x-internal-cron-secret') ?? '';
	if (providedSecret && providedSecret === aiConfig.internalCronSecret) {
		return true;
	}

	if (request.headers.has('x-vercel-cron')) {
		return true;
	}

	return false;
}

export const GET: RequestHandler = async (event) => {
	try {
		if (!hasInternalAccess(event.request)) {
			return forbidden('Invalid internal auth token.');
		}

		const maxJobsValue = event.url.searchParams.get('maxJobs');
		const parsed = requestSchema.parse({
			maxJobs: maxJobsValue ? Number.parseInt(maxJobsValue, 10) : undefined
		});

		const result = await processQueuedJobs(parsed.maxJobs ?? 5);
		return ok(result);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return badRequest('Invalid maxJobs query value.', error.flatten());
		}

		logError('Queue processor GET failed', {
			error: error instanceof Error ? error.message : String(error)
		});
		return serverError('Queue processing failed.');
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		if (!hasInternalAccess(event.request)) {
			return forbidden('Invalid internal auth token.');
		}

		const payload =
			event.request.headers.get('content-type')?.includes('application/json') === true
				? await event.request.json()
				: {};
		const parsed = requestSchema.parse(payload);
		const result = await processQueuedJobs(parsed.maxJobs ?? 5);
		return ok(result);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return badRequest('Invalid queue process payload.', error.flatten());
		}

		logError('Queue processor POST failed', {
			error: error instanceof Error ? error.message : String(error)
		});
		return serverError('Queue processing failed.');
	}
};
