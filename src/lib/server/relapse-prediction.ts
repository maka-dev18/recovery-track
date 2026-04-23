import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	aiRiskSignal,
	associateObservation,
	patientCheckin,
	patientHistorySignal,
	patientSignal,
	riskAlert,
	riskScore,
	therapistPatientAssignment,
	therapySession,
	user
} from '$lib/server/db/schema';
import { ensureRiskFollowUpSession } from '$lib/server/therapy-sessions';

export type RiskTier = 'low' | 'moderate' | 'high' | 'critical';

export type RelapsePredictionTrend = 'rising' | 'falling' | 'steady';
export type RelapsePredictionSource =
	| 'selfReport'
	| 'associate'
	| 'careTeam'
	| 'history'
	| 'engagementSignals';

export type RelapsePredictionDriver = {
	source: RelapsePredictionSource;
	label: string;
	points: number;
	evidence: string;
	occurredAt: Date | null;
};

export type RelapsePredictionSourceCoverage = {
	riskScores: number;
	checkins: number;
	associateObservations: number;
	aiRiskSignals: number;
	clinicalSignals: number;
	historySignals: number;
	therapySessions: number;
	noShowSessions: number;
	openAlerts: number;
};

export type RelapsePrediction = {
	patientId: string;
	patientName: string;
	patientEmail: string;
	likelihoodPercent: number;
	tier: RiskTier;
	flagged: boolean;
	trend: RelapsePredictionTrend;
	confidence: number;
	topDrivers: RelapsePredictionDriver[];
	drivers: Record<RelapsePredictionSource, RelapsePredictionDriver[]>;
	sourceCoverage: RelapsePredictionSourceCoverage;
	latestRiskScore: number | null;
	latestRiskTier: string | null;
	generatedAt: Date;
};

export type RelapsePredictionInput = {
	patientId: string;
	patientName?: string;
	patientEmail?: string;
	now?: Date;
	riskScores?: Array<{ score: number; tier: string; createdAt: Date }>;
	checkins?: Array<{
		mood: number;
		craving: number;
		stress: number;
		sleepHours: number;
		createdAt: Date;
	}>;
	associateObservations?: Array<{
		category: string;
		severity: number;
		note?: string | null;
		createdAt: Date;
	}>;
	aiRiskSignals?: Array<{ severity: number; labelsJson: string; createdAt: Date }>;
	clinicalSignals?: Array<{
		source: string;
		signalType: string;
		severity: number;
		confidence: number;
		summary: string;
		occurredAt: Date;
	}>;
	historySignals?: Array<{ signalType: string; signalValueJson: string; confidence: number; createdAt: Date }>;
	therapySessions?: Array<{
		status: string;
		summary: string | null;
		notes: string | null;
		scheduledStartAt: Date | null;
		createdAt: Date;
	}>;
	openAlerts?: Array<{ level: string; status: string; reason: string; createdAt: Date }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const HISTORY_LOOKBACK_MS = 180 * DAY_MS;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function scoreToTier(score: number): RiskTier {
	if (score >= 80) return 'critical';
	if (score >= 60) return 'high';
	if (score >= 40) return 'moderate';
	return 'low';
}

function emptyDrivers(): Record<RelapsePredictionSource, RelapsePredictionDriver[]> {
	return {
		selfReport: [],
		associate: [],
		careTeam: [],
		history: [],
		engagementSignals: []
	};
}

function driver(args: RelapsePredictionDriver): RelapsePredictionDriver {
	return {
		...args,
		points: Math.round(clamp(args.points, 0, 100))
	};
}

function parseRiskLabels(raw: string) {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
	} catch {
		return [];
	}
}

function parseRiskWeight(raw: string) {
	try {
		const parsed = JSON.parse(raw) as { riskWeight?: unknown; label?: unknown; summary?: unknown };
		return {
			riskWeight:
				typeof parsed.riskWeight === 'number' && Number.isFinite(parsed.riskWeight)
					? clamp(parsed.riskWeight, 0, 100)
					: null,
			label: typeof parsed.label === 'string' ? parsed.label : null,
			summary: typeof parsed.summary === 'string' ? parsed.summary : null
		};
	} catch {
		return { riskWeight: null, label: null, summary: null };
	}
}

