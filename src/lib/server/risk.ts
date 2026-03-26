import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { getRiskModel } from '$lib/server/ai/provider';
import { aiConfig } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import {
	aiRiskSignal,
	associateObservation,
	patientCheckin,
	patientHistorySignal,
	patientSignal,
	riskAlert,
	riskScore,
	therapistPatientAssignment
} from '$lib/server/db/schema';
import { ensureRiskFollowUpSession } from '$lib/server/therapy-sessions';
import { logWarn } from '$lib/server/utils/log';

export type RiskTier = 'low' | 'moderate' | 'high' | 'critical';
export type RiskSource = 'checkin' | 'observation' | 'manual' | 'chat' | 'history' | 'therapy_session';

export type ConversationRiskLabel =
	| 'craving_spike'
	| 'relapse_intent'
	| 'self_harm_risk'
	| 'hopelessness'
	| 'withdrawal_risk'
	| 'protective_factor';

type RiskFactor = {
	label: string;
	points: number;
};

const CHECKIN_LOOKBACK_HOURS = 72;
const HISTORY_LOOKBACK_DAYS = 180;
const ALERT_COOLDOWN_HOURS = 6;

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function scoreToTier(score: number): RiskTier {
	if (score >= 80) return 'critical';
	if (score >= 60) return 'high';
	if (score >= 40) return 'moderate';
	return 'low';
}

function pointsForCheckin(checkin: {
	mood: number;
	craving: number;
	stress: number;
	sleepHours: number;
}): RiskFactor[] {
	const moodPoints = clamp((5 - checkin.mood) * 8, 0, 32);
	const cravingPoints = clamp(checkin.craving * 4.5, 0, 45);
	const stressPoints = clamp(checkin.stress * 2.5, 0, 25);
	const sleepDebt = clamp(8 - checkin.sleepHours, 0, 8);
	const sleepPoints = sleepDebt * 2;

	return [
		{ label: 'Mood volatility', points: Math.round(moodPoints) },
		{ label: 'Craving intensity', points: Math.round(cravingPoints) },
		{ label: 'Stress level', points: Math.round(stressPoints) },
		{ label: 'Sleep disruption', points: Math.round(sleepPoints) }
	].filter((factor) => factor.points > 0);
}

function pointsForObservations(
	observations: Array<{
		severity: number;
		category: string;
	}>
): RiskFactor[] {
	if (observations.length === 0) {
		return [];
	}

	const weighted = observations.reduce((sum, observation) => {
		const categoryBonus = observation.category === 'safety' ? 3 : 0;
		return sum + observation.severity * 3 + categoryBonus;
	}, 0);

	return [{
		label: 'Recent associate observations',
		points: Math.min(25, Math.round(weighted))
	}];
}

function parseLabels(raw: string): ConversationRiskLabel[] {
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((value): value is ConversationRiskLabel => typeof value === 'string') as ConversationRiskLabel[];
	} catch {
		return [];
	}
}

function pointsForChatSignals(
	signals: Array<{
		severity: number;
		labelsJson: string;
	}>
): RiskFactor[] {
	if (signals.length === 0) {
		return [];
	}

	const peakSeverity = signals.reduce((max, signal) => Math.max(max, signal.severity), 0);
	const labels = new Set<ConversationRiskLabel>();
	for (const signal of signals) {
		for (const label of parseLabels(signal.labelsJson)) {
			labels.add(label);
		}
	}

	let points = clamp(Math.round(peakSeverity * 0.25), 0, 25);
	if (labels.has('self_harm_risk') || labels.has('relapse_intent')) {
		points = Math.max(points, 20);
	}

	if (points === 0) {
		return [];
	}

	return [
		{
			label: 'Chat distress signals',
			points
		}
	];
}

