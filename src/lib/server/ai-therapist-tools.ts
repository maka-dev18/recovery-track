import { tool } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import {
	patientCheckin,
	patientHistoryFile,
	riskAlert,
	riskScore
} from '$lib/server/db/schema';
import { buildPatientRecommendations, listCopingActivity, listPatientBadges } from '$lib/server/engagement';
import { listRecentSignalsForPatient } from '$lib/server/patient-signals';
import { getPatientPersonalizationSnapshot } from '$lib/server/recovery-profile';
import { listUpcomingTherapySessionsForPatient } from '$lib/server/therapy-sessions';
import { listTherapistDirectConversationsForPatient } from '$lib/server/conversations';

const contextSectionsSchema = z.enum(['history', 'status', 'support', 'engagement']);
const contextToolInputSchema = z.object({
	sections: z
		.array(contextSectionsSchema)
		.min(1)
		.max(4)
		.optional()
		.describe('The patient-data sections to retrieve. Omit to fetch every section.'),
	limit: z
		.number()
		.int()
		.min(3)
		.max(12)
		.optional()
		.describe('How many recent items to include for list-based sections.'),
	includeMessages: z
		.boolean()
		.optional()
		.describe('Include recent therapist conversation snippets when support data is requested.')
});

function toIso(value: Date | null | undefined) {
	return value ? value.toISOString() : null;
}

function parseRiskFactors(raw: string) {
	try {
		const parsed = JSON.parse(raw) as Array<{ label?: unknown; points?: unknown }>;
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed
			.filter(
				(entry): entry is { label: string; points: number } =>
					typeof entry?.label === 'string' && typeof entry?.points === 'number'
			)
			.slice(0, 6);
	} catch {
		return [];
	}
}