function resolveTrend(riskScores: Array<{ score: number }>): RelapsePredictionTrend {
	if (riskScores.length < 2) {
		return 'steady';
	}

	const chronological = [...riskScores].reverse();
	const midpoint = Math.ceil(chronological.length / 2);
	const firstHalf = chronological.slice(0, midpoint);
	const secondHalf = chronological.slice(midpoint);
	if (secondHalf.length === 0) {
		return 'steady';
	}

	const average = (rows: Array<{ score: number }>) =>
		rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length);
	const delta = average(secondHalf) - average(firstHalf);
	if (delta >= 6) return 'rising';
	if (delta <= -6) return 'falling';
	return 'steady';
}

function latestAgeDays(value: Date | null | undefined, now: Date) {
	if (!value) {
		return null;
	}

	return Math.max(0, (now.getTime() - value.getTime()) / DAY_MS);
}

function categoryCount(input: RelapsePredictionInput) {
	return [
		(input.riskScores?.length ?? 0) > 0,
		(input.checkins?.length ?? 0) > 0,
		(input.associateObservations?.length ?? 0) > 0,
		(input.aiRiskSignals?.length ?? 0) > 0 || (input.clinicalSignals?.length ?? 0) > 0,
		(input.historySignals?.length ?? 0) > 0,
		(input.therapySessions?.length ?? 0) > 0
	].filter(Boolean).length;
}

function confidenceForInput(input: RelapsePredictionInput, now: Date) {
	const categories = categoryCount(input);
	let confidence = 12 + categories * 12;

	const latestCheckin = input.checkins?.[0] ?? null;
	const latestSignal = input.clinicalSignals?.[0] ?? null;
	const checkinAge = latestAgeDays(latestCheckin?.createdAt, now);
	const signalAge = latestAgeDays(latestSignal?.occurredAt, now);

	if (checkinAge !== null && checkinAge <= 7) confidence += 10;
	if (signalAge !== null && signalAge <= 7) confidence += 8;
	if ((input.riskScores?.length ?? 0) >= 2) confidence += 8;
	if ((input.historySignals?.length ?? 0) > 0) confidence += 6;
	if ((input.openAlerts?.length ?? 0) > 0) confidence += 5;
	if (checkinAge === null || checkinAge > 7) confidence -= 14;
	if (categories <= 1) confidence -= 12;

	return Math.round(clamp(confidence, 10, 95));
}

