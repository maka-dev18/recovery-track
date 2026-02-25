import { fail } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { requireRole } from '$lib/server/authz';
import { db } from '$lib/server/db';
import {
	associateObservation,
	associatePatientAssignment,
	riskScore
} from '$lib/server/db/schema';
import { associateHasPatientAssignment } from '$lib/server/relationships';
import { recalculatePatientRisk } from '$lib/server/risk';

const OBSERVATION_CATEGORIES = ['mood', 'behavior', 'attendance', 'substance_signs', 'safety'] as const;

function isObservationCategory(value: string): value is (typeof OBSERVATION_CATEGORIES)[number] {
	return OBSERVATION_CATEGORIES.includes(value as (typeof OBSERVATION_CATEGORIES)[number]);
}

export const load: PageServerLoad = async (event) => {
	const associateUser = requireRole(event, 'associate');

	const linkedAssignments = await db.query.associatePatientAssignment.findMany({
		where: eq(associatePatientAssignment.associateId, associateUser.id),
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

	const patientIds = linkedAssignments.map((assignment) => assignment.patientId);

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

	const recentObservations = await db.query.associateObservation.findMany({
		where: eq(associateObservation.associateId, associateUser.id),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 20,
		with: {
			patient: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	return {
		observationCategories: OBSERVATION_CATEGORIES,
		linkedPatients: linkedAssignments
			.filter((assignment) => assignment.patient)
			.map((assignment) => ({
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				relationshipLabel: assignment.relationshipLabel,
				latestRisk: latestRiskByPatient.get(assignment.patientId)
			})),
		recentObservations: recentObservations
			.filter((observation) => observation.patient)
			.map((observation) => ({
				id: observation.id,
				patientName: observation.patient!.name,
				category: observation.category,
				severity: observation.severity,
				note: observation.note,
				createdAt: observation.createdAt
			}))
	};
};

export const actions: Actions = {
	submitObservation: async (event) => {
		const associateUser = requireRole(event, 'associate');
		const formData = await event.request.formData();
		const patientId = formData.get('patientId')?.toString() ?? '';
		const category = formData.get('category')?.toString() ?? '';
		const severity = Number.parseInt(formData.get('severity')?.toString() ?? '', 10);
		const note = formData.get('note')?.toString().trim() ?? '';

		if (!patientId || !isObservationCategory(category)) {
			return fail(400, {
				message: 'Select a patient and valid observation category.',
				mode: 'submit-observation' as const
			});
		}

		if (!Number.isFinite(severity) || severity < 1 || severity > 5) {
			return fail(400, {
				message: 'Severity must be between 1 and 5.',
				mode: 'submit-observation' as const
			});
		}

		if (note.length < 6) {
			return fail(400, {
				message: 'Add a short note describing the observation.',
				mode: 'submit-observation' as const
			});
		}

		if (!(await associateHasPatientAssignment(associateUser.id, patientId))) {
			return fail(403, {
				message: 'You can only log observations for linked patients.',
				mode: 'submit-observation' as const
			});
		}

		const observationId = crypto.randomUUID();
		await db.insert(associateObservation).values({
			id: observationId,
			associateId: associateUser.id,
			patientId,
			category,
			severity,
			note
		});

		const recalculation = await recalculatePatientRisk({
			patientId,
			source: 'observation',
			observationId,
			triggeredByUserId: associateUser.id
		});

		return {
			success: `Observation logged. Updated patient risk tier: ${recalculation.tier}.`,
			mode: 'submit-observation' as const
		};
	},
	updateObservation: async (event) => {
		const associateUser = requireRole(event, 'associate');
		const formData = await event.request.formData();
		const observationId = formData.get('observationId')?.toString() ?? '';
		const category = formData.get('category')?.toString() ?? '';
		const severity = Number.parseInt(formData.get('severity')?.toString() ?? '', 10);
		const note = formData.get('note')?.toString().trim() ?? '';

		if (!observationId || !isObservationCategory(category)) {
			return fail(400, {
				message: 'Select a valid observation category for this record.',
				mode: 'update-observation' as const
			});
		}

		if (!Number.isFinite(severity) || severity < 1 || severity > 5) {
			return fail(400, {
				message: 'Severity must be between 1 and 5.',
				mode: 'update-observation' as const
			});
		}

		if (note.length < 6) {
			return fail(400, {
				message: 'Add a short note describing the observation.',
				mode: 'update-observation' as const
			});
		}

		const existingObservation = await db.query.associateObservation.findFirst({
			where: and(
				eq(associateObservation.id, observationId),
				eq(associateObservation.associateId, associateUser.id)
			)
		});

		if (!existingObservation) {
			return fail(404, {
				message: 'Observation not found for your account.',
				mode: 'update-observation' as const
			});
		}

		if (!(await associateHasPatientAssignment(associateUser.id, existingObservation.patientId))) {
			return fail(403, {
				message: 'You can only edit observations for linked patients.',
				mode: 'update-observation' as const
			});
		}

		await db
			.update(associateObservation)
			.set({ category, severity, note })
			.where(eq(associateObservation.id, observationId));

		const recalculation = await recalculatePatientRisk({
			patientId: existingObservation.patientId,
			source: 'observation',
			observationId,
			triggeredByUserId: associateUser.id
		});

		return {
			success: `Observation updated. Updated patient risk tier: ${recalculation.tier}.`,
			mode: 'update-observation' as const
		};
	},
	deleteObservation: async (event) => {
		const associateUser = requireRole(event, 'associate');
		const formData = await event.request.formData();
		const observationId = formData.get('observationId')?.toString() ?? '';

		if (!observationId) {
			return fail(400, {
				message: 'Observation identifier is missing.',
				mode: 'delete-observation' as const
			});
		}

		const existingObservation = await db.query.associateObservation.findFirst({
			where: and(
				eq(associateObservation.id, observationId),
				eq(associateObservation.associateId, associateUser.id)
			)
		});

		if (!existingObservation) {
			return fail(404, {
				message: 'Observation not found for your account.',
				mode: 'delete-observation' as const
			});
		}

		await db.delete(associateObservation).where(eq(associateObservation.id, observationId));

		const recalculation = await recalculatePatientRisk({
			patientId: existingObservation.patientId,
			source: 'manual',
			triggeredByUserId: associateUser.id
		});

		return {
			success: `Observation deleted. Updated patient risk tier: ${recalculation.tier}.`,
			mode: 'delete-observation' as const
		};
	}
};
