import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { aiConfig, ensureS3Config } from '$lib/server/config/ai';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
	if (s3Client) {
		return s3Client;
	}

	const config = ensureS3Config();
	s3Client = new S3Client({
		endpoint: config.endpoint,
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		},
		forcePathStyle: config.forcePathStyle
	});

	return s3Client;
}

function getBucketName(): string {
	return ensureS3Config().bucket;
}

function sanitizeFileName(fileName: string): string {
	const normalized = fileName.trim().toLowerCase().replace(/\s+/g, '-');
	const clean = normalized.replace(/[^a-z0-9._-]/g, '');
	return clean.slice(-120) || 'upload.bin';
}

export function buildHistoryObjectKey(patientId: string, fileName: string): string {
	const timestamp = Date.now();
	const suffix = randomUUID().slice(0, 8);
	return `patient-history/${patientId}/${timestamp}-${suffix}-${sanitizeFileName(fileName)}`;
}

export async function createPresignedHistoryUpload(args: {
	patientId: string;
	fileName: string;
	mimeType: string;
	byteSize: number;
}) {
	const key = buildHistoryObjectKey(args.patientId, args.fileName);
	const command = new PutObjectCommand({
		Bucket: getBucketName(),
		Key: key,
		ContentType: args.mimeType,
		ContentLength: args.byteSize
	});

	const expiresIn = 15 * 60;
	const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn });

	return {
		key,
		uploadUrl,
		expiresIn
	};
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

export async function getS3ObjectBytes(key: string): Promise<Buffer> {
	const response = await getS3Client().send(
		new GetObjectCommand({
			Bucket: getBucketName(),
			Key: key
		})
	);

	if (!response.Body) {
		throw new Error(`Missing object body for key: ${key}`);
	}

	const body = response.Body as
		| Readable
		| {
				transformToByteArray?: () => Promise<Uint8Array>;
		  };

	if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
		const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
		return Buffer.from(bytes);
	}

	if (body instanceof Readable) {
		return streamToBuffer(body);
	}

	throw new Error(`Unsupported S3 body stream for key: ${key}`);
}

export function getHistoryUploadLimitBytes() {
	return aiConfig.maxUploadBytes;
}
