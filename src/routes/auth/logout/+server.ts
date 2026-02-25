import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';

const handleLogout: RequestHandler = async ({ request }) => {
	await auth.api.signOut({
		headers: request.headers
	});

	throw redirect(302, '/auth/login');
};

export const GET: RequestHandler = handleLogout;
export const POST: RequestHandler = handleLogout;
