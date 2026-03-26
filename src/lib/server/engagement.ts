import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	aiSession,
	aiMessage,
	conversationMessage,
	conversationThread,
	patientBadge,
	patientCheckin,
	patientCopingLog,
	patientHistorySignal,
	riskAlert,
	riskScore,
	therapySession
} from '$lib/server/db/schema';

type BadgeDefinition = {
	label: string;
	description: string;
	points: number;
};

const BADGE_DEFINITIONS: Record<string, BadgeDefinition> = {
	first_step: {
		label: 'First Step',
		description: 'Completed the first recovery check-in after leaving rehab.',
		points: 25
	},
	steady_streak: {
		label: 'Steady Streak',
		description: 'Completed at least 7 recovery check-ins.',
		points: 60
	},
	open_channel: {
		label: 'Open Channel',
		description: 'Reached out through AI or therapist chat at least 3 times.',
		points: 40
	},
	coping_builder: {
		label: 'Coping Builder',
		description: 'Logged at least 3 coping actions or grounding activities.',
		points: 45
	},
	session_ready: {
		label: 'Session Ready',
		description: 'Completed a follow-up therapy session in the platform.',
		points: 55
	}
};

export type CopingRecommendation = {
	toolKey: string;
	title: string;
	description: string;
	reason: string;
	priority: 'gentle' | 'important' | 'urgent';
};

async function ensureBadge(patientId: string, badgeKey: keyof typeof BADGE_DEFINITIONS) {
	const existing = await db.query.patientBadge.findFirst({
		where: and(eq(patientBadge.patientId, patientId), eq(patientBadge.badgeKey, badgeKey))
	});

	if (existing) {
		return existing.id;
	}

	const badge = BADGE_DEFINITIONS[badgeKey];
	const badgeId = crypto.randomUUID();
	await db.insert(patientBadge).values({
		id: badgeId,
		patientId,
		badgeKey,
		label: badge.label,
		description: badge.description,
		points: badge.points
	});

	return badgeId;
}

export async function syncPatientBadges(patientId: string) {
	const [
		checkinCountResult,
		copingCountResult,
		completedSessionCountResult,
		chatMessageCountResult,
		therapistMessageCountResult
	] = await Promise.all([
		db.select({ value: count() }).from(patientCheckin).where(eq(patientCheckin.patientId, patientId)),
		db.select({ value: count() }).from(patientCopingLog).where(eq(patientCopingLog.patientId, patientId)),
		db
			.select({ value: count() })
			.from(therapySession)
			.where(and(eq(therapySession.patientId, patientId), eq(therapySession.status, 'completed'))),
		db
			.select({ value: count() })
			.from(aiMessage)
			.leftJoin(aiSession, eq(aiSession.id, aiMessage.sessionId))
			.where(and(eq(aiSession.patientId, patientId), eq(aiMessage.role, 'user'))),
		db
			.select({ value: count() })
			.from(conversationMessage)
			.leftJoin(conversationThread, eq(conversationThread.id, conversationMessage.threadId))
			.where(
				and(
					eq(conversationThread.patientId, patientId),
					eq(conversationThread.channel, 'therapist_direct')
				)
			)
	]);

	const checkinCount = checkinCountResult[0]?.value ?? 0;
	const copingCount = copingCountResult[0]?.value ?? 0;
	const completedSessionCount = completedSessionCountResult[0]?.value ?? 0;
	const totalOpenMessages =
		(chatMessageCountResult[0]?.value ?? 0) + (therapistMessageCountResult[0]?.value ?? 0);

	if (checkinCount >= 1) {
		await ensureBadge(patientId, 'first_step');
	}

	if (checkinCount >= 7) {
		await ensureBadge(patientId, 'steady_streak');
	}

	if (totalOpenMessages >= 3) {
		await ensureBadge(patientId, 'open_channel');
	}

	if (copingCount >= 3) {
		await ensureBadge(patientId, 'coping_builder');
	}

	if (completedSessionCount >= 1) {
		await ensureBadge(patientId, 'session_ready');
	}
}

