import { fail } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import {
	parseDelimitedStringList,
	parseOptionalDateTimeInput,
	therapySessionModeValues,
	type TherapySessionMode,
	therapySessionRiskLevelValues,
	type TherapySessionRiskLevel,
	therapySessionStatusValues,
	type TherapySessionStatus
} from '$lib/server/clinical';
import { listTherapistAssociateConversationsForTherapist, sendTherapistAssociateMessage } from '$lib/server/care-team';
import { listTherapistDirectConversationsForTherapist, sendTherapistDirectMessage } from '$lib/server/conversations';
import { syncPatientBadges } from '$lib/server/engagement';
import { requireRole } from '$lib/server/authz';
import { db } from '$lib/server/db';
import {
	associateObservation,
	patientCheckin,
	riskAlert,
	riskScore,
	therapistPatientAssignment
} from '$lib/server/db/schema';
import { analyzeTextIntoPatientSignal, listRecentSignalsForTherapist } from '$lib/server/patient-signals';
import { buildTherapistReports } from '$lib/server/reporting';
import { getTherapistPatientIds, therapistHasPatientAssignment } from '$lib/server/relationships';
import {
	buildRelapsePredictionsForPatients,
	ensureRelapsePredictionFollowUpsForPatients
} from '$lib/server/relapse-prediction';
import { recalculatePatientRisk } from '$lib/server/risk';
import {
	confirmSuggestedTherapySession,
	listTherapySessionsForTherapist,
	listUpcomingTherapySessionsForTherapist,
	rescheduleTherapySession,
	saveTherapySessionNote
} from '$lib/server/therapy-sessions';

