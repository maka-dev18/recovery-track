import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { ZodType } from 'zod';

export function ok(data: unknown, init?: ResponseInit) {
	return json(data, { status: 200, ...init });
}

export function created(data: unknown, init?: ResponseInit) {
	return json(data, { status: 201, ...init });
}

export function badRequest(message: string, details?: unknown) {
	return json({ message, details }, { status: 400 });
}

export function forbidden(message = 'Forbidden') {
	return json({ message }, { status: 403 });
}

export function unauthorized(message = 'Unauthorized') {
	return json({ message }, { status: 401 });
}

export function notFound(message = 'Not found') {
	return json({ message }, { status: 404 });
}

export function serverError(message = 'Internal server error', details?: unknown) {
	return json({ message, details }, { status: 500 });
}

export function rethrowControlFlowError(error: unknown): void {
	if (isRedirect(error) || isHttpError(error)) {
		throw error;
	}
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
	const raw = await request.json();
	return schema.parse(raw);
}
