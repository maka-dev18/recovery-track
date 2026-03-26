import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APIError } from 'better-auth/api';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getRecentOutreachLogs, listInactivePatients, logAdminOutreach } from '$lib/server/activity';
import { auth } from '$lib/server/auth';
import { requireRole } from '$lib/server/authz';
import { aiConfig } from '$lib/server/config/ai';
import { db } from '$lib/server/db';
import {
	associatePatientAssignment,
	associateProfile,
	patientHistoryFile,
	patientProfile,
	therapistPatientAssignment,
	therapistProfile,
	user,
	userCredentialPolicy
} from '$lib/server/db/schema';
import { APP_ROLES, isAppRole, type AppRole } from '$lib/roles';
import { setUserMustChangePassword } from '$lib/server/user-security';
import { getRecentJobs } from '$lib/server/jobs/queue';

const dashboardRoles = [...APP_ROLES];

function normalizeEmail(value: string) {
	return value.trim().toLowerCase();
}

function resolveErrorMessage(error: unknown, fallback: string) {
	if (error instanceof APIError) {
		return error.message || fallback;
	}

	if (error instanceof Error && error.message) {
		return error.message;
	}

	return fallback;
}

async function createRoleProfile(userId: string, role: AppRole) {
	if (role === 'patient') {
		await db.insert(patientProfile).values({ userId }).onConflictDoNothing();
		return;
	}

	if (role === 'therapist') {
		await db.insert(therapistProfile).values({ userId }).onConflictDoNothing();
		return;
	}

	if (role === 'associate') {
		await db.insert(associateProfile).values({ userId }).onConflictDoNothing();
	}
}

async function syncRoleArtifacts(userId: string, role: AppRole) {
	if (role !== 'patient') {
		await db.delete(patientProfile).where(eq(patientProfile.userId, userId));
		await db.delete(therapistPatientAssignment).where(eq(therapistPatientAssignment.patientId, userId));
		await db.delete(associatePatientAssignment).where(eq(associatePatientAssignment.patientId, userId));
	}

	if (role !== 'therapist') {
		await db.delete(therapistProfile).where(eq(therapistProfile.userId, userId));
		await db
			.delete(therapistPatientAssignment)
			.where(eq(therapistPatientAssignment.therapistId, userId));
	}

	if (role !== 'associate') {
		await db.delete(associateProfile).where(eq(associateProfile.userId, userId));
		await db
			.delete(associatePatientAssignment)
			.where(eq(associatePatientAssignment.associateId, userId));
	}

	await createRoleProfile(userId, role);
}

