import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { associatePatientAssignment, therapistPatientAssignment } from '$lib/server/db/schema';

export async function getTherapistPatientIds(therapistId: string): Promise<string[]> {
	const assignments = await db
		.select({ patientId: therapistPatientAssignment.patientId })
		.from(therapistPatientAssignment)
		.where(eq(therapistPatientAssignment.therapistId, therapistId));

	return assignments.map((assignment) => assignment.patientId);
}

export async function getAssociatePatientIds(associateId: string): Promise<string[]> {
	const assignments = await db
		.select({ patientId: associatePatientAssignment.patientId })
		.from(associatePatientAssignment)
		.where(eq(associatePatientAssignment.associateId, associateId));

	return assignments.map((assignment) => assignment.patientId);
}

export async function therapistHasPatientAssignment(
	therapistId: string,
	patientId: string
): Promise<boolean> {
	const assignment = await db.query.therapistPatientAssignment.findFirst({
		where: and(
			eq(therapistPatientAssignment.therapistId, therapistId),
			eq(therapistPatientAssignment.patientId, patientId)
		)
	});

	return Boolean(assignment);
}

export async function associateHasPatientAssignment(
	associateId: string,
	patientId: string
): Promise<boolean> {
	const assignment = await db.query.associatePatientAssignment.findFirst({
		where: and(
			eq(associatePatientAssignment.associateId, associateId),
			eq(associatePatientAssignment.patientId, patientId)
		)
	});

	return Boolean(assignment);
}
