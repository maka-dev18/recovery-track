import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	associateObservation,
	patientCheckin,
	patientRecoveryProfile,
	patientSignal,
	riskScore,
	therapistPatientAssignment,
	therapySession,
	user
} from '$lib/server/db/schema';
import { getTherapistPatientIds } from '$lib/server/relationships';

type SeriesPoint = {
	label: string;
	value: number;
};

export type PatientReportView = {
	patientId: string;
	patientName: string;
	patientEmail: string;
	riskTier: string | null;
	riskScore: number | null;
	riskTrend: 'rising' | 'falling' | 'steady';
	riskSeries: SeriesPoint[];
	moodSeries: SeriesPoint[];
	cravingSeries: SeriesPoint[];
	stressSeries: SeriesPoint[];
	observationSeries: SeriesPoint[];
	sessionCompletionRate: number;
	recentSignalCount: number;
	warningPatterns: string[];
	narrative: string;
	recoveryStage: string | null;
	goals: string[];
};

function dayLabel(date: Date) {
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function parseJsonArray(value: string | null | undefined): string[] {
	if (!value) return [];

	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is string => typeof entry === 'string');
	} catch {
		return [];
	}
}

function average(values: number[]) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveTrend(series: number[]): 'rising' | 'falling' | 'steady' {
	if (series.length < 2) return 'steady';
	const midpoint = Math.ceil(series.length / 2);
	const firstHalf = average(series.slice(0, midpoint));
	const secondHalf = average(series.slice(midpoint));
	const delta = secondHalf - firstHalf;

	if (delta >= 5) return 'rising';
	if (delta <= -5) return 'falling';
	return 'steady';
}

function summarizePatterns(args: {
	latestRiskTier: string | null;
	riskTrend: 'rising' | 'falling' | 'steady';
	cravingAverage: number;
	stressAverage: number;
	lowMoodCount: number;
	recentSignalCount: number;
	completedSessionRate: number;
}) {
	const patterns: string[] = [];

	if (args.latestRiskTier === 'critical' || args.latestRiskTier === 'high') {
		patterns.push('Recent relapse risk remains elevated.');
	}

	if (args.riskTrend === 'rising') {
		patterns.push('Risk trend is rising across the latest reporting window.');
	}

	if (args.cravingAverage >= 6) {
		patterns.push('Reported substance use urges remain persistently high.');
	}

	if (args.stressAverage >= 6) {
		patterns.push('Stress is a sustained pressure point.');
	}

	if (args.lowMoodCount >= 3) {
		patterns.push('Mood has dipped repeatedly in recent check-ins.');
	}

	if (args.recentSignalCount >= 4) {
		patterns.push('Multiple recent clinical signals need review.');
	}

	if (args.completedSessionRate < 0.5) {
		patterns.push('Session adherence may need intervention.');
	}

	if (patterns.length === 0) {
		patterns.push('No major relapse pattern spike is visible in the latest window.');
	}

	return patterns;
}

export async function buildPatientReport(patientId: string): Promise<PatientReportView | null> {
	const [
		patientRecord,
		riskRows,
		checkins,
		observations,
		sessions,
		signals,
		recoveryProfile
	] = await Promise.all([
		db.query.user.findFirst({
			where: eq(user.id, patientId),
			columns: {
				id: true,
				name: true,
				email: true
			}
		}),
		db.query.riskScore.findMany({
			where: eq(riskScore.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 12
		}),
		db.query.patientCheckin.findMany({
			where: eq(patientCheckin.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 12
		}),
		db.query.associateObservation.findMany({
			where: eq(associateObservation.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 10
		}),
		db.query.therapySession.findMany({
			where: eq(therapySession.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 10
		}),
		db.query.patientSignal.findMany({
			where: eq(patientSignal.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.occurredAt)],
			limit: 12
		}),
		db.query.patientRecoveryProfile.findFirst({
			where: eq(patientRecoveryProfile.patientId, patientId)
		})
	]);

	if (!patientRecord) {
		return null;
	}

	const riskSeries = [...riskRows]
		.reverse()
		.map((row) => ({ label: dayLabel(row.createdAt), value: row.score }));
	const moodSeries = [...checkins]
		.reverse()
		.map((row) => ({ label: dayLabel(row.createdAt), value: row.mood }));
	const cravingSeries = [...checkins]
		.reverse()
		.map((row) => ({ label: dayLabel(row.createdAt), value: row.craving }));
	const stressSeries = [...checkins]
		.reverse()
		.map((row) => ({ label: dayLabel(row.createdAt), value: row.stress }));
	const observationSeries = [...observations]
		.reverse()
		.map((row) => ({ label: dayLabel(row.createdAt), value: row.severity }));

	const completedSessions = sessions.filter((session) => session.status === 'completed').length;
	const sessionCompletionRate = sessions.length === 0 ? 1 : completedSessions / sessions.length;
	const latestRisk = riskRows[0] ?? null;
	const riskTrend = resolveTrend(riskSeries.map((point) => point.value));
	const cravingAverage = average(checkins.map((row) => row.craving));
	const stressAverage = average(checkins.map((row) => row.stress));
	const lowMoodCount = checkins.filter((row) => row.mood <= 2).length;
	const warningPatterns = summarizePatterns({
		latestRiskTier: latestRisk?.tier ?? null,
		riskTrend,
		cravingAverage,
		stressAverage,
		lowMoodCount,
		recentSignalCount: signals.length,
		completedSessionRate: sessionCompletionRate
	});

	const narrative = [
		latestRisk
			? `${patientRecord.name} is currently classified at ${latestRisk.tier} risk with a score of ${latestRisk.score}.`
			: `${patientRecord.name} does not yet have a recent calculated risk score.`,
		riskTrend === 'rising'
			? 'Trend analysis shows pressure increasing across the latest entries.'
			: riskTrend === 'falling'
				? 'Trend analysis shows the recovery profile stabilizing relative to the earlier window.'
				: 'Trend analysis is broadly stable across the latest entries.',
		cravingAverage >= 6 || stressAverage >= 6
			? 'Primary relapse drivers appear to be elevated substance use urges and stress.'
			: 'Recent self-report data does not show a concentrated spike in substance use urges or stress.',
		signals.length > 0
			? `${signals.length} recent clinical signals were captured from chats, observations, or therapy sessions.`
			: 'There are no recent structured clinical signals on file.'
	].join(' ');

	return {
		patientId,
		patientName: patientRecord.name,
		patientEmail: patientRecord.email,
		riskTier: latestRisk?.tier ?? null,
		riskScore: latestRisk?.score ?? null,
		riskTrend,
		riskSeries,
		moodSeries,
		cravingSeries,
		stressSeries,
		observationSeries,
		sessionCompletionRate,
		recentSignalCount: signals.length,
		warningPatterns,
		narrative,
		recoveryStage: recoveryProfile?.recoveryStage ?? null,
		goals: parseJsonArray(recoveryProfile?.primaryGoalsJson)
	};
}

export async function buildTherapistReports(therapistId: string) {
	const assignments = await db.query.therapistPatientAssignment.findMany({
		where: eq(therapistPatientAssignment.therapistId, therapistId),
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});

	const patientIds = assignments.map((assignment) => assignment.patientId);
	if (patientIds.length === 0) {
		return [];
	}

	const reports = await Promise.all(patientIds.map((patientId) => buildPatientReport(patientId)));
	return reports.filter((report): report is PatientReportView => Boolean(report));
}