function parseRiskFactors(raw: string | null | undefined) {
	if (!raw) {
		return [];
	}

	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed
			.filter(
				(item): item is { label: string; points: number } =>
					typeof item?.label === 'string' && typeof item?.points === 'number'
			)
			.slice(0, 6);
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async (event) => {
	const therapistUser = requireRole(event, 'therapist');
	const patientIds = await getTherapistPatientIds(therapistUser.id);

	const assignments = await db.query.therapistPatientAssignment.findMany({
		where: eq(therapistPatientAssignment.therapistId, therapistUser.id),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
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

	const riskSnapshots =
		patientIds.length > 0
			? await db.query.riskScore.findMany({
					where: inArray(riskScore.patientId, patientIds),
					orderBy: (table, { desc }) => [desc(table.createdAt)]
				})
			: [];

	const latestRiskByPatient = new Map<string, (typeof riskSnapshots)[number]>();
	for (const snapshot of riskSnapshots) {
		if (!latestRiskByPatient.has(snapshot.patientId)) {
			latestRiskByPatient.set(snapshot.patientId, snapshot);
		}
	}

	const openAlerts =
		patientIds.length > 0
			? await db.query.riskAlert.findMany({
					where: and(
						inArray(riskAlert.patientId, patientIds),
						inArray(riskAlert.status, ['open', 'acknowledged'])
					),
					orderBy: (table, { desc }) => [desc(table.createdAt)],
					with: {
						patient: {
							columns: {
								id: true,
								name: true
							}
						},
						riskScore: {
							columns: {
								score: true,
								tier: true,
								factors: true
							}
						}
					}
				})
			: [];

	const openAlertCountByPatient = new Map<string, number>();
	for (const alert of openAlerts) {
		const current = openAlertCountByPatient.get(alert.patientId) ?? 0;
		openAlertCountByPatient.set(alert.patientId, current + 1);
	}

	const recentCheckins =
		patientIds.length > 0
			? await db.query.patientCheckin.findMany({
					where: inArray(patientCheckin.patientId, patientIds),
					orderBy: (table, { desc }) => [desc(table.createdAt)],
					limit: 20,
					with: {
						patient: {
							columns: {
								name: true
							}
						}
					}
				})
			: [];

	const recentObservations =
		patientIds.length > 0
			? await db.query.associateObservation.findMany({
					where: inArray(associateObservation.patientId, patientIds),
					orderBy: (table, { desc }) => [desc(table.createdAt)],
					limit: 20,
					with: {
						patient: {
							columns: {
								name: true
							}
						},
						associate: {
							columns: {
								name: true
							}
						}
					}
				})
			: [];

	const relapsePredictions = await buildRelapsePredictionsForPatients(patientIds);
	const patientsNeedingScheduledFollowUp = relapsePredictions
		.filter((prediction) => prediction.likelihoodPercent >= 60)
		.map((prediction) => prediction.patientId);
	await ensureRelapsePredictionFollowUpsForPatients(patientsNeedingScheduledFollowUp);

	const chatConversations = await listTherapistDirectConversationsForTherapist(therapistUser.id);
	const therapySessions = await listTherapySessionsForTherapist(therapistUser.id);
	const upcomingSessions = await listUpcomingTherapySessionsForTherapist(therapistUser.id, 16);
	const associateConversations = await listTherapistAssociateConversationsForTherapist(therapistUser.id);
	const patientReports = await buildTherapistReports(therapistUser.id);
	const recentSignals = await listRecentSignalsForTherapist(therapistUser.id, 40);
	const relapsePredictionByPatient = new Map(
		relapsePredictions.map((prediction) => [prediction.patientId, prediction])
	);
	const relapseWatchlist = [...relapsePredictions]
		.filter((prediction) => prediction.flagged)
		.sort((left, right) => right.likelihoodPercent - left.likelihoodPercent);

	return {
		therapySessionModeValues,
		therapySessionStatusValues,
		therapySessionRiskLevelValues,
		caseload: assignments
			.filter((assignment) => assignment.patient)
			.map((assignment) => ({
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				latestRisk: latestRiskByPatient.get(assignment.patientId),
				openAlertCount: openAlertCountByPatient.get(assignment.patientId) ?? 0,
				relapsePrediction: relapsePredictionByPatient.get(assignment.patientId) ?? null
			})),
		openAlerts: openAlerts
			.filter((alert) => alert.patient)
			.map((alert) => ({
				id: alert.id,
				patientId: alert.patientId,
				patientName: alert.patient!.name,
				status: alert.status,
				level: alert.level,
				reason: alert.reason,
				riskScore: alert.riskScore?.score ?? null,
				riskFactors: parseRiskFactors(alert.details ?? alert.riskScore?.factors),
				createdAt: alert.createdAt
			})),
		recentCheckins: recentCheckins
			.filter((checkin) => checkin.patient)
			.map((checkin) => ({
				id: checkin.id,
				patientName: checkin.patient!.name,
				mood: checkin.mood,
				craving: checkin.craving,
				stress: checkin.stress,
				sleepHours: checkin.sleepHours,
				note: checkin.note,
				createdAt: checkin.createdAt
			})),
		recentObservations: recentObservations
			.filter((observation) => observation.patient)
			.map((observation) => ({
				id: observation.id,
				patientName: observation.patient!.name,
				associateName: observation.associate?.name ?? 'Associate',
				category: observation.category,
				severity: observation.severity,
				note: observation.note,
				createdAt: observation.createdAt
			})),
		chatConversations,
		therapySessions,
		upcomingSessions,
		associateConversations,
		patientReports: patientReports.map((report) => ({
			...report,
			relapsePrediction: relapsePredictionByPatient.get(report.patientId) ?? null
		})),
		relapsePredictions,
		relapseWatchlist,
		recentSignals
	};
};

export const actions: Actions = {
	acknowledgeAlert: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
		const formData = await event.request.formData();
		const alertId = formData.get('alertId')?.toString() ?? '';

		if (!alertId) {
			return fail(400, {
				message: 'Alert identifier is missing.',
				mode: 'acknowledge-alert' as const
			});
		}

		const alert = await db.query.riskAlert.findFirst({
			where: eq(riskAlert.id, alertId)
		});

		if (!alert) {
			return fail(404, {
				message: 'Alert not found.',
				mode: 'acknowledge-alert' as const
			});
		}

		if (!(await therapistHasPatientAssignment(therapistUser.id, alert.patientId))) {
			return fail(403, {
				message: 'You can only manage alerts for assigned patients.',
				mode: 'acknowledge-alert' as const
			});
		}

		if (alert.status === 'resolved') {
			return fail(400, {
				message: 'This alert is already resolved.',
				mode: 'acknowledge-alert' as const
			});
		}

		await db
			.update(riskAlert)
			.set({
				status: 'acknowledged',
				acknowledgedAt: new Date(),
				acknowledgedByUserId: therapistUser.id
			})
			.where(eq(riskAlert.id, alertId));

		return {
			success: 'Alert acknowledged.',
			mode: 'acknowledge-alert' as const
		};
	},
	resolveAlert: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
		const formData = await event.request.formData();
		const alertId = formData.get('alertId')?.toString() ?? '';
		const resolutionNote = formData.get('resolutionNote')?.toString().trim() ?? '';

		if (!alertId) {
			return fail(400, {
				message: 'Alert identifier is missing.',
				mode: 'resolve-alert' as const
			});
		}

		if (resolutionNote.length < 6) {
			return fail(400, {
				message: 'Provide a short intervention note before resolving.',
				mode: 'resolve-alert' as const
			});
		}

		const alert = await db.query.riskAlert.findFirst({
			where: eq(riskAlert.id, alertId)
		});

		if (!alert) {
			return fail(404, {
				message: 'Alert not found.',
				mode: 'resolve-alert' as const
			});
		}

		if (!(await therapistHasPatientAssignment(therapistUser.id, alert.patientId))) {
			return fail(403, {
				message: 'You can only manage alerts for assigned patients.',
				mode: 'resolve-alert' as const
			});
		}

		await db
			.update(riskAlert)
			.set({
				status: 'resolved',
				resolvedAt: new Date(),
				resolvedByUserId: therapistUser.id,
				resolutionNote,
				acknowledgedByUserId: alert.acknowledgedByUserId ?? therapistUser.id,
				acknowledgedAt: alert.acknowledgedAt ?? new Date()
			})
			.where(eq(riskAlert.id, alertId));

		return {
			success: 'Alert resolved and documented.',
			mode: 'resolve-alert' as const
		};
	},
	sendMessage: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
		const formData = await event.request.formData();
		const patientId = formData.get('patientId')?.toString() ?? '';
		const content = formData.get('content')?.toString() ?? '';

		if (!patientId) {
			return fail(400, {
				message: 'Select a patient before sending a message.',
				mode: 'send-message' as const
			});
		}

		try {
			const result = await sendTherapistDirectMessage({
				therapistId: therapistUser.id,
				patientId,
				senderUserId: therapistUser.id,
				senderRole: 'therapist',
				content
			});

			await analyzeTextIntoPatientSignal({
				patientId,
				text: content,
				source: 'conversation',
				originLabel: 'Therapist message',
				threadId: result.threadId,
				messageId: result.messageId,
				detectedByUserId: therapistUser.id,
				extraPayload: {
					channel: 'therapist_direct',
					therapistId: therapistUser.id
				}
			});

			await recalculatePatientRisk({
				patientId,
				source: 'chat',
				triggeredByUserId: therapistUser.id
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not send the patient message.',
				mode: 'send-message' as const
			});
		}

		return {
			success: 'Message sent to patient.',
			mode: 'send-message' as const
		};
	},
	sendAssociateMessage: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
		const formData = await event.request.formData();
		const patientId = formData.get('patientId')?.toString() ?? '';
		const associateId = formData.get('associateId')?.toString() ?? '';
		const content = formData.get('content')?.toString() ?? '';

		if (!patientId || !associateId) {
			return fail(400, {
				message: 'Choose a patient and associate before sending a message.',
				mode: 'send-associate-message' as const
			});
		}

		try {
			const result = await sendTherapistAssociateMessage({
				therapistId: therapistUser.id,
				associateId,
				patientId,
				senderUserId: therapistUser.id,
				senderRole: 'therapist',
				content
			});

			await analyzeTextIntoPatientSignal({
				patientId,
				text: content,
				source: 'conversation',
				originLabel: 'Therapist associate chat',
				threadId: result.threadId,
				messageId: result.messageId,
				detectedByUserId: therapistUser.id,
				extraPayload: {
					channel: 'associate_direct',
					associateId,
					therapistId: therapistUser.id
				}
			});

			await recalculatePatientRisk({
				patientId,
				source: 'chat',
				triggeredByUserId: therapistUser.id
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not send the associate message.',
				mode: 'send-associate-message' as const
			});
		}

		return {
			success: 'Message sent to associate.',
			mode: 'send-associate-message' as const
		};
	},
	saveSessionNote: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
		const formData = await event.request.formData();
		const sessionId = formData.get('sessionId')?.toString() ?? '';
		const patientId = formData.get('patientId')?.toString() ?? '';
		const mode = formData.get('sessionMode')?.toString() ?? '';
		const status = formData.get('sessionStatus')?.toString() ?? '';
		const riskLevelValue = formData.get('riskLevel')?.toString() ?? '';
		const summary = formData.get('summary')?.toString() ?? '';
		const sessionAt = parseOptionalDateTimeInput(formData.get('sessionAt')?.toString());

		if (!patientId) {
			return fail(400, {
				message: 'Select an assigned patient for the session note.',
				mode: 'save-session-note' as const
			});
		}

		if (!therapySessionModeValues.includes(mode as (typeof therapySessionModeValues)[number])) {
			return fail(400, {
				message: 'Choose a valid therapy session mode.',
				mode: 'save-session-note' as const
			});
		}

		if (!therapySessionStatusValues.includes(status as (typeof therapySessionStatusValues)[number])) {
			return fail(400, {
				message: 'Choose a valid therapy session status.',
				mode: 'save-session-note' as const
			});
		}

		const validatedMode = mode as TherapySessionMode;
		const validatedStatus = status as TherapySessionStatus;
		const validatedRiskLevel =
			riskLevelValue && therapySessionRiskLevelValues.includes(riskLevelValue as TherapySessionRiskLevel)
				? (riskLevelValue as TherapySessionRiskLevel)
				: null;

		try {
			const result = await saveTherapySessionNote({
				sessionId: sessionId || undefined,
				patientId,
				therapistId: therapistUser.id,
				mode: validatedMode,
				status: validatedStatus,
				sessionAt,
				summary,
				notes: {
					presentation: formData.get('presentation')?.toString() ?? '',
					interventions: parseDelimitedStringList(formData.get('interventions')?.toString(), {
						maxItems: 10,
						maxLength: 120
					}),
					response: formData.get('response')?.toString() ?? '',
					homework: parseDelimitedStringList(formData.get('homework')?.toString(), {
						maxItems: 10,
						maxLength: 120
					}),
					riskLevel: validatedRiskLevel,
					nextSteps: formData.get('nextSteps')?.toString() ?? ''
				}
			});

			const detailText = [
				summary,
				formData.get('presentation')?.toString() ?? '',
				formData.get('response')?.toString() ?? '',
				formData.get('nextSteps')?.toString() ?? '',
				formData.get('interventions')?.toString() ?? '',
				formData.get('homework')?.toString() ?? '',
				riskLevelValue ? `Risk level documented as ${riskLevelValue}.` : ''
			]
				.filter(Boolean)
				.join('\n');

			await analyzeTextIntoPatientSignal({
				patientId,
				text: detailText,
				source: 'therapy_session',
				originLabel: 'Therapy session note',
				therapySessionId: result.sessionId,
				detectedByUserId: therapistUser.id,
				extraPayload: {
					sessionMode: validatedMode,
					sessionStatus: validatedStatus,
					riskLevel: validatedRiskLevel
				}
			});

			await recalculatePatientRisk({
				patientId,
				source: 'therapy_session',
				triggeredByUserId: therapistUser.id
			});
			await syncPatientBadges(patientId);

			return {
				success: result.updated ? 'Session note updated.' : 'Session note created.',
				mode: 'save-session-note' as const
			};
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not save the session note.',
				mode: 'save-session-note' as const
			});
		}
	},
	confirmSuggestedSession: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
		const formData = await event.request.formData();
		const sessionId = formData.get('sessionId')?.toString() ?? '';
		const sessionAt = parseOptionalDateTimeInput(formData.get('sessionAt')?.toString());

		if (!sessionId) {
			return fail(400, {
				message: 'Session identifier is required.',
				mode: 'confirm-suggested-session' as const
			});
		}

		try {
			await confirmSuggestedTherapySession({
				sessionId,
				therapistId: therapistUser.id,
				sessionAt
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not confirm this session.',
				mode: 'confirm-suggested-session' as const
			});
		}

		return {
			success: 'Suggested session confirmed on your calendar.',
			mode: 'confirm-suggested-session' as const
		};
	},
	rescheduleSession: async (event) => {
		const therapistUser = requireRole(event, 'therapist');
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
			await rescheduleTherapySession({
				sessionId,
				therapistId: therapistUser.id,
				sessionAt
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not reschedule the session.',
				mode: 'reschedule-session' as const
			});
		}

		return {
			success: 'Session moved on your calendar.',
			mode: 'reschedule-session' as const
		};
	}
};
