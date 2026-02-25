export const APP_ROLES = ['admin', 'therapist', 'patient', 'associate'] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABEL: Record<AppRole, string> = {
	admin: 'Administrator',
	therapist: 'Therapist',
	patient: 'Patient',
	associate: 'Associate'
};

export const DASHBOARD_PATH_BY_ROLE: Record<AppRole, string> = {
	admin: '/dashboard/admin',
	therapist: '/dashboard/therapist',
	patient: '/dashboard/patient',
	associate: '/dashboard/associate'
};

export function isAppRole(value: string | null | undefined): value is AppRole {
	return APP_ROLES.includes(value as AppRole);
}

export function getDashboardPath(role: string | null | undefined): string {
	if (isAppRole(role)) {
		return DASHBOARD_PATH_BY_ROLE[role];
	}

	return '/auth/login';
}
