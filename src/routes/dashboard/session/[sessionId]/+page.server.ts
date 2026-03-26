import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/authz';
import { getAccessibleTherapySession } from '$lib/server/session-calls';

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['patient', 'therapist']);
	const sessionId = event.params.sessionId;

	if (!sessionId) {
		throw error(404, 'Therapy session was not found.');
	}

	const session = await getAccessibleTherapySession(sessionId, user.id);
	if (!session) {
		throw error(404, 'Therapy session was not found.');
	}

	return {
		currentUser: {
			id: user.id,
			name: user.name,
			role: user.role
		},
		session: {
			id: session.id,
			mode: session.mode,
			status: session.status,
			scheduledStartAt: session.scheduledStartAt,
			meetingCode: session.meetingCode,
			patient: session.patient,
			therapist: session.therapist
		}
	};
};