function pointsForHistorySignals(
	historySignals: Array<{
		signalValueJson: string;
	}>
): RiskFactor[] {
	if (historySignals.length === 0) {
		return [];
	}

	const weights: number[] = [];
	for (const signal of historySignals) {
		try {
			const parsed = JSON.parse(signal.signalValueJson) as { riskWeight?: unknown };
			if (typeof parsed.riskWeight === 'number' && Number.isFinite(parsed.riskWeight)) {
				weights.push(clamp(parsed.riskWeight, 0, 100));
			}
		} catch {
			continue;
		}
	}

	if (weights.length === 0) {
		return [];
	}

	const averageWeight = weights.reduce((sum, value) => sum + value, 0) / weights.length;
	const points = clamp(Math.round(averageWeight * 0.15), 0, 15);

	if (points === 0) {
		return [];
	}

	return [
		{
			label: 'Historical baseline',
			points
		}
	];
}

function pointsForDetectedSignals(
	signals: Array<{
		severity: number;
		signalType: string;
	}>
): RiskFactor[] {
	if (signals.length === 0) {
		return [];
	}

	const peakSeverity = signals.reduce((max, signal) => Math.max(max, signal.severity), 0);
	const signalTypes = new Set(signals.map((signal) => signal.signalType));
	let points = clamp(Math.round(peakSeverity * 0.18), 0, 22);

	if (signalTypes.has('safety_risk')) {
		points = Math.max(points, 22);
	}

	if (signalTypes.has('relapse_risk')) {
		points = Math.max(points, 18);
	}

	if (points === 0) {
		return [];
	}

	return [
		{
			label: 'Care-team clinical signals',
			points
		}
	];
}

function serializeFactors(factors: RiskFactor[]): string {
	return JSON.stringify(factors);
}

async function createOrRefreshAlert(args: {
	patientId: string;
	tier: RiskTier;
	reason: string;
	factors: RiskFactor[];
	riskScoreId: string;
	triggeredByUserId?: string;
}) {
	if (args.tier === 'low') {
		return null;
	}

	const therapistAssignment = await db.query.therapistPatientAssignment.findFirst({
		where: eq(therapistPatientAssignment.patientId, args.patientId),
		orderBy: (table, { asc }) => [asc(table.createdAt)]
	});

	const cooldownFloor = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000);
	const existingAlert = await db.query.riskAlert.findFirst({
		where: and(
			eq(riskAlert.patientId, args.patientId),
			eq(riskAlert.level, args.tier),
			gte(riskAlert.createdAt, cooldownFloor),
			inArray(riskAlert.status, ['open', 'acknowledged'])
		),
		orderBy: (table, { desc }) => [desc(table.createdAt)]
	});

	if (existingAlert) {
		await db
			.update(riskAlert)
			.set({
				status: 'open',
				reason: args.reason,
				details: serializeFactors(args.factors),
				riskScoreId: args.riskScoreId,
				therapistId: therapistAssignment?.therapistId ?? existingAlert.therapistId,
				triggeredByUserId: args.triggeredByUserId,
				acknowledgedAt: null,
				acknowledgedByUserId: null,
				resolvedAt: null,
				resolvedByUserId: null,
				resolutionNote: null
			})
			.where(eq(riskAlert.id, existingAlert.id));

		return existingAlert.id;
	}

	const alertId = crypto.randomUUID();

	await db.insert(riskAlert).values({
		id: alertId,
		patientId: args.patientId,
		therapistId: therapistAssignment?.therapistId,
		riskScoreId: args.riskScoreId,
		status: 'open',
		level: args.tier,
		reason: args.reason,
		details: serializeFactors(args.factors),
		triggeredByUserId: args.triggeredByUserId
	});

	return alertId;
}

const conversationRiskSchema = z.object({
	severity: z.number().int().min(0).max(100),
	labels: z.array(
		z.enum([
			'craving_spike',
			'relapse_intent',
			'self_harm_risk',
			'hopelessness',
			'withdrawal_risk',
			'protective_factor'
		])
	),
	explanation: z.string().min(1).max(300)
});