async function getHistorySection(patientId: string, limit: number) {
	const [snapshot, files] = await Promise.all([
		getPatientPersonalizationSnapshot(patientId),
		db.query.patientHistoryFile.findMany({
			where: eq(patientHistoryFile.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit
		})
	]);

	return {
		patientName: snapshot.patientName,
		preferredName: snapshot.preferredName,
		rehabilitationJourneySummary: snapshot.journeySummary || null,
		recoveryStage: snapshot.recoveryStage,
		baselineRiskLevel: snapshot.baselineRiskLevel,
		triggers: snapshot.triggers,
		returnPatterns: snapshot.returnPatterns,
		protectiveFactors: snapshot.protectiveFactors,
		goals: snapshot.goals,
		supportPreferences: snapshot.supportPreferences,
		historySignalsSummary: snapshot.historySignalsSummary || null,
		uploadedHistoryNotes: snapshot.uploadedHistoryNotes || null,
		uploadedFiles: files.map((file) => ({
			fileName: file.fileName,
			parseStatus: file.parseStatus,
			parsedAt: toIso(file.parsedAt),
			uploadedAt: toIso(file.createdAt)
		}))
	};
}

async function getStatusSection(patientId: string, limit: number) {
	const [latestRisk, recentCheckins, recentAlerts, recentSignals, recommendations] = await Promise.all([
		db.query.riskScore.findFirst({
			where: eq(riskScore.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
		}),
		db.query.patientCheckin.findMany({
			where: eq(patientCheckin.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit
		}),
		db.query.riskAlert.findMany({
			where: eq(riskAlert.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit
		}),
		listRecentSignalsForPatient(patientId, limit),
		buildPatientRecommendations(patientId)
	]);

	return {
		latestRisk: latestRisk
			? {
					score: latestRisk.score,
					tier: latestRisk.tier,
					source: latestRisk.source,
					createdAt: toIso(latestRisk.createdAt),
					factors: parseRiskFactors(latestRisk.factors)
				}
			: null,
		recentCheckins: recentCheckins.map((checkin) => ({
			createdAt: toIso(checkin.createdAt),
			mood: checkin.mood,
			craving: checkin.craving,
			stress: checkin.stress,
			sleepHours: checkin.sleepHours,
			note: checkin.note
		})),
		recentAlerts: recentAlerts.map((alert) => ({
			level: alert.level,
			status: alert.status,
			reason: alert.reason,
			createdAt: toIso(alert.createdAt),
			acknowledgedAt: toIso(alert.acknowledgedAt),
			resolvedAt: toIso(alert.resolvedAt)
		})),
		recentClinicalSignals: recentSignals.map((signal) => ({
			source: signal.source,
			signalType: signal.signalType,
			status: signal.status,
			severity: signal.severity,
			confidence: signal.confidence,
			summary: signal.summary,
			occurredAt: toIso(signal.occurredAt)
		})),
		copingRecommendations: recommendations.slice(0, limit).map((recommendation) => ({
			title: recommendation.title,
			description: recommendation.description,
			reason: recommendation.reason,
			priority: recommendation.priority
		}))
	};
}

async function getSupportSection(patientId: string, limit: number, includeMessages: boolean) {
	const [upcomingSessions, therapistConversations] = await Promise.all([
		listUpcomingTherapySessionsForPatient(patientId, limit),
		listTherapistDirectConversationsForPatient(patientId)
	]);

	return {
		upcomingSessions: upcomingSessions.map((session) => ({
			therapistName: session.therapistName,
			mode: session.mode,
			status: session.status,
			requiresConfirmation: session.requiresConfirmation,
			sessionAt: toIso(session.sessionAt),
			summary: session.summary,
			automationReason: session.automationReason,
			meetingUrl: session.meetingUrl
		})),
		therapistConversations: therapistConversations.slice(0, limit).map((conversation) => ({
			therapistName: conversation.therapistName,
			therapistEmail: conversation.therapistEmail,
			lastMessageAt: toIso(conversation.lastMessageAt),
			lastMessagePreview: conversation.lastMessagePreview,
			recentMessages: includeMessages
				? conversation.messages.slice(-4).map((message) => ({
						role: message.role,
						senderName: message.senderName,
						content: message.content,
						createdAt: toIso(message.createdAt)
					}))
				: []
		}))
	};
}

async function getEngagementSection(patientId: string, limit: number) {
	const [badges, copingActivity] = await Promise.all([
		listPatientBadges(patientId),
		listCopingActivity(patientId, limit)
	]);

	return {
		totalRewardPoints: badges.totalPoints,
		badges: badges.badges.slice(0, limit).map((badge) => ({
			label: badge.label,
			description: badge.description,
			points: badge.points,
			awardedAt: toIso(badge.awardedAt)
		})),
		recentCopingActivity: copingActivity.map((activity) => ({
			title: activity.title,
			toolKey: activity.toolKey,
			note: activity.note,
			createdAt: toIso(activity.createdAt)
		}))
	};
}

async function getPatientContextBundle(args: {
	patientId: string;
	sections?: Array<z.infer<typeof contextSectionsSchema>>;
	limit?: number;
	includeMessages?: boolean;
}) {
	const selectedSections = new Set(args.sections ?? ['history', 'status', 'support', 'engagement']);
	const limit = args.limit ?? 6;
	const includeMessages = args.includeMessages ?? true;

	const [history, status, support, engagement] = await Promise.all([
		selectedSections.has('history') ? getHistorySection(args.patientId, limit) : null,
		selectedSections.has('status') ? getStatusSection(args.patientId, limit) : null,
		selectedSections.has('support') ? getSupportSection(args.patientId, limit, includeMessages) : null,
		selectedSections.has('engagement') ? getEngagementSection(args.patientId, limit) : null
	]);

	return {
		history,
		status,
		support,
		engagement
	};
}

export function buildPatientContextTools(patientId: string) {
	return {
		get_patient_context: tool({
			description:
				'Retrieve authoritative patient information from Recovery Track, including rehabilitation history, triggers, current status, therapist support context, and engagement data.',
			inputSchema: contextToolInputSchema,
			execute: async (input) => getPatientContextBundle({ patientId, ...input })
		}),
		get_patient_history_context: tool({
			description:
				'Retrieve the patient rehabilitation journey summary, known triggers, return-to-use patterns, protective factors, and uploaded history file status.',
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(3)
					.max(12)
					.optional()
					.describe('How many uploaded history files to include.')
			}),
			execute: async ({ limit }) => getHistorySection(patientId, limit ?? 6)
		}),
		get_patient_current_status: tool({
			description:
				'Retrieve the patient current risk status, recent check-ins, recent alerts, clinical signals, and coping recommendations.',
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(3)
					.max(12)
					.optional()
					.describe('How many recent items to include per status list.')
			}),
			execute: async ({ limit }) => getStatusSection(patientId, limit ?? 6)
		})
	};
}
