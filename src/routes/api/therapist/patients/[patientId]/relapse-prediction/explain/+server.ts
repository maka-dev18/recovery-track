import { generateObject } from 'ai';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getTextModel } from '$lib/server/ai/provider';
import { requireRole } from '$lib/server/authz';
import { aiConfig, isAIFeatureEnabled } from '$lib/server/config/ai';
import { buildRelapsePrediction } from '$lib/server/relapse-prediction';
import { therapistHasPatientAssignment } from '$lib/server/relationships';
import {
	badRequest,
	forbidden,
	notFound,
	ok,
	rethrowControlFlowError,
	serverError
} from '$lib/server/utils/api';
import { logError, logWarn } from '$lib/server/utils/log';

const explanationSchema = z.object({
	summary: z.string().min(1).max(900),
	keyEvidence: z.array(z.string().min(1).max(220)).min(1).max(5),
	recommendedActions: z.array(z.string().min(1).max(220)).min(1).max(5),
	limitations: z.string().min(1).max(400)
});

type RelapsePredictionExplanation = z.infer<typeof explanationSchema>;

function compactPredictionForPrompt(prediction: Awaited<ReturnType<typeof buildRelapsePrediction>>) {
	if (!prediction) {
		return null;
	}

	return {
		patientName: prediction.patientName,
		likelihoodPercent: prediction.likelihoodPercent,
		tier: prediction.tier,
		flagged: prediction.flagged,
		trend: prediction.trend,
		confidence: prediction.confidence,
		sourceCoverage: prediction.sourceCoverage,
		topDrivers: prediction.topDrivers.map((driver) => ({
			source: driver.source,
			label: driver.label,
			points: driver.points,
			evidence: driver.evidence
		}))
	};
}

function buildFallbackExplanation(
	prediction: NonNullable<Awaited<ReturnType<typeof buildRelapsePrediction>>>,
	errorMessage?: string
): RelapsePredictionExplanation {
	const topDrivers = prediction.topDrivers.slice(0, 4);
	const keyEvidence =
		topDrivers.length > 0
			? topDrivers.map((driver) => `${driver.label}: ${driver.evidence}`.slice(0, 220))
			: ['No major current drivers were identified beyond the available baseline risk data.'];

	const recommendedActions =
		prediction.tier === 'critical' || prediction.tier === 'high'
			? [
					'Prioritize direct therapist follow-up today and review the open risk drivers.',
					'Ask the patient and associate for updates on craving, access to substances, sleep, and immediate supports.',
					'Confirm a safety and relapse-prevention plan, including who the patient will contact before using.'
				]
			: prediction.tier === 'moderate'
				? [
						'Schedule a near-term check-in and review the top relapse drivers with the patient.',
						'Ask the associate or care team to monitor the listed warning signs over the next week.',
						'Reinforce protective routines, support meetings, and coping tools tied to the patient history.'
					]
				: [
						'Continue routine monitoring and encourage consistent check-ins.',
						'Review protective factors and keep relapse-prevention routines active.'
					];

	return {
		summary: `${prediction.patientName} has a ${prediction.likelihoodPercent}% estimated 7-day relapse likelihood, classified as ${prediction.tier}. This is a deterministic Recovery Track prediction based on current stored data, not a diagnosis.`,
		keyEvidence,
		recommendedActions,
		limitations: errorMessage
			? `AI wording was unavailable, so this explanation was generated from the deterministic prediction data. AI error: ${errorMessage.slice(0, 180)}`
			: `Confidence is ${prediction.confidence}%, so interpret this alongside clinical judgement and any data sources that are missing or stale.`
	};
}

export const POST: RequestHandler = async (event) => {
	try {
		const therapistUser = requireRole(event, 'therapist');
		if (!isAIFeatureEnabled('chat')) {
			return forbidden('AI explanation is currently disabled.');
		}

		if (!aiConfig.googleApiKey) {
			return serverError('AI provider is not configured.');
		}

		const patientId = event.params.patientId;
		if (!patientId) {
			return badRequest('Missing patient identifier.');
		}

		if (!(await therapistHasPatientAssignment(therapistUser.id, patientId))) {
			return forbidden('You can only explain relapse predictions for assigned patients.');
		}

		const prediction = await buildRelapsePrediction(patientId);
		if (!prediction) {
			return notFound('Patient prediction was not found.');
		}

		try {
			const result = await generateObject({
				model: getTextModel(),
				schema: explanationSchema,
				prompt: [
					'You are Amani, writing a concise therapist-facing explanation for a deterministic 7-day relapse prediction.',
					'Do not change the numeric likelihood, tier, confidence, or source coverage.',
					'Do not diagnose. Frame this as clinical decision support and recommend practical follow-up steps.',
					'Use the evidence drivers exactly as provided and mention missing/limited data in limitations.',
					`Prediction JSON:\n${JSON.stringify(compactPredictionForPrompt(prediction))}`
				].join('\n\n')
			});

			return ok({
				prediction,
				explanation: result.object,
				generatedBy: 'ai'
			});
		} catch (aiError) {
			const message = aiError instanceof Error ? aiError.message : String(aiError);
			logWarn('AI relapse prediction explanation failed, using deterministic fallback', {
				error: message,
				patientId,
				therapistId: therapistUser.id
			});

			return ok({
				prediction,
				explanation: buildFallbackExplanation(prediction, message),
				generatedBy: 'deterministic_fallback'
			});
		}
	} catch (error) {
		rethrowControlFlowError(error);

		logError('Failed to explain relapse prediction', {
			error: error instanceof Error ? error.message : String(error),
			path: event.url.pathname
		});

		return serverError('Unable to generate the relapse prediction explanation right now.');
	}
};