function heuristicConversationRisk(input: string): z.infer<typeof conversationRiskSchema> {
	const text = input.toLowerCase();
	let severity = 15;
	const labels: ConversationRiskLabel[] = [];

	if (/craving|urge|trigger/.test(text)) {
		severity += 20;
		labels.push('craving_spike');
	}

	if (/relapse|use again|drink again|drug/.test(text)) {
		severity += 30;
		labels.push('relapse_intent');
	}

	if (/self harm|suicide|end my life|hurt myself/.test(text)) {
		severity += 45;
		labels.push('self_harm_risk');
	}

	if (/hopeless|cannot go on|no point/.test(text)) {
		severity += 20;
		labels.push('hopelessness');
	}

	if (/withdrawal|shaking|detox/.test(text)) {
		severity += 15;
		labels.push('withdrawal_risk');
	}

	if (/support|meeting|sponsor|coping/.test(text)) {
		severity -= 10;
		labels.push('protective_factor');
	}

	return {
		severity: clamp(Math.round(severity), 0, 100),
		labels: [...new Set(labels)],
		explanation: 'Heuristic fallback based on patient language cues.'
	};
}

export async function analyzeConversationRisk(args: {
	patientId: string;
	sessionId: string;
	text: string;
	triggeredByUserId?: string;
}) {
	const normalizedText = args.text.trim();
	if (!normalizedText) {
		return null;
	}

	const safeText = deidentifyText(normalizedText);
	let assessment = heuristicConversationRisk(safeText);

	if (aiConfig.chatEnabled && aiConfig.googleApiKey) {
		try {
			const result = await generateObject({
				model: getRiskModel(),
				schema: conversationRiskSchema,
				system:
					'You classify relapse and safety risk in therapy conversations. Return conservative, clinically cautious outputs.',
				prompt: [
					'Evaluate this patient conversation snippet and classify risk severity and labels.',
					'Conversation:',
					safeText
				].join('\n\n')
			});

			assessment = result.object;
		} catch (error) {
			logWarn('AI risk analysis failed, using heuristic fallback', {
				error: error instanceof Error ? error.message : String(error),
				patientId: args.patientId,
				sessionId: args.sessionId
			});
		}
	}

	const signalId = crypto.randomUUID();
	await db.insert(aiRiskSignal).values({
		id: signalId,
		patientId: args.patientId,
		sessionId: args.sessionId,
		severity: assessment.severity,
		labelsJson: JSON.stringify(assessment.labels),
		explanation: assessment.explanation
	});

	const requiresImmediateCritical =
		assessment.severity >= 70 &&
		(assessment.labels.includes('self_harm_risk') || assessment.labels.includes('relapse_intent'));

	if (requiresImmediateCritical && args.triggeredByUserId) {
		await createManualCriticalAlert({
			patientId: args.patientId,
			triggeredByUserId: args.triggeredByUserId,
			reason: 'AI therapist detected high-risk conversation markers'
		});
	}

	return {
		id: signalId,
		severity: assessment.severity,
		labels: assessment.labels,
		explanation: assessment.explanation,
		requiresImmediateCritical
	};
}

