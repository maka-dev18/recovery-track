import { fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { requireRole } from '$lib/server/authz';
import { aiConfig } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import { aiMessage, aiSession, patientCheckin, riskAlert, riskScore } from '$lib/server/db/schema';
import { createManualCriticalAlert, recalculatePatientRisk } from '$lib/server/risk';

function parseIntegerInRange(value: FormDataEntryValue | null, min: number, max: number): number | null {
	const parsed = Number.parseInt(value?.toString() ?? '', 10);

	if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
		return null;
	}

	return parsed;
}

export const load: PageServerLoad = async (event) => {
	const patientUser = requireRole(event, 'patient');

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
				orderBy: (table, { asc }) => [asc(table.createdAt)],
				limit: 40
			})
		: [];

	return {
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

		const recalculation = await recalculatePatientRisk({
			patientId: patientUser.id,
			source: 'checkin',
			checkinId,
			triggeredByUserId: patientUser.id
		});

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

		const recalculation = await recalculatePatientRisk({
			patientId: patientUser.id,
			source: 'checkin',
			checkinId,
			triggeredByUserId: patientUser.id
		});

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

		return {
			success: `Check-in deleted. Current risk tier: ${recalculation.tier}.`,
			mode: 'delete-checkin' as const
		};
	}
};