export function computeRelapsePrediction(input: RelapsePredictionInput): RelapsePrediction {
	const now = input.now ?? new Date();
	const riskScores = input.riskScores ?? [];
	const checkins = input.checkins ?? [];
	const associateObservations = input.associateObservations ?? [];
	const aiRiskSignals = input.aiRiskSignals ?? [];
	const clinicalSignals = input.clinicalSignals ?? [];
	const historySignals = input.historySignals ?? [];
	const therapySessions = input.therapySessions ?? [];
	const openAlerts = input.openAlerts ?? [];
	const drivers = emptyDrivers();

	const latestRisk = riskScores[0] ?? null;
	const trend = resolveTrend(riskScores);
	let score = latestRisk ? latestRisk.score : 15;

	if (trend === 'rising') {
		score += 8;
		drivers.engagementSignals.push(
			driver({
				source: 'engagementSignals',
				label: 'Risk trend is rising',
				points: 8,
				evidence: 'Recent calculated risk scores are moving upward.',
				occurredAt: latestRisk?.createdAt ?? null
			})
		);
	} else if (trend === 'falling') {
		score -= 6;
	}

	const latestCheckin = checkins[0] ?? null;
	const checkinAge = latestAgeDays(latestCheckin?.createdAt, now);
	if (!latestCheckin || checkinAge === null || checkinAge > 7) {
		const points = checkinAge === null ? 8 : checkinAge > 14 ? 12 : 8;
		const checkinAgeText = checkinAge === null ? 'unknown' : String(Math.round(checkinAge));
		score += points;
		drivers.selfReport.push(
			driver({
				source: 'selfReport',
				label: 'Missing recent check-in',
				points,
				evidence: latestCheckin
					? `Last patient check-in was ${checkinAgeText} days ago.`
					: 'No patient self check-ins are available.',
				occurredAt: latestCheckin?.createdAt ?? null
			})
		);
	} else {
		const cravingPoints = latestCheckin.craving >= 7 ? Math.round((latestCheckin.craving - 6) * 4) : 0;
		const stressPoints = latestCheckin.stress >= 7 ? Math.round((latestCheckin.stress - 6) * 3) : 0;
		const sleepPoints = latestCheckin.sleepHours <= 5 ? Math.round((6 - latestCheckin.sleepHours) * 3) : 0;
		const moodPoints = latestCheckin.mood <= 2 ? Math.round((3 - latestCheckin.mood) * 4) : 0;
		const selfPoints = clamp(cravingPoints + stressPoints + sleepPoints + moodPoints, 0, 22);
		if (selfPoints > 0) {
			score += selfPoints;
			drivers.selfReport.push(
				driver({
					source: 'selfReport',
					label: 'Self-report pressure',
					points: selfPoints,
					evidence: `Craving ${latestCheckin.craving}/10, stress ${latestCheckin.stress}/10, mood ${latestCheckin.mood}/5, sleep ${latestCheckin.sleepHours}h.`,
					occurredAt: latestCheckin.createdAt
				})
			);
		}
	}

	if (checkins.length >= 5) {
		const recent = checkins.slice(0, 3);
		const baseline = checkins.slice(3);
		const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
		const cravingDelta = average(recent.map((row) => row.craving)) - average(baseline.map((row) => row.craving));
		const stressDelta = average(recent.map((row) => row.stress)) - average(baseline.map((row) => row.stress));
		if (cravingDelta >= 2 || stressDelta >= 2) {
			const points = clamp(Math.round(Math.max(cravingDelta, 0) * 3 + Math.max(stressDelta, 0) * 2), 0, 14);
			score += points;
			drivers.selfReport.push(
				driver({
					source: 'selfReport',
					label: 'Self-report trend worsening',
					points,
					evidence: 'Recent craving or stress averages are higher than the earlier check-in window.',
					occurredAt: latestCheckin?.createdAt ?? null
				})
			);
		}
	}

	const recentObservations = associateObservations.filter(
		(observation) => now.getTime() - observation.createdAt.getTime() <= SEVEN_DAYS_MS
	);
	if (recentObservations.length > 0) {
		const peakObservation = recentObservations.reduce((peak, observation) =>
			observation.severity > peak.severity ? observation : peak
		);
		const categoryBonus =
			peakObservation.category === 'safety'
				? 8
				: peakObservation.category === 'substance_signs'
					? 7
					: peakObservation.category === 'behavior'
						? 4
						: 2;
		const points = clamp(peakObservation.severity * 4 + categoryBonus, 0, 24);
		score += points;
		drivers.associate.push(
			driver({
				source: 'associate',
				label: 'Associate warning observation',
				points,
				evidence: `${peakObservation.category.replaceAll('_', ' ')} severity ${peakObservation.severity}/5${peakObservation.note ? `: ${peakObservation.note.slice(0, 140)}` : ''}`,
				occurredAt: peakObservation.createdAt
			})
		);
	}

	const relapseClinicalSignals = clinicalSignals.filter(
		(signal) => signal.signalType === 'relapse_risk' || signal.signalType === 'safety_risk'
	);
	if (relapseClinicalSignals.length > 0) {
		const peakSignal = relapseClinicalSignals.reduce((peak, signal) =>
			signal.severity > peak.severity ? signal : peak
		);
		const sourceCount = new Set(relapseClinicalSignals.map((signal) => signal.source)).size;
		const points = clamp(Math.round(peakSignal.severity * 0.18) + Math.min(8, sourceCount * 3), 0, 26);
		score += points;
		drivers.careTeam.push(
			driver({
				source: 'careTeam',
				label: 'Clinical relapse signal',
				points,
				evidence: `${peakSignal.signalType.replaceAll('_', ' ')} from ${peakSignal.source.replaceAll('_', ' ')}: ${peakSignal.summary.slice(0, 160)}`,
				occurredAt: peakSignal.occurredAt
			})
		);
	}

	const highAiSignals = aiRiskSignals.filter((signal) => {
		const labels = parseRiskLabels(signal.labelsJson);
		return signal.severity >= 60 || labels.includes('relapse_intent') || labels.includes('withdrawal_risk');
	});
	if (highAiSignals.length > 0) {
		const peakSignal = highAiSignals.reduce((peak, signal) => (signal.severity > peak.severity ? signal : peak));
		const labels = parseRiskLabels(peakSignal.labelsJson);
		const points = clamp(Math.round(peakSignal.severity * 0.16) + (labels.includes('relapse_intent') ? 8 : 0), 0, 22);
		score += points;
		drivers.careTeam.push(
			driver({
				source: 'careTeam',
				label: 'AI conversation risk marker',
				points,
				evidence: labels.length > 0 ? labels.join(', ') : `Conversation severity ${peakSignal.severity}`,
				occurredAt: peakSignal.createdAt
			})
		);
	}

	const noShows = therapySessions.filter((session) => session.status === 'no_show');
	if (noShows.length > 0) {
		const recentNoShows = noShows.filter(
			(session) => now.getTime() - (session.scheduledStartAt ?? session.createdAt).getTime() <= THIRTY_DAYS_MS
		);
		if (recentNoShows.length > 0) {
			const points = clamp(6 + recentNoShows.length * 4, 0, 18);
			score += points;
			drivers.careTeam.push(
				driver({
					source: 'careTeam',
					label: 'Therapy session no-show',
					points,
					evidence: `${recentNoShows.length} no-show session${recentNoShows.length === 1 ? '' : 's'} in the last 30 days.`,
					occurredAt: recentNoShows[0].scheduledStartAt ?? recentNoShows[0].createdAt
				})
			);
		}
	}

	const recentHistorySignals = historySignals.filter(
		(signal) => now.getTime() - signal.createdAt.getTime() <= HISTORY_LOOKBACK_MS
	);
	if (recentHistorySignals.length > 0) {
		const parsedHistory = recentHistorySignals.map((signal) => ({
			...signal,
			...parseRiskWeight(signal.signalValueJson)
		}));
		const warningMarkers = parsedHistory.filter(
			(signal) => signal.signalType === 'relapse_trigger' || signal.signalType === 'warning_signal'
		);
		const weights = parsedHistory
			.map((signal) => signal.riskWeight)
			.filter((value): value is number => typeof value === 'number');
		const averageWeight =
			weights.length > 0 ? weights.reduce((sum, value) => sum + value, 0) / weights.length : 0;
		const points = clamp(Math.round(averageWeight * 0.08) + Math.min(8, warningMarkers.length * 2), 0, 16);
		if (points > 0) {
			const representative = warningMarkers[0] ?? parsedHistory[0];
			score += points;
			drivers.history.push(
				driver({
					source: 'history',
					label: 'Historical relapse markers',
					points,
					evidence:
						representative.label ??
						representative.summary ??
						`${warningMarkers.length} historical warning marker${warningMarkers.length === 1 ? '' : 's'} found.`,
					occurredAt: representative.createdAt
				})
			);
		}
	}

	if (openAlerts.length > 0) {
		const activeCritical = openAlerts.some((alert) => alert.level === 'critical');
		const points = activeCritical ? 12 : 8;
		score += points;
		drivers.engagementSignals.push(
			driver({
				source: 'engagementSignals',
				label: 'Open relapse risk alert',
				points,
				evidence: openAlerts[0].reason,
				occurredAt: openAlerts[0].createdAt
			})
		);
	}

	const likelihoodPercent = Math.round(clamp(score, 0, 100));
	const tier = scoreToTier(likelihoodPercent);
	const allDrivers = Object.values(drivers)
		.flat()
		.sort((left, right) => right.points - left.points);

	return {
		patientId: input.patientId,
		patientName: input.patientName ?? 'Patient',
		patientEmail: input.patientEmail ?? '',
		likelihoodPercent,
		tier,
		flagged: likelihoodPercent >= 40,
		trend,
		confidence: confidenceForInput(input, now),
		topDrivers: allDrivers.slice(0, 4),
		drivers,
		sourceCoverage: {
			riskScores: riskScores.length,
			checkins: checkins.length,
			associateObservations: associateObservations.length,
			aiRiskSignals: aiRiskSignals.length,
			clinicalSignals: clinicalSignals.length,
			historySignals: historySignals.length,
			therapySessions: therapySessions.length,
			noShowSessions: therapySessions.filter((session) => session.status === 'no_show').length,
			openAlerts: openAlerts.length
		},
		latestRiskScore: latestRisk?.score ?? null,
		latestRiskTier: latestRisk?.tier ?? null,
		generatedAt: now
	};
}

