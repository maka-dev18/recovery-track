import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { requireSession } from '$lib/server/authz';
import { isAppRole, type AppRole } from '$lib/roles';
import { userMustChangePassword } from '$lib/server/user-security';

export const load: LayoutServerLoad = async (event) => {
	const user = requireSession(event);

	if (await userMustChangePassword(user.id)) {
		throw redirect(302, '/auth/change-password');
	}

	return {
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
			role: (isAppRole(user.role) ? user.role : 'patient') as AppRole
		}
	};
};
