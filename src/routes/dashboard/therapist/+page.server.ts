import { fail } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { requireRole } from '$lib/server/authz';
import { db } from '$lib/server/db';
import {
	associateObservation,
	patientCheckin,
	riskAlert,
	riskScore,
	therapistPatientAssignment
} from '$lib/server/db/schema';
import { getTherapistPatientIds, therapistHasPatientAssignment } from '$lib/server/relationships';

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
								tier: true
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

	return {
		caseload: assignments
			.filter((assignment) => assignment.patient)
			.map((assignment) => ({
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				latestRisk: latestRiskByPatient.get(assignment.patientId),
				openAlertCount: openAlertCountByPatient.get(assignment.patientId) ?? 0
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
			}))
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
	}
};
