import { and, eq } from 'drizzle-orm';
import { GoogleGenAI, Modality } from '@google/genai';
import type { AuthToken } from '@google/genai';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/authz';
import {
	aiConfig,
	getLiveModelCandidates,
	isAIFeatureEnabled,
	isNativeAudioLiveModel,
	requireGoogleApiKey
} from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { aiSession } from '$lib/server/db/schema';
import { badRequest, created, forbidden, rethrowControlFlowError, serverError } from '$lib/server/utils/api';
import { logError, logInfo, logWarn } from '$lib/server/utils/log';

const requestSchema = z.object({
	sessionId: z.string().uuid().optional()
});

function getLiveResponseModality(model: string): Modality {
	return isNativeAudioLiveModel(model) ? Modality.AUDIO : Modality.TEXT;
}

async function getOrCreateLiveSession(patientId: string, sessionId?: string) {
	if (sessionId) {
		const existing = await db.query.aiSession.findFirst({
			where: and(eq(aiSession.id, sessionId), eq(aiSession.patientId, patientId), eq(aiSession.mode, 'live_voice'))
		});

		if (existing) {
			return existing;
		}
	}

	const id = crypto.randomUUID();
	await db.insert(aiSession).values({
		id,
		patientId,
		mode: 'live_voice',
		status: 'active'
	});

	const createdSession = await db.query.aiSession.findFirst({
		where: eq(aiSession.id, id)
	});

	if (!createdSession) {
		throw new Error('Unable to create live voice session.');
	}

	return createdSession;
}

export const POST: RequestHandler = async (event) => {
	try {
		const patientUser = requireRole(event, 'patient');
		if (!isAIFeatureEnabled('liveVoice')) {
			return forbidden('Live voice therapist sessions are currently disabled.');
		}

		const payload = requestSchema.parse(
			event.request.headers.get('content-type')?.includes('application/json')
				? await event.request.json()
				: {}
		);
		logInfo('Live token request received', {
			patientId: patientUser.id,
			hasSessionId: Boolean(payload.sessionId),
			path: event.url.pathname
		});

		const session = await getOrCreateLiveSession(patientUser.id, payload.sessionId);
		const client = new GoogleGenAI({
			apiKey: requireGoogleApiKey(),
			httpOptions: { apiVersion: 'v1alpha' }
		});

		const modelCandidates = getLiveModelCandidates(aiConfig.liveModel);
		let selectedModel: string | null = null;
		let token: AuthToken | null = null;
		const candidateErrors: string[] = [];

		for (const candidateModel of modelCandidates) {
			try {
				const responseModality = getLiveResponseModality(candidateModel);
				const candidateToken = await client.authTokens.create({
					config: {
						uses: 1,
						newSessionExpireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
						liveConnectConstraints: {
							model: candidateModel,
							config: {
								responseModalities: [responseModality],
								inputAudioTranscription: {},
								outputAudioTranscription: {}
							}
						}
					}
				});

				if (candidateToken.name) {
					selectedModel = candidateModel;
					token = candidateToken;
					break;
				}

				candidateErrors.push(`${candidateModel}: token missing name`);
			} catch (candidateError) {
				const message = candidateError instanceof Error ? candidateError.message : String(candidateError);
				candidateErrors.push(`${candidateModel}: ${message}`);
			}
		}

		if (selectedModel && selectedModel !== aiConfig.liveModel) {
			logWarn('Configured live model was not selected; using fallback candidate.', {
				configuredLiveModel: aiConfig.liveModel,
				selectedLiveModel: selectedModel,
				candidates: modelCandidates
			});
		}

		if (!token?.name || !selectedModel) {
			throw new Error(
				`Failed to mint an ephemeral live token for candidates: ${modelCandidates.join(', ')}. ${
					candidateErrors.length > 0 ? `Errors: ${candidateErrors.join(' | ')}` : ''
				}`.trim()
			);
		}
		logInfo('Live token minted', {
			patientId: patientUser.id,
			sessionId: session.id,
			model: selectedModel,
			responseModality: getLiveResponseModality(selectedModel),
			tokenNamePrefix: token.name.slice(0, 24)
		});

		return created({
			sessionId: session.id,
			ephemeralToken: token.name,
			model: selectedModel,
			responseModality: getLiveResponseModality(selectedModel),
			configuredModel: aiConfig.liveModel,
			modelCandidates,
			expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		});
	} catch (error) {
		rethrowControlFlowError(error);

		if (error instanceof z.ZodError) {
			return badRequest('Invalid live token payload.', error.flatten());
		}

		logError('Failed to mint live token', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});
		return serverError('Unable to initialize live voice session right now.');
	}
};
