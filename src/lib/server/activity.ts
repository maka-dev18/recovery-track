import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	adminOutreachLog,
	associatePatientAssignment,
	therapistPatientAssignment,
	user,
	userPresence
} from '$lib/server/db/schema';

export async function touchUserPresence(args: {
	userId: string;
	role: string | null | undefined;
	path: string;
}) {
	const now = new Date();

	await db
		.insert(userPresence)
		.values({
			userId: args.userId,
			roleSnapshot: args.role ?? null,
			lastPath: args.path.slice(0, 255),
			lastActiveAt: now
		})
		.onConflictDoUpdate({
			target: userPresence.userId,
			set: {
				roleSnapshot: args.role ?? null,
				lastPath: args.path.slice(0, 255),
				lastActiveAt: now,
				updatedAt: now
			}
		});
}

export async function listInactivePatients(options?: { inactiveAfterDays?: number }) {
	const inactiveAfterDays = options?.inactiveAfterDays ?? 3;
	const cutoff = new Date(Date.now() - inactiveAfterDays * 24 * 60 * 60 * 1000);

	const patients = await db.query.user.findMany({
		where: eq(user.role, 'patient'),
		orderBy: (table, { asc }) => [asc(table.name)]
	});

	if (patients.length === 0) {
		return [];
	}

	const patientIds = patients.map((entry) => entry.id);
	const presenceRows = await db.query.userPresence.findMany({
		where: inArray(userPresence.userId, patientIds)
	});
	const therapistAssignments = await db.query.therapistPatientAssignment.findMany({
		where: inArray(therapistPatientAssignment.patientId, patientIds),
		with: {
			therapist: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});
	const associateAssignments = await db.query.associatePatientAssignment.findMany({
		where: inArray(associatePatientAssignment.patientId, patientIds),
		with: {
			associate: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});
	const outreachRows = await db.query.adminOutreachLog.findMany({
		where: inArray(adminOutreachLog.patientId, patientIds),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
		with: {
			targetUser: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			associate: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});

	const presenceByUserId = new Map(presenceRows.map((row) => [row.userId, row]));
	const therapistByPatientId = new Map(
		therapistAssignments
			.filter((assignment) => assignment.therapist)
			.map((assignment) => [assignment.patientId, assignment.therapist!])
	);
	const associatesByPatientId = new Map<string, Array<(typeof associateAssignments)[number]['associate']>>();
	for (const assignment of associateAssignments) {
		if (!assignment.associate) continue;
		const existing = associatesByPatientId.get(assignment.patientId) ?? [];
		existing.push(assignment.associate);
		associatesByPatientId.set(assignment.patientId, existing);
	}

	const latestOutreachByPatientId = new Map<string, (typeof outreachRows)[number]>();
	for (const outreach of outreachRows) {
		if (!latestOutreachByPatientId.has(outreach.patientId)) {
			latestOutreachByPatientId.set(outreach.patientId, outreach);
		}
	}

	return patients
		.map((patient) => {
			const presence = presenceByUserId.get(patient.id) ?? null;
			const lastActiveAt = presence?.lastActiveAt ?? null;
			const inactive =
				lastActiveAt === null || lastActiveAt.getTime() < cutoff.getTime();

			return {
				patientId: patient.id,
				patientName: patient.name,
				patientEmail: patient.email,
				lastActiveAt,
				lastPath: presence?.lastPath ?? null,
				inactiveDays:
					lastActiveAt === null
						? null
						: Math.max(
								1,
								Math.floor((Date.now() - lastActiveAt.getTime()) / (24 * 60 * 60 * 1000))
						  ),
				therapist: therapistByPatientId.get(patient.id) ?? null,
				associates: associatesByPatientId.get(patient.id) ?? [],
				latestOutreach: latestOutreachByPatientId.get(patient.id) ?? null,
				isInactive: inactive
			};
		})
		.filter((entry) => entry.isInactive)
		.sort((left, right) => {
			const leftTime = left.lastActiveAt?.getTime() ?? 0;
			const rightTime = right.lastActiveAt?.getTime() ?? 0;
			return leftTime - rightTime || left.patientName.localeCompare(right.patientName);
		});
}

export async function logAdminOutreach(args: {
	patientId: string;
	adminUserId: string;
	channel: 'call_patient' | 'call_associate' | 'email_patient' | 'email_associate';
	targetUserId?: string | null;
	associateId?: string | null;
	note?: string | null;
}) {
	const outreachId = crypto.randomUUID();
	await db.insert(adminOutreachLog).values({
		id: outreachId,
		patientId: args.patientId,
		adminUserId: args.adminUserId,
		channel: args.channel,
		targetUserId: args.targetUserId ?? null,
		associateId: args.associateId ?? null,
		note: args.note?.trim() ? args.note.trim().slice(0, 1_000) : null
	});

	return outreachId;
}

export async function getRecentOutreachLogs(limit = 20) {
	return db.query.adminOutreachLog.findMany({
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
		limit,
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			targetUser: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			associate: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			adminUser: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});
}
