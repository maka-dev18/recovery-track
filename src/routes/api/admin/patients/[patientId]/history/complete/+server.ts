import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import { isAIFeatureEnabled } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { patientHistoryFile } from '$lib/server/db/schema';
import { enqueueJob } from '$lib/server/jobs/queue';
import { getHistoryUploadLimitBytes } from '$lib/server/storage/s3';
import {
	badRequest,
	created,
	forbidden,
	notFound,
	rethrowControlFlowError,
	serverError
} from '$lib/server/utils/api';
import { logError } from '$lib/server/utils/log';

const requestSchema = z.object({
	key: z.string().trim().min(1),
	fileName: z.string().trim().min(1).max(255),
	mimeType: z.string().trim().min(1).max(255),
	byteSize: z.number().int().positive(),
	checksum: z.string().trim().max(255).optional()
});

const ALLOWED_MIME_TYPES = new Set([
	'application/pdf',
	'text/csv',
	'application/csv',
	'application/vnd.ms-excel'
]);

export const POST: RequestHandler = async (event) => {
	try {
		const adminUser = requireRole(event, 'admin');
		if (!isAIFeatureEnabled('historyIngest')) {
			return forbidden('Historical rehab ingestion is currently disabled.');
		}

		const patientId = event.params.patientId;
		if (!patientId) {
			return badRequest('Missing patient identifier.');
		}

		const payload = requestSchema.parse(await event.request.json());
		const expectedPrefix = `patient-history/${patientId}/`;
		if (!payload.key.startsWith(expectedPrefix)) {
			return badRequest('Upload key does not match the selected patient.');
		}

		const normalizedMimeType = payload.mimeType.toLowerCase();
		const lowerName = payload.fileName.toLowerCase();
		const isPdf = normalizedMimeType.includes('pdf') || lowerName.endsWith('.pdf');
		const isCsv = normalizedMimeType.includes('csv') || lowerName.endsWith('.csv');
		if (!isPdf && !isCsv && !ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
			return badRequest('Only PDF and CSV files are supported.');
		}

		if (payload.byteSize > getHistoryUploadLimitBytes()) {
			return badRequest('Uploaded file is larger than the configured limit.');
		}

		const patient = await db.query.user.findFirst({
			where: (table, { eq }) => eq(table.id, patientId),
			columns: { id: true, role: true }
		});

		if (!patient || patient.role !== 'patient') {
			return notFound('Patient account was not found.');
		}

		const fileId = crypto.randomUUID();
		await db.insert(patientHistoryFile).values({
			id: fileId,
			patientId,
			uploadedByUserId: adminUser.id,
			fileName: payload.fileName,
			mimeType: normalizedMimeType,
			byteSize: payload.byteSize,
			s3Key: payload.key,
			checksum: payload.checksum ?? null,
			parseStatus: 'pending'
		});

		const jobId = await enqueueJob({
			type: 'history.parse',
			payload: { fileId }
		});

		return created({
			fileId,
			jobId,
			message: 'File registered and queued for parsing.'
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid file completion payload.', error.flatten());
		}

		logError('Failed to finalize history file upload', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to finalize upload right now.');
	}
};