async function loadAdminWorkspace() {
	const users = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			createdAt: user.createdAt,
			mustChangePassword: userCredentialPolicy.mustChangePassword
		})
		.from(user)
		.leftJoin(userCredentialPolicy, eq(userCredentialPolicy.userId, user.id))
		.orderBy(desc(user.createdAt));

	const managedUsers = users
		.filter((entry) => isAppRole(entry.role))
		.map((entry) => ({
			id: entry.id,
			name: entry.name,
			email: entry.email,
			role: entry.role,
			createdAt: entry.createdAt,
			mustChangePassword: entry.mustChangePassword ?? false
		}));

	const therapistAssignments = await db.query.therapistPatientAssignment.findMany({
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		with: {
			therapist: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			assignedByUser: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	const associateAssignments = await db.query.associatePatientAssignment.findMany({
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		with: {
			associate: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			assignedByUser: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	const historyFiles = await db.query.patientHistoryFile.findMany({
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		limit: 25,
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			uploadedByUser: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	const queueJobs = await getRecentJobs(25);
	const inactivePatients = await listInactivePatients({ inactiveAfterDays: 3 });
	const outreachLogs = await getRecentOutreachLogs(30);

	return {
		users: managedUsers,
		roles: dashboardRoles,
		therapists: managedUsers.filter((entry) => entry.role === 'therapist'),
		patients: managedUsers.filter((entry) => entry.role === 'patient'),
		associates: managedUsers.filter((entry) => entry.role === 'associate'),
		stats: {
			totalUsers: managedUsers.length,
			therapists: managedUsers.filter((entry) => entry.role === 'therapist').length,
			patients: managedUsers.filter((entry) => entry.role === 'patient').length,
			associates: managedUsers.filter((entry) => entry.role === 'associate').length,
			forcedPasswordResets: managedUsers.filter((entry) => entry.mustChangePassword).length
		},
		therapistAssignments: therapistAssignments
			.filter((entry) => entry.therapist && entry.patient)
			.map((entry) => ({
				therapistId: entry.therapistId,
				patientId: entry.patientId,
				therapistName: entry.therapist!.name,
				patientName: entry.patient!.name,
				assignedBy: entry.assignedByUser?.name ?? 'System',
				createdAt: entry.createdAt
			})),
		associateAssignments: associateAssignments
			.filter((entry) => entry.associate && entry.patient)
			.map((entry) => ({
				associateId: entry.associateId,
				patientId: entry.patientId,
				associateName: entry.associate!.name,
				patientName: entry.patient!.name,
				relationshipLabel: entry.relationshipLabel,
				assignedBy: entry.assignedByUser?.name ?? 'System',
				createdAt: entry.createdAt
			})),
		historyFiles: historyFiles
			.filter((entry) => entry.patient)
			.map((entry) => ({
				id: entry.id,
				patientId: entry.patientId,
				patientName: entry.patient!.name,
				patientEmail: entry.patient!.email,
				fileName: entry.fileName,
				mimeType: entry.mimeType,
				byteSize: entry.byteSize,
				parseStatus: entry.parseStatus,
				parseError: entry.parseError,
				uploadedBy: entry.uploadedByUser?.name ?? 'System',
				createdAt: entry.createdAt,
				parsedAt: entry.parsedAt
			})),
		queueJobs,
		inactivePatients: inactivePatients.map((entry) => ({
			patientId: entry.patientId,
			patientName: entry.patientName,
			patientEmail: entry.patientEmail,
			lastActiveAt: entry.lastActiveAt,
			lastPath: entry.lastPath,
			inactiveDays: entry.inactiveDays,
			therapistName: entry.therapist?.name ?? null,
			therapistEmail: entry.therapist?.email ?? null,
			associates: entry.associates.map((associate) => ({
				id: associate.id,
				name: associate.name,
				email: associate.email
			})),
			latestOutreach: entry.latestOutreach
				? {
						channel: entry.latestOutreach.channel,
						createdAt: entry.latestOutreach.createdAt,
						targetName: entry.latestOutreach.targetUser?.name ?? entry.latestOutreach.associate?.name ?? null
					}
				: null
		})),
		outreachLogs: outreachLogs.map((entry) => ({
			id: entry.id,
			patientName: entry.patient?.name ?? 'Patient',
			channel: entry.channel,
			adminName: entry.adminUser?.name ?? 'Admin',
			targetName: entry.targetUser?.name ?? entry.associate?.name ?? 'Patient',
			note: entry.note,
			createdAt: entry.createdAt
		})),
		aiFeatures: {
			historyIngestEnabled: aiConfig.historyIngestEnabled
		}
	};
}

export const load: PageServerLoad = async (event) => {
	requireRole(event, 'admin');
	return loadAdminWorkspace();
};

export const actions: Actions = {
	createUser: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const name = formData.get('name')?.toString().trim() ?? '';
		const email = normalizeEmail(formData.get('email')?.toString() ?? '');
		const password = formData.get('password')?.toString() ?? '';
		const selectedRole = formData.get('role')?.toString() ?? '';
		const forcePasswordChange = formData.get('forcePasswordChange') === 'on';

		if (!name || !email || !password) {
			return fail(400, {
				message: 'Name, email, and password are required.',
				mode: 'create-user' as const
			});
		}

		if (password.length < 8) {
			return fail(400, {
				message: 'Default password must be at least 8 characters.',
				mode: 'create-user' as const
			});
		}

		if (!isAppRole(selectedRole)) {
			return fail(400, {
				message: 'Select a valid role for the new user.',
				mode: 'create-user' as const
			});
		}

		try {
			const result = await auth.api.createUser({
				headers: event.request.headers,
				body: {
					name,
					email,
					password
				}
			});

			await db.update(user).set({ role: selectedRole }).where(eq(user.id, result.user.id));
			await syncRoleArtifacts(result.user.id, selectedRole);
			await setUserMustChangePassword(result.user.id, forcePasswordChange);
		} catch (error) {
			return fail(400, {
				message: resolveErrorMessage(error, 'Could not create user.'),
				mode: 'create-user' as const
			});
		}

		return {
			success: `${name} was created as ${selectedRole}.`,
			mode: 'create-user' as const,
			actor: adminUser.name
		};
	},
	updateUser: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const userId = formData.get('userId')?.toString() ?? '';
		const name = formData.get('name')?.toString().trim() ?? '';
		const selectedRole = formData.get('role')?.toString() ?? '';
		const forcePasswordChange = formData.get('forcePasswordChange') === 'on';

		if (!userId || !name || !isAppRole(selectedRole)) {
			return fail(400, {
				message: 'Provide a valid name and role for the selected user.',
				mode: 'update-user' as const
			});
		}

		if (userId === adminUser.id && selectedRole !== 'admin') {
			return fail(400, {
				message: 'Your account must remain an admin user.',
				mode: 'update-user' as const
			});
		}

		const existingUser = await db.query.user.findFirst({
			where: eq(user.id, userId)
		});

		if (!existingUser) {
			return fail(404, {
				message: 'User not found.',
				mode: 'update-user' as const
			});
		}

		await db.update(user).set({ name, role: selectedRole }).where(eq(user.id, userId));
		await syncRoleArtifacts(userId, selectedRole);
		await setUserMustChangePassword(userId, forcePasswordChange);

		return {
			success: `${name} updated successfully.`,
			mode: 'update-user' as const
		};
	},
	resetUserPassword: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const userId = formData.get('userId')?.toString() ?? '';
		const newPassword = formData.get('newPassword')?.toString() ?? '';
		const forcePasswordChange = formData.get('forcePasswordChange') === 'on';

		if (!userId || newPassword.length < 8) {
			return fail(400, {
				message: 'Provide a valid user and a password with at least 8 characters.',
				mode: 'reset-password' as const
			});
		}

		try {
			await auth.api.setUserPassword({
				headers: event.request.headers,
				body: {
					userId,
					newPassword
				}
			});
		} catch (error) {
			return fail(400, {
				message: resolveErrorMessage(error, 'Unable to reset password.'),
				mode: 'reset-password' as const
			});
		}

		await setUserMustChangePassword(userId, forcePasswordChange);

		return {
			success: userId === adminUser.id ? 'Your password was reset.' : 'User password was reset.',
			mode: 'reset-password' as const
		};
	},
	removeUser: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const userId = formData.get('userId')?.toString() ?? '';

		if (!userId) {
			return fail(400, {
				message: 'User identifier is missing.',
				mode: 'remove-user' as const
			});
		}

		if (userId === adminUser.id) {
			return fail(400, {
				message: 'You cannot remove your own account.',
				mode: 'remove-user' as const
			});
		}

		try {
			await auth.api.removeUser({
				headers: event.request.headers,
				body: { userId }
			});
		} catch (error) {
			return fail(400, {
				message: resolveErrorMessage(error, 'Unable to remove user.'),
				mode: 'remove-user' as const
			});
		}

		return {
			success: 'User account removed.',
			mode: 'remove-user' as const
		};
	},
	assignTherapist: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const therapistId = formData.get('therapistId')?.toString() ?? '';
		const patientId = formData.get('patientId')?.toString() ?? '';

		if (!therapistId || !patientId) {
			return fail(400, {
				message: 'Select both a therapist and a patient.',
				mode: 'assign-therapist' as const
			});
		}

		if (therapistId === patientId) {
			return fail(400, {
				message: 'Therapist and patient must be different users.',
				mode: 'assign-therapist' as const
			});
		}

		const selectedUsers = await db
			.select({ id: user.id, role: user.role })
			.from(user)
			.where(inArray(user.id, [therapistId, patientId]));

		const therapist = selectedUsers.find((entry) => entry.id === therapistId);
		const patient = selectedUsers.find((entry) => entry.id === patientId);

		if (!therapist || therapist.role !== 'therapist' || !patient || patient.role !== 'patient') {
			return fail(400, {
				message: 'Assignment requires a therapist account and a patient account.',
				mode: 'assign-therapist' as const
			});
		}

		const existing = await db.query.therapistPatientAssignment.findFirst({
			where: and(
				eq(therapistPatientAssignment.therapistId, therapistId),
				eq(therapistPatientAssignment.patientId, patientId)
			)
		});

		if (existing) {
			return fail(400, {
				message: 'This therapist is already assigned to that patient.',
				mode: 'assign-therapist' as const
			});
		}

		await db.insert(therapistPatientAssignment).values({
			therapistId,
			patientId,
			assignedBy: adminUser.id
		});

		return {
			success: 'Therapist assignment created.',
			mode: 'assign-therapist' as const
		};
	},
	assignAssociate: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const associateId = formData.get('associateId')?.toString() ?? '';
		const patientId = formData.get('patientId')?.toString() ?? '';
		const relationshipLabel = formData.get('relationshipLabel')?.toString().trim() || 'family';

		if (!associateId || !patientId) {
			return fail(400, {
				message: 'Select both an associate and a patient.',
				mode: 'assign-associate' as const
			});
		}

		if (associateId === patientId) {
			return fail(400, {
				message: 'Associate and patient must be different users.',
				mode: 'assign-associate' as const
			});
		}

		const selectedUsers = await db
			.select({ id: user.id, role: user.role })
			.from(user)
			.where(inArray(user.id, [associateId, patientId]));

		const associate = selectedUsers.find((entry) => entry.id === associateId);
		const patient = selectedUsers.find((entry) => entry.id === patientId);

		if (!associate || associate.role !== 'associate' || !patient || patient.role !== 'patient') {
			return fail(400, {
				message: 'Assignment requires an associate account and a patient account.',
				mode: 'assign-associate' as const
			});
		}

		const existing = await db.query.associatePatientAssignment.findFirst({
			where: and(
				eq(associatePatientAssignment.associateId, associateId),
				eq(associatePatientAssignment.patientId, patientId)
			)
		});

		if (existing) {
			return fail(400, {
				message: 'This associate is already linked to that patient.',
				mode: 'assign-associate' as const
			});
		}

		await db.insert(associatePatientAssignment).values({
			associateId,
			patientId,
			relationshipLabel,
			assignedBy: adminUser.id
		});

		return {
			success: 'Associate assignment created.',
			mode: 'assign-associate' as const
		};
	},
	updateAssociateAssignment: async (event) => {
		requireRole(event, 'admin');
		const formData = await event.request.formData();
		const associateId = formData.get('associateId')?.toString() ?? '';
		const patientId = formData.get('patientId')?.toString() ?? '';
		const relationshipLabel = formData.get('relationshipLabel')?.toString().trim() ?? '';

		if (!associateId || !patientId || !relationshipLabel) {
			return fail(400, {
				message: 'Provide associate, patient, and relationship label.',
				mode: 'update-associate-assignment' as const
			});
		}

		await db
			.update(associatePatientAssignment)
			.set({ relationshipLabel })
			.where(
				and(
					eq(associatePatientAssignment.associateId, associateId),
					eq(associatePatientAssignment.patientId, patientId)
				)
			);

		return {
			success: 'Associate relationship updated.',
			mode: 'update-associate-assignment' as const
		};
	},
	removeTherapistAssignment: async (event) => {
		requireRole(event, 'admin');
		const formData = await event.request.formData();
		const therapistId = formData.get('therapistId')?.toString() ?? '';
		const patientId = formData.get('patientId')?.toString() ?? '';

		if (!therapistId || !patientId) {
			return fail(400, {
				message: 'Missing therapist or patient identifier.',
				mode: 'remove-therapist-assignment' as const
			});
		}

		await db
			.delete(therapistPatientAssignment)
			.where(
				and(
					eq(therapistPatientAssignment.therapistId, therapistId),
					eq(therapistPatientAssignment.patientId, patientId)
				)
			);

		return {
			success: 'Therapist assignment removed.',
			mode: 'remove-therapist-assignment' as const
		};
	},
	removeAssociateAssignment: async (event) => {
		requireRole(event, 'admin');
		const formData = await event.request.formData();
		const associateId = formData.get('associateId')?.toString() ?? '';
		const patientId = formData.get('patientId')?.toString() ?? '';

		if (!associateId || !patientId) {
			return fail(400, {
				message: 'Missing associate or patient identifier.',
				mode: 'remove-associate-assignment' as const
			});
		}

		await db
			.delete(associatePatientAssignment)
			.where(
				and(
					eq(associatePatientAssignment.associateId, associateId),
					eq(associatePatientAssignment.patientId, patientId)
				)
			);

		return {
			success: 'Associate assignment removed.',
			mode: 'remove-associate-assignment' as const
		};
	},
	logOutreach: async (event) => {
		const adminUser = requireRole(event, 'admin');
		const formData = await event.request.formData();
		const patientId = formData.get('patientId')?.toString() ?? '';
		const channel = formData.get('channel')?.toString() ?? '';
		const targetUserId = formData.get('targetUserId')?.toString() ?? '';
		const associateId = formData.get('associateId')?.toString() ?? '';
		const note = formData.get('note')?.toString().trim() ?? '';

		if (!patientId || !channel) {
			return fail(400, {
				message: 'Patient and outreach channel are required.',
				mode: 'log-outreach' as const
			});
		}

		if (
			channel !== 'call_patient' &&
			channel !== 'call_associate' &&
			channel !== 'email_patient' &&
			channel !== 'email_associate'
		) {
			return fail(400, {
				message: 'Choose a valid outreach action.',
				mode: 'log-outreach' as const
			});
		}

		await logAdminOutreach({
			patientId,
			adminUserId: adminUser.id,
			channel,
			targetUserId: targetUserId || null,
			associateId: associateId || null,
			note: note || null
		});

		return {
			success: 'Outreach action logged.',
			mode: 'log-outreach' as const
		};
	}
};
