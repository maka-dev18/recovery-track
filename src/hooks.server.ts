import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { touchUserPresence } from '$lib/server/activity';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		await touchUserPresence({
			userId: session.user.id,
			role: session.user.role,
			path: event.url.pathname
		});
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