export async function listPatientBadges(patientId: string) {
	const badges = await db.query.patientBadge.findMany({
		where: eq(patientBadge.patientId, patientId),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.awardedAt)]
	});

	const totalPoints = badges.reduce((sum, badge) => sum + badge.points, 0);
	return {
		totalPoints,
		badges
	};
}

export async function logCopingActivity(args: {
	patientId: string;
	toolKey: string;
	title: string;
	note?: string | null;
}) {
	const copingId = crypto.randomUUID();
	await db.insert(patientCopingLog).values({
		id: copingId,
		patientId: args.patientId,
		toolKey: args.toolKey,
		title: args.title,
		note: args.note?.trim() ? args.note.trim().slice(0, 500) : null
	});

	await syncPatientBadges(args.patientId);
	return copingId;
}

export async function listCopingActivity(patientId: string, limit = 12) {
	return db.query.patientCopingLog.findMany({
		where: eq(patientCopingLog.patientId, patientId),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
		limit
	});
}

export async function buildPatientRecommendations(patientId: string): Promise<CopingRecommendation[]> {
	const [latestRisk, latestCheckin, latestAlert, recentHistorySignals] = await Promise.all([
		db.query.riskScore.findFirst({
			where: eq(riskScore.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
		}),
		db.query.patientCheckin.findFirst({
			where: eq(patientCheckin.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
		}),
		db.query.riskAlert.findFirst({
			where: eq(riskAlert.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
		}),
		db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 6
		})
	]);

	const recommendations: CopingRecommendation[] = [];
	const latestTier = latestRisk?.tier ?? 'low';

	if (latestTier === 'critical' || latestTier === 'high') {
		recommendations.push({
			toolKey: 'reach_support_now',
			title: 'Reach a human support contact now',
			description: 'Message your therapist or request a live check-in immediately.',
			reason: 'Recent risk signals are elevated.',
			priority: 'urgent'
		});
	}

	if ((latestCheckin?.stress ?? 0) >= 7 || (latestCheckin?.craving ?? 0) >= 7) {
		recommendations.push({
			toolKey: 'grounding_reset',
			title: 'Do a 10-minute grounding reset',
			description: 'Slow breathing, cold water, short walk, then write the trigger in one sentence.',
			reason: 'High stress or craving was reported.',
			priority: 'important'
		});
	}

	if ((latestCheckin?.sleepHours ?? 8) <= 5) {
		recommendations.push({
			toolKey: 'sleep_recovery',
			title: 'Protect tonight’s sleep routine',
			description: 'Reduce stimulation, hydrate, avoid caffeine late, and plan a wind-down time.',
			reason: 'Sleep disruption is a current relapse pressure.',
			priority: 'important'
		});
	}

	const historyHasSupportGap = recentHistorySignals.some((signal) => {
		try {
			const payload = JSON.parse(signal.signalValueJson) as { summary?: string };
			return /missed session|dropout|noncompliant/i.test(payload.summary ?? '');
		} catch {
			return false;
		}
	});

	if (historyHasSupportGap || latestAlert?.level === 'moderate') {
		recommendations.push({
			toolKey: 'support_meeting',
			title: 'Plan one support touchpoint today',
			description: 'Schedule a sponsor call, meeting, or therapist message before the day ends.',
			reason: 'Support consistency reduces relapse pressure.',
			priority: 'important'
		});
	}

	recommendations.push({
		toolKey: 'daily_structure',
		title: 'Keep a simple recovery structure',
		description: 'Eat, hydrate, move, and check in with one trusted person.',
		reason: 'Routine protects recovery even on lower-risk days.',
		priority: recommendations.length === 0 ? 'gentle' : 'important'
	});

	const unique = new Map<string, CopingRecommendation>();
	for (const recommendation of recommendations) {
		if (!unique.has(recommendation.toolKey)) {
			unique.set(recommendation.toolKey, recommendation);
		}
	}

	return [...unique.values()].slice(0, 5);
}
