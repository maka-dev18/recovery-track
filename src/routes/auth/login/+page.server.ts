import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APIError } from 'better-auth/api';
import { count, eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { setUserMustChangePassword } from '$lib/server/user-security';

async function canBootstrapAdmin() {
	const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(user);
	return totalUsers === 0;
}

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		throw redirect(302, '/dashboard');
	}

	return {
		allowBootstrap: await canBootstrapAdmin()
	};
};

export const actions: Actions = {
	signIn: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		if (!email || !password) {
			return fail(400, {
				message: 'Email and password are required.',
				email,
				mode: 'sign-in' as const
			});
		}

		try {
			await auth.api.signInEmail({
				body: {
					email,
					password
				}
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					message: error.message || 'Sign in failed.',
					email,
					mode: 'sign-in' as const
				});
			}

			return fail(500, {
				message: 'Unexpected error during sign in.',
				email,
				mode: 'sign-in' as const
			});
		}

		throw redirect(302, '/dashboard');
	},
	bootstrapAdmin: async (event) => {
		if (!(await canBootstrapAdmin())) {
			return fail(400, {
				message: 'Bootstrap is disabled after the first account is created.',
				name: '',
				email: '',
				mode: 'bootstrap' as const
			});
		}

		const formData = await event.request.formData();
		const name = formData.get('name')?.toString().trim() ?? '';
		const email = formData.get('email')?.toString().trim().toLowerCase() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		if (!name || !email || !password) {
			return fail(400, {
				message: 'Name, email, and password are required.',
				name,
				email,
				mode: 'bootstrap' as const
			});
		}

		if (password.length < 8) {
			return fail(400, {
				message: 'Password must be at least 8 characters.',
				name,
				email,
				mode: 'bootstrap' as const
			});
		}

		try {
			await auth.api.signUpEmail({
				body: {
					name,
					email,
					password
				}
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					message: error.message || 'Failed to create initial admin.',
					name,
					email,
					mode: 'bootstrap' as const
				});
			}

			return fail(500, {
				message: 'Unexpected error while creating admin.',
				name,
				email,
				mode: 'bootstrap' as const
			});
		}

		const createdUser = await db.query.user.findFirst({
			where: eq(user.email, email)
		});

		if (!createdUser) {
			return fail(500, {
				message: 'Admin account was created but could not be configured.',
				name,
				email,
				mode: 'bootstrap' as const
			});
		}

		await db
			.update(user)
			.set({ role: 'admin' })
			.where(eq(user.id, createdUser.id));

		await setUserMustChangePassword(createdUser.id, false);

		throw redirect(302, '/dashboard/admin');
	}
};
