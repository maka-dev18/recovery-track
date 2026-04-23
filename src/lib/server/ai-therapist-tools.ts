import { tool } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import {
	adminOutreachLog,
	associateObservation,
	associatePatientAssignment,
	conversationThread,
	patientCheckin,
	patientHistoryFile,
	patientHistorySignal,
	patientSignal,
	riskAlert,
	riskScore,
	therapistPatientAssignment,
	therapySession
} from '$lib/server/db/schema';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { buildPatientRecommendations, listCopingActivity, listPatientBadges } from '$lib/server/engagement';
import { listRecentSignalsForPatient } from '$lib/server/patient-signals';
import { getPatientPersonalizationSnapshot } from '$lib/server/recovery-profile';
import { listUpcomingTherapySessionsForPatient } from '$lib/server/therapy-sessions';
import { listTherapistDirectConversationsForPatient } from '$lib/server/conversations';

const contextSectionsSchema = z.enum(['history', 'status', 'support', 'careTeam', 'engagement']);
const contextToolInputSchema = z.object({
	sections: z
		.array(contextSectionsSchema)
		.min(1)
		.max(5)
		.optional()
		.describe('The patient-data sections to retrieve. Omit to fetch every section.'),
	limit: z
		.number()
		.int()
		.min(3)
		.max(20)
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

function parseJsonObject(raw: string | null | undefined) {
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function compactText(value: string | null | undefined, maxLength = 500) {
	if (!value) {
		return null;
	}

	return deidentifyText(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function getHistorySection(patientId: string, limit: number) {
	const [snapshot, files, historySignals] = await Promise.all([
		getPatientPersonalizationSnapshot(patientId),
		db.query.patientHistoryFile.findMany({
			where: eq(patientHistoryFile.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit
		}),
		db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: limit * 4
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
			extractionModel: file.extractionModel,
			extractedAt: toIso(file.extractedAt),
			parsedAt: toIso(file.parsedAt),
			uploadedAt: toIso(file.createdAt),
			extractedData: parseJsonObject(file.extractionJson)
		})),
		extractedSignals: historySignals.map((signal) => ({
			signalType: signal.signalType,
			confidence: signal.confidence,
			occurredAt: toIso(signal.occurredAt),
			createdAt: toIso(signal.createdAt),
			value: parseJsonObject(signal.signalValueJson)
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
								content: compactText(message.content, 400),
								createdAt: toIso(message.createdAt)
							}))
						: []
		}))
	};
}

async function getCareTeamSection(patientId: string, limit: number, includeMessages: boolean) {
	const [
		therapistAssignments,
		associateAssignments,
		associateObservations,
		careThreads,
		recentTherapySessions,
		sourceSignals,
		outreachLogs
	] = await Promise.all([
		db.query.therapistPatientAssignment.findMany({
			where: eq(therapistPatientAssignment.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			with: {
				therapist: {
					columns: { id: true, name: true, email: true }
				},
				assignedByUser: {
					columns: { id: true, name: true, email: true }
				}
			}
		}),
		db.query.associatePatientAssignment.findMany({
			where: eq(associatePatientAssignment.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			with: {
				associate: {
					columns: { id: true, name: true, email: true }
				},
				assignedByUser: {
					columns: { id: true, name: true, email: true }
				}
			}
		}),
		db.query.associateObservation.findMany({
			where: eq(associateObservation.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit,
			with: {
				associate: {
					columns: { id: true, name: true, email: true }
				}
			}
		}),
		db.query.conversationThread.findMany({
			where: eq(conversationThread.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.lastMessageAt), orderDesc(table.createdAt)],
			limit,
			with: {
				therapist: {
					columns: { id: true, name: true, email: true }
				},
				associate: {
					columns: { id: true, name: true, email: true }
				},
				createdByUser: {
					columns: { id: true, name: true, email: true }
				},
				messages: {
					orderBy: (table, { desc: orderDesc }) => [orderDesc(table.occurredAt)],
					limit: includeMessages ? 6 : 0,
					with: {
						senderUser: {
							columns: { id: true, name: true, email: true, role: true }
						}
					}
				}
			}
		}),
		db.query.therapySession.findMany({
			where: eq(therapySession.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [
				orderDesc(table.scheduledStartAt),
				orderDesc(table.createdAt)
			],
			limit,
			with: {
				therapist: {
					columns: { id: true, name: true, email: true }
				},
				createdByUser: {
					columns: { id: true, name: true, email: true }
				},
				confirmedByUser: {
					columns: { id: true, name: true, email: true }
				}
			}
		}),
		db.query.patientSignal.findMany({
			where: eq(patientSignal.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.occurredAt), orderDesc(table.createdAt)],
			limit,
			with: {
				detectedByUser: {
					columns: { id: true, name: true, email: true, role: true }
				},
				thread: {
					columns: { id: true, channel: true, therapistId: true, associateId: true }
				},
				therapySession: {
					columns: { id: true, status: true, mode: true, scheduledStartAt: true }
				}
			}
		}),
		db.query.adminOutreachLog.findMany({
			where: eq(adminOutreachLog.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit,
			with: {
				adminUser: {
					columns: { id: true, name: true, email: true }
				},
				associate: {
					columns: { id: true, name: true, email: true }
				},
				targetUser: {
					columns: { id: true, name: true, email: true, role: true }
				}
			}
		})
	]);

	return {
		therapists: therapistAssignments.map((assignment) => ({
			therapistId: assignment.therapistId,
			name: assignment.therapist?.name ?? null,
			email: assignment.therapist?.email ?? null,
			assignedAt: toIso(assignment.createdAt),
			assignedBy: assignment.assignedByUser?.name ?? null
		})),
		associates: associateAssignments.map((assignment) => ({
			associateId: assignment.associateId,
			name: assignment.associate?.name ?? null,
			email: assignment.associate?.email ?? null,
			relationshipLabel: assignment.relationshipLabel,
			assignedAt: toIso(assignment.createdAt),
			assignedBy: assignment.assignedByUser?.name ?? null
		})),
		associateObservations: associateObservations.map((observation) => ({
			associateName: observation.associate?.name ?? null,
			associateEmail: observation.associate?.email ?? null,
			category: observation.category,
			severity: observation.severity,
			note: compactText(observation.note, 500),
			createdAt: toIso(observation.createdAt)
		})),
		careTeamConversations: careThreads.map((thread) => ({
			threadId: thread.id,
			channel: thread.channel,
			status: thread.status,
			subject: thread.subject,
			therapistName: thread.therapist?.name ?? null,
			associateName: thread.associate?.name ?? null,
			createdBy: thread.createdByUser?.name ?? null,
			lastMessageAt: toIso(thread.lastMessageAt),
			recentMessages: includeMessages
				? thread.messages
						.slice()
						.reverse()
						.map((message) => ({
							role: message.role,
							senderName: message.senderUser?.name ?? null,
							senderRole: message.senderUser?.role ?? null,
							content: compactText(message.content, 400),
							occurredAt: toIso(message.occurredAt)
						}))
				: []
		})),
		therapySessions: recentTherapySessions.map((session) => ({
			sessionId: session.id,
			therapistName: session.therapist?.name ?? null,
			mode: session.mode,
			status: session.status,
			sessionType: session.sessionType,
			requiresConfirmation: session.requiresConfirmation,
			durationMinutes: session.durationMinutes,
			scheduledStartAt: toIso(session.scheduledStartAt),
			startedAt: toIso(session.startedAt),
			endedAt: toIso(session.endedAt),
			summary: compactText(session.summary, 500),
			notes: compactText(session.notes, 500),
			automationReason: compactText(session.automationReason, 300),
			createdBy: session.createdByUser?.name ?? null,
			confirmedBy: session.confirmedByUser?.name ?? null
		})),
		sourceSignals: sourceSignals.map((signal) => ({
			source: signal.source,
			signalType: signal.signalType,
			status: signal.status,
			severity: signal.severity,
			confidence: signal.confidence,
			summary: compactText(signal.summary, 500),
			payload: parseJsonObject(signal.payloadJson),
			detectedByName: signal.detectedByUser?.name ?? null,
			detectedByRole: signal.detectedByUser?.role ?? null,
			threadChannel: signal.thread?.channel ?? null,
			therapySessionStatus: signal.therapySession?.status ?? null,
			occurredAt: toIso(signal.occurredAt),
			createdAt: toIso(signal.createdAt)
		})),
		adminOutreach: outreachLogs.map((log) => ({
			channel: log.channel,
			status: log.status,
			note: compactText(log.note, 300),
			adminName: log.adminUser?.name ?? null,
			associateName: log.associate?.name ?? null,
			targetName: log.targetUser?.name ?? null,
			targetRole: log.targetUser?.role ?? null,
			createdAt: toIso(log.createdAt)
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
	const selectedSections = new Set(
		args.sections ?? ['history', 'status', 'support', 'careTeam', 'engagement']
	);
	const limit = args.limit ?? 10;
	const includeMessages = args.includeMessages ?? true;

	const [history, status, support, careTeam, engagement] = await Promise.all([
		selectedSections.has('history') ? getHistorySection(args.patientId, limit) : null,
		selectedSections.has('status') ? getStatusSection(args.patientId, limit) : null,
		selectedSections.has('support') ? getSupportSection(args.patientId, limit, includeMessages) : null,
		selectedSections.has('careTeam') ? getCareTeamSection(args.patientId, limit, includeMessages) : null,
		selectedSections.has('engagement') ? getEngagementSection(args.patientId, limit) : null
	]);

	return {
		sourceCoverage: {
			historyFiles: history?.uploadedFiles.length ?? 0,
			historySignals: history?.extractedSignals.length ?? 0,
			checkins: status?.recentCheckins.length ?? 0,
			riskAlerts: status?.recentAlerts.length ?? 0,
			riskSignals: status?.recentClinicalSignals.length ?? 0,
			therapistConversations: support?.therapistConversations.length ?? 0,
			upcomingSessions: support?.upcomingSessions.length ?? 0,
			assignedTherapists: careTeam?.therapists.length ?? 0,
			assignedAssociates: careTeam?.associates.length ?? 0,
			associateObservations: careTeam?.associateObservations.length ?? 0,
			careTeamThreads: careTeam?.careTeamConversations.length ?? 0,
			therapySessions: careTeam?.therapySessions.length ?? 0,
			sourceSignals: careTeam?.sourceSignals.length ?? 0,
			adminOutreach: careTeam?.adminOutreach.length ?? 0,
			engagementItems:
				(engagement?.badges.length ?? 0) + (engagement?.recentCopingActivity.length ?? 0)
		},
		history,
		status,
		support,
		careTeam,
		engagement
	};
}

export { getPatientContextBundle };

export async function buildPatientContextEvidenceSummary(patientId: string) {
	const bundle = await getPatientContextBundle({
		patientId,
		limit: 6,
		includeMessages: false
	});

	return JSON.stringify(bundle.sourceCoverage);
}

export function buildPatientContextTools(patientId: string) {
	return {
		get_patient_context: tool({
			description:
				'Retrieve authoritative patient information from Recovery Track, including rehabilitation history, current risk, patient check-ins, associate observations, therapist conversations, care-team activity, clinical signals, and engagement data. Use this before making patient-specific relapse or care analysis.',
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
		}),
		get_patient_care_team_context: tool({
			description:
				'Retrieve associate observations, assigned associates, assigned therapists, therapist sessions, care-team conversations, source signals, and outreach logs for the patient.',
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(3)
					.max(20)
					.optional()
					.describe('How many recent care-team items to include.'),
				includeMessages: z
					.boolean()
					.optional()
					.describe('Include recent care-team conversation snippets.')
			}),
			execute: async ({ limit, includeMessages }) =>
				getCareTeamSection(patientId, limit ?? 10, includeMessages ?? true)
		})
	};
}
