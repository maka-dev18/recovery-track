import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDashboardPath, isAppRole, type AppRole } from '$lib/roles';

export function requireSession(event: RequestEvent) {
	if (!event.locals.user) {
		throw redirect(302, '/auth/login');
	}

	return event.locals.user;
}

export function requireRole(event: RequestEvent, role: AppRole | AppRole[]) {
	const user = requireSession(event);
	const allowedRoles = Array.isArray(role) ? role : [role];

	if (!isAppRole(user.role) || !allowedRoles.includes(user.role)) {
		throw redirect(302, getDashboardPath(user.role));
	}

	return user;
}
