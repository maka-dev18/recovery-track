import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { parseOptionalDateTimeInput } from '$lib/server/clinical';
import { listTherapistDirectConversationsForPatient, sendTherapistDirectMessage } from '$lib/server/conversations';
import { buildPatientRecommendations, listCopingActivity, listPatientBadges, logCopingActivity, syncPatientBadges } from '$lib/server/engagement';
import { requireRole } from '$lib/server/authz';
import { aiConfig } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { aiMessage, aiSession, patientCheckin, riskAlert, riskScore } from '$lib/server/db/schema';
import { analyzeTextIntoPatientSignal, listRecentSignalsForPatient } from '$lib/server/patient-signals';
import { createManualCriticalAlert, recalculatePatientRisk } from '$lib/server/risk';
import {
	listUpcomingTherapySessionsForPatient,
	reschedulePatientTherapySession
} from '$lib/server/therapy-sessions';

function parseIntegerInRange(value: FormDataEntryValue | null, min: number, max: number): number | null {
	const parsed = Number.parseInt(value?.toString() ?? '', 10);

	if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
		return null;
	}

	return parsed;
}

export const load: PageServerLoad = async (event) => {
	const patientUser = requireRole(event, 'patient');
	await syncPatientBadges(patientUser.id);

	const latestRisk = await db.query.riskScore.findFirst({
		where: eq(riskScore.patientId, patientUser.id),
		orderBy: (table, { desc }) => [desc(table.createdAt)]
	});

	const recentCheckins = await db.query.patientCheckin.findMany({
		where: eq(patientCheckin.patientId, patientUser.id),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 14
	});

	const recentAlerts = await db.query.riskAlert.findMany({
		where: eq(riskAlert.patientId, patientUser.id),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 10
	});

	const latestTextSession = await db.query.aiSession.findFirst({
		where: and(eq(aiSession.patientId, patientUser.id), eq(aiSession.mode, 'text')),
		orderBy: (table, { desc }) => [desc(table.startedAt)]
	});

	const latestLiveSession = await db.query.aiSession.findFirst({
		where: and(eq(aiSession.patientId, patientUser.id), eq(aiSession.mode, 'live_voice')),
		orderBy: (table, { desc }) => [desc(table.startedAt)]
	});

	const chatMessages = latestTextSession
		? await db.query.aiMessage.findMany({
				where: eq(aiMessage.sessionId, latestTextSession.id),
				orderBy: (table, { desc }) => [desc(table.createdAt)],
				limit: 40
			})
		: [];

	const therapistConversations = await listTherapistDirectConversationsForPatient(patientUser.id);
	const upcomingSessions = await listUpcomingTherapySessionsForPatient(patientUser.id, 8);
	const rewardSummary = await listPatientBadges(patientUser.id);
	const copingRecommendations = await buildPatientRecommendations(patientUser.id);
	const copingActivity = await listCopingActivity(patientUser.id, 10);
	const recentSignals = await listRecentSignalsForPatient(patientUser.id, 10);

	return {
		patientName: patientUser.name,
		latestRisk,
		recentCheckins,
		recentAlerts,
		aiChatSession: latestTextSession
			? {
					id: latestTextSession.id,
					status: latestTextSession.status,
					startedAt: latestTextSession.startedAt
				}
			: null,
		aiLiveSession: latestLiveSession
			? {
					id: latestLiveSession.id,
					status: latestLiveSession.status,
					startedAt: latestLiveSession.startedAt
				}
			: null,
		aiChatMessages: chatMessages.map((message) => ({
			id: message.id,
			role: message.role,
			content: message.content,
			modality: message.modality,
			createdAt: message.createdAt
		})),
		therapistConversations,
		upcomingSessions,
		rewardSummary,
		copingRecommendations,
		copingActivity,
		recentSignals,
		aiFeatures: {
			chatEnabled: aiConfig.chatEnabled,
			liveVoiceEnabled: aiConfig.liveVoiceEnabled
		}
	};
};

