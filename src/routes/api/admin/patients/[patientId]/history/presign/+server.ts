import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireRole } from '$lib/server/authz';
import { aiConfig, isAIFeatureEnabled } from '$lib/server/config/ai';
import { createPresignedHistoryUpload, getHistoryUploadLimitBytes } from '$lib/server/storage/s3';
import { badRequest, created, forbidden, notFound, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const requestSchema = z.object({
	fileName: z.string().trim().min(1).max(255),
	mimeType: z.string().trim().min(1).max(255),
	byteSize: z.number().int().positive()
});

const ALLOWED_MIME_TYPES = new Set([
	'application/pdf',
	'text/csv',
	'application/csv',
	'application/vnd.ms-excel'
]);

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

		const body = requestSchema.parse(await event.request.json());
		const normalizedMimeType = body.mimeType.toLowerCase();
		const lowerName = body.fileName.toLowerCase();
		const isPdf = normalizedMimeType.includes('pdf') || lowerName.endsWith('.pdf');
		const isCsv = normalizedMimeType.includes('csv') || lowerName.endsWith('.csv');

		if (!isPdf && !isCsv && !ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
			return badRequest('Only PDF and CSV files are supported.');
		}

		const maxBytes = getHistoryUploadLimitBytes();
		if (body.byteSize > maxBytes) {
			return badRequest(`File exceeds upload limit of ${Math.round(maxBytes / (1024 * 1024))}MB.`);
		}

		const patient = await db.query.user.findFirst({
			where: (table, { eq }) => eq(table.id, patientId),
			columns: { id: true, role: true }
		});

		if (!patient || patient.role !== 'patient') {
			return notFound('Patient account was not found.');
		}

		const upload = await createPresignedHistoryUpload({
			patientId,
			fileName: body.fileName,
			mimeType: normalizedMimeType,
			byteSize: body.byteSize
		});

		return created({
			uploadUrl: upload.uploadUrl,
			key: upload.key,
			expiresIn: upload.expiresIn,
			maxUploadBytes: maxBytes,
			deidentifyMode: aiConfig.deidentifyMode
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid upload request payload.', error.flatten());
		}

		logError('Failed to create presigned upload URL', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to prepare upload URL right now.');
	}
};