export async function buildRelapsePrediction(patientId: string): Promise<RelapsePrediction | null> {
	const now = new Date();
	const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);
	const oneHundredEightyDaysAgo = new Date(now.getTime() - HISTORY_LOOKBACK_MS);
	const [
		patientRecord,
		riskScores,
		checkins,
		associateObservations,
		aiRiskSignals,
		clinicalSignals,
		historySignals,
		therapySessions,
		openAlerts
	] = await Promise.all([
		db.query.user.findFirst({
			where: eq(user.id, patientId),
			columns: { id: true, name: true, email: true }
		}),
		db.query.riskScore.findMany({
			where: eq(riskScore.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 12
		}),
		db.query.patientCheckin.findMany({
			where: eq(patientCheckin.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 10
		}),
		db.query.associateObservation.findMany({
			where: and(eq(associateObservation.patientId, patientId), gte(associateObservation.createdAt, thirtyDaysAgo)),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 12
		}),
		db.query.aiRiskSignal.findMany({
			where: and(eq(aiRiskSignal.patientId, patientId), gte(aiRiskSignal.createdAt, thirtyDaysAgo)),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 12
		}),
		db.query.patientSignal.findMany({
			where: and(eq(patientSignal.patientId, patientId), gte(patientSignal.occurredAt, thirtyDaysAgo)),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.occurredAt)],
			limit: 16
		}),
		db.query.patientHistorySignal.findMany({
			where: and(eq(patientHistorySignal.patientId, patientId), gte(patientHistorySignal.createdAt, oneHundredEightyDaysAgo)),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 40
		}),
		db.query.therapySession.findMany({
			where: eq(therapySession.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 16
		}),
		db.query.riskAlert.findMany({
			where: and(eq(riskAlert.patientId, patientId), eq(riskAlert.status, 'open')),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 6
		})
	]);

	if (!patientRecord) {
		return null;
	}

	return computeRelapsePrediction({
		patientId,
		patientName: patientRecord.name,
		patientEmail: patientRecord.email,
		now,
		riskScores,
		checkins,
		associateObservations,
		aiRiskSignals,
		clinicalSignals,
		historySignals,
		therapySessions,
		openAlerts
	});
}

