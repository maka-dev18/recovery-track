import { env } from '$env/dynamic/private';
import { z } from 'zod';

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const DEFAULT_LIVE_MODELS = [
	'gemini-2.5-flash-native-audio-preview-12-2025',
	'gemini-2.0-flash-live-001'
] as const;

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
	if (value == null || value.trim() === '') return fallback;

	const normalized = value.trim().toLowerCase();
	if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
	if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;

	throw new Error(`Invalid boolean env value: "${value}"`);
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
	if (value == null || value.trim() === '') return fallback;
	const parsed = Number.parseInt(value, 10);

	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid integer env value: "${value}"`);
	}

	return parsed;
}

function parseCsvEnv(value: string | undefined): string[] {
	if (!value || value.trim() === '') {
		return [];
	}

	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

const modelSchema = z.string().trim().min(1);
const configuredFallbackModels = parseCsvEnv(env.AI_LIVE_MODEL_FALLBACKS);
const fallbackModels =
	configuredFallbackModels.length > 0 ? configuredFallbackModels : [...DEFAULT_LIVE_MODELS];

const rawConfig = {
	googleApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
	textModel: env.AI_TEXT_MODEL ?? 'gemini-2.5-flash',
	riskModel: env.AI_RISK_MODEL ?? 'gemini-2.5-flash',
	liveModel: env.AI_LIVE_MODEL ?? DEFAULT_LIVE_MODELS[0],
	liveModelFallbacks: fallbackModels,
	chatEnabled: parseBooleanEnv(env.AI_CHAT_ENABLED, true),
	liveVoiceEnabled: parseBooleanEnv(env.AI_LIVE_VOICE_ENABLED, true),
	historyIngestEnabled: parseBooleanEnv(env.AI_HISTORY_INGEST_ENABLED, true),
	deidentifyMode: parseBooleanEnv(env.AI_DEIDENTIFY_MODE, true),
	maxUploadBytes: parseIntegerEnv(env.MAX_HISTORY_UPLOAD_BYTES, 25 * 1024 * 1024),
	maxMessageChars: parseIntegerEnv(env.AI_MAX_MESSAGE_CHARS, 2_000),
	s3Endpoint: env.S3_ENDPOINT,
	s3Region: env.S3_REGION,
	s3Bucket: env.S3_BUCKET,
	s3AccessKeyId: env.S3_ACCESS_KEY_ID,
	s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY,
	s3ForcePathStyle: parseBooleanEnv(env.S3_FORCE_PATH_STYLE, true),
	internalCronSecret: env.INTERNAL_CRON_SECRET ?? ''
};

const validatedModelConfig = z
	.object({
		textModel: modelSchema,
		riskModel: modelSchema,
		liveModel: modelSchema,
		liveModelFallbacks: z.array(modelSchema).min(1),
		maxUploadBytes: z.number().int().positive(),
		maxMessageChars: z.number().int().positive()
	})
	.parse(rawConfig);

export const aiConfig = {
	...rawConfig,
	...validatedModelConfig,
	googleApiKey: rawConfig.googleApiKey?.trim() || null,
	s3Endpoint: rawConfig.s3Endpoint?.trim() || null,
	s3Region: rawConfig.s3Region?.trim() || null,
	s3Bucket: rawConfig.s3Bucket?.trim() || null,
	s3AccessKeyId: rawConfig.s3AccessKeyId?.trim() || null,
	s3SecretAccessKey: rawConfig.s3SecretAccessKey?.trim() || null,
	liveModelFallbacks: unique(validatedModelConfig.liveModelFallbacks.map((model) => model.trim())),
	internalCronSecret: rawConfig.internalCronSecret.trim()
} as const;

export type AIConfig = typeof aiConfig;

export function isAIFeatureEnabled(feature: 'chat' | 'liveVoice' | 'historyIngest'): boolean {
	if (feature === 'chat') return aiConfig.chatEnabled;
	if (feature === 'liveVoice') return aiConfig.liveVoiceEnabled;
	return aiConfig.historyIngestEnabled;
}

export function requireGoogleApiKey(): string {
	if (!aiConfig.googleApiKey) {
		throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured.');
	}

	return aiConfig.googleApiKey;
}

export function ensureS3Config() {
	if (!aiConfig.s3Endpoint || !aiConfig.s3Region || !aiConfig.s3Bucket) {
		throw new Error('S3_ENDPOINT, S3_REGION, and S3_BUCKET are required for history ingestion.');
	}

	if (!aiConfig.s3AccessKeyId || !aiConfig.s3SecretAccessKey) {
		throw new Error('S3 credentials are missing. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
	}

	return {
		endpoint: aiConfig.s3Endpoint,
		region: aiConfig.s3Region,
		bucket: aiConfig.s3Bucket,
		accessKeyId: aiConfig.s3AccessKeyId,
		secretAccessKey: aiConfig.s3SecretAccessKey,
		forcePathStyle: aiConfig.s3ForcePathStyle
	};
}

export function assertFeatureEnabled(feature: 'chat' | 'liveVoice' | 'historyIngest') {
	if (!isAIFeatureEnabled(feature)) {
		throw new Error(`Feature is disabled: ${feature}`);
	}
}

export function getLiveModelCandidates(preferredModel = aiConfig.liveModel): string[] {
	const preferred = preferredModel.trim();
	const fallbackList = aiConfig.liveModelFallbacks;

	const ordered = preferred ? [preferred, ...fallbackList] : [...fallbackList];

	return unique(ordered.filter((entry) => entry.trim().length > 0));
}

export function isNativeAudioLiveModel(model: string): boolean {
	return /native-audio/i.test(model);
}