export const actions: Actions = {
	submitCheckin: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const mood = parseIntegerInRange(formData.get('mood'), 1, 5);
		const craving = parseIntegerInRange(formData.get('craving'), 0, 10);
		const stress = parseIntegerInRange(formData.get('stress'), 0, 10);
		const sleepHours = parseIntegerInRange(formData.get('sleepHours'), 0, 12);
		const note = formData.get('note')?.toString().trim() || null;

		if (mood === null || craving === null || stress === null || sleepHours === null) {
			return fail(400, {
				message: 'Provide valid check-in values before submitting.',
				mode: 'checkin' as const
			});
		}

		const checkinId = crypto.randomUUID();

		await db.insert(patientCheckin).values({
			id: checkinId,
			patientId: patientUser.id,
			mood,
			craving,
			stress,
			sleepHours,
			note
		});

		if (note) {
			await analyzeTextIntoPatientSignal({
				patientId: patientUser.id,
				text: note,
				source: 'checkin',
				originLabel: 'Patient check-in note',
				detectedByUserId: patientUser.id,
				extraPayload: {
					checkinId,
					mood,
					craving,
					stress,
					sleepHours
				}
			});
		}

		const recalculation = await recalculatePatientRisk({
			patientId: patientUser.id,
			source: 'checkin',
			checkinId,
			triggeredByUserId: patientUser.id
		});
		await syncPatientBadges(patientUser.id);

		return {
			success: `Check-in submitted. Current risk tier: ${recalculation.tier}.`,
			mode: 'checkin' as const
		};
	},
	requestHumanSupport: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const reason =
			formData.get('reason')?.toString().trim() ||
			'I need to speak with a human therapist as soon as possible.';

		await createManualCriticalAlert({
			patientId: patientUser.id,
			triggeredByUserId: patientUser.id,
			reason
		});

		return {
			success: 'Your therapist team has been alerted for immediate follow-up.',
			mode: 'human-support' as const
		};
	},
	rescheduleSession: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const sessionId = formData.get('sessionId')?.toString() ?? '';
		const sessionAt = parseOptionalDateTimeInput(formData.get('sessionAt')?.toString());

		if (!sessionId || !sessionAt) {
			return fail(400, {
				message: 'Choose a valid date and time for the session.',
				mode: 'reschedule-session' as const
			});
		}

		try {
			await reschedulePatientTherapySession({
				sessionId,
				patientId: patientUser.id,
				sessionAt
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not request a new session time.',
				mode: 'reschedule-session' as const
			});
		}

		return {
			success: 'New session time requested. Your therapist will see it on their schedule.',
			mode: 'reschedule-session' as const
		};
	},
	updateCheckin: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const checkinId = formData.get('checkinId')?.toString() ?? '';
		const mood = parseIntegerInRange(formData.get('mood'), 1, 5);
		const craving = parseIntegerInRange(formData.get('craving'), 0, 10);
		const stress = parseIntegerInRange(formData.get('stress'), 0, 10);
		const sleepHours = parseIntegerInRange(formData.get('sleepHours'), 0, 12);
		const note = formData.get('note')?.toString().trim() || null;

		if (!checkinId || mood === null || craving === null || stress === null || sleepHours === null) {
			return fail(400, {
				message: 'Provide valid check-in values to update this record.',
				mode: 'update-checkin' as const
			});
		}

		const existingCheckin = await db.query.patientCheckin.findFirst({
			where: and(eq(patientCheckin.id, checkinId), eq(patientCheckin.patientId, patientUser.id))
		});

		if (!existingCheckin) {
			return fail(404, {
				message: 'Check-in not found for your account.',
				mode: 'update-checkin' as const
			});
		}

		await db
			.update(patientCheckin)
			.set({ mood, craving, stress, sleepHours, note })
			.where(eq(patientCheckin.id, checkinId));

		if (note) {
			await analyzeTextIntoPatientSignal({
				patientId: patientUser.id,
				text: note,
				source: 'checkin',
				originLabel: 'Patient check-in note update',
				detectedByUserId: patientUser.id,
				extraPayload: {
					checkinId,
					mood,
					craving,
					stress,
					sleepHours
				}
			});
		}

		const recalculation = await recalculatePatientRisk({
			patientId: patientUser.id,
			source: 'checkin',
			checkinId,
			triggeredByUserId: patientUser.id
		});
		await syncPatientBadges(patientUser.id);

		return {
			success: `Check-in updated. Current risk tier: ${recalculation.tier}.`,
			mode: 'update-checkin' as const
		};
	},
	deleteCheckin: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const checkinId = formData.get('checkinId')?.toString() ?? '';

		if (!checkinId) {
			return fail(400, {
				message: 'Check-in identifier is missing.',
				mode: 'delete-checkin' as const
			});
		}

		const existingCheckin = await db.query.patientCheckin.findFirst({
			where: and(eq(patientCheckin.id, checkinId), eq(patientCheckin.patientId, patientUser.id))
		});

		if (!existingCheckin) {
			return fail(404, {
				message: 'Check-in not found for your account.',
				mode: 'delete-checkin' as const
			});
		}

		await db.delete(patientCheckin).where(eq(patientCheckin.id, checkinId));

		const recalculation = await recalculatePatientRisk({
			patientId: patientUser.id,
			source: 'manual',
			triggeredByUserId: patientUser.id
		});
		await syncPatientBadges(patientUser.id);

		return {
			success: `Check-in deleted. Current risk tier: ${recalculation.tier}.`,
			mode: 'delete-checkin' as const
		};
	},
	sendTherapistMessage: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const therapistId = formData.get('therapistId')?.toString() ?? '';
		const content = formData.get('content')?.toString() ?? '';

		if (!therapistId) {
			return fail(400, {
				message: 'Choose your assigned therapist before sending a message.',
				mode: 'send-therapist-message' as const
			});
		}

		try {
			const result = await sendTherapistDirectMessage({
				therapistId,
				patientId: patientUser.id,
				senderUserId: patientUser.id,
				senderRole: 'patient',
				content
			});

			await analyzeTextIntoPatientSignal({
				patientId: patientUser.id,
				text: content,
				source: 'conversation',
				originLabel: 'Patient therapist chat',
				threadId: result.threadId,
				messageId: result.messageId,
				detectedByUserId: patientUser.id,
				extraPayload: {
					channel: 'therapist_direct',
					therapistId
				}
			});

			await recalculatePatientRisk({
				patientId: patientUser.id,
				source: 'chat',
				triggeredByUserId: patientUser.id
			});
			await syncPatientBadges(patientUser.id);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not send the therapist message.',
				mode: 'send-therapist-message' as const
			});
		}

		return {
			success: 'Message sent to your therapist.',
			mode: 'send-therapist-message' as const
		};
	},
	logCopingActivity: async (event) => {
		const patientUser = requireRole(event, 'patient');
		const formData = await event.request.formData();
		const toolKey = formData.get('toolKey')?.toString().trim() ?? '';
		const title = formData.get('title')?.toString().trim() ?? '';
		const note = formData.get('note')?.toString().trim() ?? '';

		if (!toolKey || !title) {
			return fail(400, {
				message: 'Choose a coping recommendation before logging it.',
				mode: 'log-coping-activity' as const
			});
		}

		await logCopingActivity({
			patientId: patientUser.id,
			toolKey,
			title,
			note: note || null
		});

		return {
			success: 'Coping activity logged and added to your recovery streak.',
			mode: 'log-coping-activity' as const
		};
	}
};
