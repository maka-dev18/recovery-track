import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireSession } from '$lib/server/authz';
import { getDashboardPath } from '$lib/roles';

export const load: PageServerLoad = async (event) => {
	const user = requireSession(event);
	throw redirect(302, getDashboardPath(user.role));
};
