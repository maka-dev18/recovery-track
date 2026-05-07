import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireRole } from '$lib/server/authz';
import { isAIFeatureEnabled } from '$lib/server/config/ai';
import {
	buildHistoryObjectKey,
	getHistoryUploadLimitBytes,
	uploadHistoryObject
} from '$lib/server/storage/s3';
import {
	badRequest,
	created,
	forbidden,
	notFound,
	rethrowControlFlowError,
	serverError
} from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const metadataSchema = z.object({
	fileName: z.string().trim().min(1).max(255),
	mimeType: z.string().trim().min(1).max(255)
});

const ALLOWED_MIME_TYPES = new Set([
	'application/pdf',
	'text/csv',
	'application/csv',
	'application/vnd.ms-excel'
]);

function isSupportedHistoryFile(fileName: string, mimeType: string) {
	const normalizedMimeType = mimeType.toLowerCase();
	const lowerName = fileName.toLowerCase();
	const isPdf = normalizedMimeType.includes('pdf') || lowerName.endsWith('.pdf');
	const isCsv = normalizedMimeType.includes('csv') || lowerName.endsWith('.csv');

	return isPdf || isCsv || ALLOWED_MIME_TYPES.has(normalizedMimeType);
}

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

		const patient = await db.query.user.findFirst({
			where: (table, { eq }) => eq(table.id, patientId),
			columns: { id: true, role: true }
		});

		if (!patient || patient.role !== 'patient') {
			return notFound('Patient account was not found.');
		}

		const formData = await event.request.formData();
		const uploadedFile = formData.get('file');
		const rawFileName = formData.get('fileName');
		const rawMimeType = formData.get('mimeType');

		if (!(uploadedFile instanceof File)) {
			return badRequest('Missing upload file.');
		}

		const metadata = metadataSchema.parse({
			fileName: typeof rawFileName === 'string' ? rawFileName : uploadedFile.name,
			mimeType: typeof rawMimeType === 'string' ? rawMimeType : uploadedFile.type || 'application/octet-stream'
		});
		const normalizedMimeType = metadata.mimeType.toLowerCase();

		if (!isSupportedHistoryFile(metadata.fileName, normalizedMimeType)) {
			return badRequest('Only PDF and CSV files are supported.');
		}

		const byteSize = uploadedFile.size;
		const maxBytes = getHistoryUploadLimitBytes();
		if (byteSize <= 0) {
			return badRequest('Uploaded file is empty.');
		}

		if (byteSize > maxBytes) {
			return badRequest(`File exceeds upload limit of ${Math.round(maxBytes / (1024 * 1024))}MB.`);
		}

		const key = buildHistoryObjectKey(patientId, metadata.fileName);
		const bytes = new Uint8Array(await uploadedFile.arrayBuffer());

		await uploadHistoryObject({
			key,
			body: bytes,
			mimeType: normalizedMimeType,
			byteSize
		});

		return created({
			key,
			fileName: metadata.fileName,
			mimeType: normalizedMimeType,
			byteSize
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid upload payload.', error.flatten());
		}

		logError('Failed to upload history file', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to upload the file right now.');
	}
};