export async function buildRelapsePredictionsForPatients(patientIds: string[]) {
	const predictions = await Promise.all(patientIds.map((patientId) => buildRelapsePrediction(patientId)));
	return predictions.filter((prediction): prediction is RelapsePrediction => Boolean(prediction));
}

export async function ensureRelapsePredictionFollowUp(patientId: string) {
	const prediction = await buildRelapsePrediction(patientId);
	if (!prediction || prediction.likelihoodPercent < 60) {
		return {
			prediction,
			sessionId: null,
			created: false,
			updated: false
		};
	}

	const therapistAssignment = await db.query.therapistPatientAssignment.findFirst({
		where: eq(therapistPatientAssignment.patientId, patientId),
		orderBy: (table, { asc: orderAsc }) => [orderAsc(table.createdAt)]
	});

	if (!therapistAssignment) {
		return {
			prediction,
			sessionId: null,
			created: false,
			updated: false
		};
	}

	const tier = prediction.tier === 'critical' ? 'critical' : 'high';
	const topDriver = prediction.topDrivers[0]?.label ?? 'relapse prediction drivers';
	const followUp = await ensureRiskFollowUpSession({
		patientId,
		therapistId: therapistAssignment.therapistId,
		tier,
		reason:
			tier === 'critical'
				? `Critical 7-day relapse likelihood (${prediction.likelihoodPercent}%). Schedule urgent in-person review. Main driver: ${topDriver}.`
				: `High 7-day relapse likelihood (${prediction.likelihoodPercent}%). Schedule next available video call. Main driver: ${topDriver}.`
	});

	return {
		prediction,
		sessionId: followUp.sessionId,
		created: followUp.created,
		updated: followUp.updated
	};
}

export async function ensureRelapsePredictionFollowUpsForPatients(patientIds: string[]) {
	const results = await Promise.all(patientIds.map((patientId) => ensureRelapsePredictionFollowUp(patientId)));
	return results;
}
