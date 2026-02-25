import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { requireSession } from '$lib/server/authz';
import { setUserMustChangePassword, userMustChangePassword } from '$lib/server/user-security';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/auth/login');
	}

	const user = requireSession(event);

	return {
		mustChangePassword: await userMustChangePassword(user.id)
	};
};

export const actions: Actions = {
	updatePassword: async (event) => {
		const user = requireSession(event);
		const formData = await event.request.formData();
		const currentPassword = formData.get('currentPassword')?.toString() ?? '';
		const newPassword = formData.get('newPassword')?.toString() ?? '';
		const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

		if (!currentPassword || !newPassword || !confirmPassword) {
			return fail(400, {
				message: 'Current password, new password, and confirmation are required.'
			});
		}

		if (newPassword.length < 8) {
			return fail(400, {
				message: 'New password must be at least 8 characters.'
			});
		}

		if (newPassword !== confirmPassword) {
			return fail(400, {
				message: 'Confirmation does not match the new password.'
			});
		}

		try {
			await auth.api.changePassword({
				headers: event.request.headers,
				body: {
					currentPassword,
					newPassword,
					revokeOtherSessions: true
				}
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					message: error.message || 'Failed to update password.'
				});
			}

			return fail(500, {
				message: 'Unexpected error while updating password.'
			});
		}

		await setUserMustChangePassword(user.id, false);

		throw redirect(302, '/dashboard');
	}
};