export async function recalculatePatientRisk(args: {
	patientId: string;
	source: RiskSource;
	checkinId?: string;
	observationId?: string;
	triggeredByUserId?: string;
}) {
	const latestCheckin = await db.query.patientCheckin.findFirst({
		where: eq(patientCheckin.patientId, args.patientId),
		orderBy: (table, { desc }) => [desc(table.createdAt)]
	});

	const observationWindowFloor = new Date(Date.now() - CHECKIN_LOOKBACK_HOURS * 60 * 60 * 1000);
	const recentObservations = await db.query.associateObservation.findMany({
		where: and(
			eq(associateObservation.patientId, args.patientId),
			gte(associateObservation.createdAt, observationWindowFloor)
		),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 8
	});

	const recentChatSignals = await db.query.aiRiskSignal.findMany({
		where: and(eq(aiRiskSignal.patientId, args.patientId), gte(aiRiskSignal.createdAt, observationWindowFloor)),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 8
	});
	const recentDetectedSignals = await db.query.patientSignal.findMany({
		where: and(eq(patientSignal.patientId, args.patientId), gte(patientSignal.occurredAt, observationWindowFloor)),
		orderBy: (table, { desc }) => [desc(table.occurredAt)],
		limit: 12
	});

	const historyWindowFloor = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
	const recentHistorySignals = await db.query.patientHistorySignal.findMany({
		where: and(
			eq(patientHistorySignal.patientId, args.patientId),
			gte(patientHistorySignal.createdAt, historyWindowFloor)
		),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 40
	});

	const checkinFactors = latestCheckin
		? pointsForCheckin({
				mood: latestCheckin.mood,
				craving: latestCheckin.craving,
				stress: latestCheckin.stress,
				sleepHours: latestCheckin.sleepHours
			})
		: [{ label: 'Missing recent self check-ins', points: 20 }];

	const observationFactors = pointsForObservations(
		recentObservations.map((observation) => ({
			severity: observation.severity,
			category: observation.category
		}))
	);

	const chatFactors = pointsForChatSignals(
		recentChatSignals.map((signal) => ({
			severity: signal.severity,
			labelsJson: signal.labelsJson
		}))
	);

	const historyFactors = pointsForHistorySignals(
		recentHistorySignals.map((signal) => ({
			signalValueJson: signal.signalValueJson
		}))
	);
	const detectedSignalFactors = pointsForDetectedSignals(
		recentDetectedSignals.map((signal) => ({
			severity: signal.severity,
			signalType: signal.signalType
		}))
	);

	const factors = [
		...checkinFactors,
		...observationFactors,
		...chatFactors,
		...historyFactors,
		...detectedSignalFactors
	];
	const totalScore = clamp(
		factors.reduce((sum, factor) => sum + factor.points, 0),
		0,
		100
	);
	const tier = scoreToTier(totalScore);

	const riskScoreId = crypto.randomUUID();
	await db.insert(riskScore).values({
		id: riskScoreId,
		patientId: args.patientId,
		score: totalScore,
		tier,
		source: args.source,
		factors: serializeFactors(factors),
		checkinId: args.checkinId,
		observationId: args.observationId
	});

	const alertId = await createOrRefreshAlert({
		patientId: args.patientId,
		tier,
		reason:
			tier === 'critical'
				? 'Critical relapse risk detected'
				: tier === 'high'
					? 'High relapse risk detected'
					: 'Moderate relapse risk detected',
		factors,
		riskScoreId,
		triggeredByUserId: args.triggeredByUserId
	});

	let followUpSessionId: string | null = null;
	if (tier === 'moderate' || tier === 'high' || tier === 'critical') {
		const therapistAssignment = await db.query.therapistPatientAssignment.findFirst({
			where: eq(therapistPatientAssignment.patientId, args.patientId),
			orderBy: (table, { asc }) => [asc(table.createdAt)]
		});

		if (therapistAssignment?.therapistId) {
			const followUp = await ensureRiskFollowUpSession({
				patientId: args.patientId,
				therapistId: therapistAssignment.therapistId,
				tier,
				reason:
					tier === 'moderate'
						? 'Moderate risk follow-up suggested. Confirm a video session.'
						: 'High-risk follow-up scheduled automatically from the risk engine.'
			});
			followUpSessionId = followUp.sessionId;
		}
	}

	return {
		riskScoreId,
		score: totalScore,
		tier,
		factors,
		alertId,
		followUpSessionId
	};
}

export async function createManualCriticalAlert(args: {
	patientId: string;
	triggeredByUserId: string;
	reason: string;
}) {
	const factors: RiskFactor[] = [{ label: args.reason, points: 90 }];
	const riskScoreId = crypto.randomUUID();

	await db.insert(riskScore).values({
		id: riskScoreId,
		patientId: args.patientId,
		score: 90,
		tier: 'critical',
		source: 'manual',
		factors: serializeFactors(factors)
	});

	const alertId = await createOrRefreshAlert({
		patientId: args.patientId,
		tier: 'critical',
		reason: args.reason,
		factors,
		riskScoreId,
		triggeredByUserId: args.triggeredByUserId
	});

	const therapistAssignment = await db.query.therapistPatientAssignment.findFirst({
		where: eq(therapistPatientAssignment.patientId, args.patientId),
		orderBy: (table, { asc }) => [asc(table.createdAt)]
	});
	let followUpSessionId: string | null = null;

	if (therapistAssignment?.therapistId) {
		const followUp = await ensureRiskFollowUpSession({
			patientId: args.patientId,
			therapistId: therapistAssignment.therapistId,
			tier: 'critical',
			reason: args.reason
		});
		followUpSessionId = followUp.sessionId;
	}

	return {
		riskScoreId,
		alertId,
		followUpSessionId
	};
}
