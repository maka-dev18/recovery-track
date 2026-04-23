import { and, desc, eq, gte, lte, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { appNotification, therapySession } from '$lib/server/db/schema';

const SESSION_REMINDER_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const SESSION_REMINDER_URGENT_MS = 60 * 60 * 1000;
const SESSION_REMINDER_ACTIVE_STATUSES = ['completed', 'cancelled', 'no_show'];

type NotificationInput = {
	userId: string;
	type: string;
	title: string;
	body: string;
	href?: string | null;
	entityType?: string | null;
	entityId?: string | null;
	dedupeKey: string;
};

export type DashboardNotification = {
	id: string;
	type: string;
	title: string;
	body: string;
	href: string | null;
	status: string;
	createdAt: Date;
};

export function resolveSessionReminderWindows(diffMs: number) {
	if (diffMs < 0 || diffMs > SESSION_REMINDER_LOOKAHEAD_MS) {
		return [];
	}

	if (diffMs <= SESSION_REMINDER_URGENT_MS) {
		return ['1h'] as const;
	}

	return ['24h'] as const;
}

function formatSessionDate(date: Date) {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(date);
}

function formatModeLabel(mode: string) {
	if (mode === 'video') return 'video call';
	if (mode === 'in_person') return 'in-person session';
	if (mode === 'phone') return 'phone call';
	return 'care session';
}

function reminderTitle(mode: string, window: '1h' | '24h') {
	const prefix = window === '1h' ? 'Starting soon' : 'Upcoming';
	return `${prefix}: ${formatModeLabel(mode)}`;
}

function isUniqueConflict(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.toLowerCase().includes('unique') || message.toLowerCase().includes('constraint');
}

export async function createNotification(input: NotificationInput) {
	const existing = await db.query.appNotification.findFirst({
		where: eq(appNotification.dedupeKey, input.dedupeKey),
		columns: { id: true }
	});

	if (existing) {
		return { id: existing.id, created: false };
	}

	const id = crypto.randomUUID();

	try {
		await db.insert(appNotification).values({
			id,
			userId: input.userId,
			type: input.type,
			title: input.title,
			body: input.body,
			href: input.href ?? null,
			entityType: input.entityType ?? null,
			entityId: input.entityId ?? null,
			dedupeKey: input.dedupeKey,
			status: 'unread'
		});
		return { id, created: true };
	} catch (error) {
		if (!isUniqueConflict(error)) {
			throw error;
		}

		const racedExisting = await db.query.appNotification.findFirst({
			where: eq(appNotification.dedupeKey, input.dedupeKey),
			columns: { id: true }
		});
		return { id: racedExisting?.id ?? id, created: false };
	}
}

export async function listUserNotifications(
	userId: string,
	limit = 8
): Promise<DashboardNotification[]> {
	return db.query.appNotification.findMany({
		where: eq(appNotification.userId, userId),
		columns: {
			id: true,
			type: true,
			title: true,
			body: true,
			href: true,
			status: true,
			createdAt: true
		},
		orderBy: [desc(appNotification.createdAt)],
		limit
	});
}

export async function countUnreadNotifications(userId: string) {
	const rows = await db.query.appNotification.findMany({
		where: and(eq(appNotification.userId, userId), eq(appNotification.status, 'unread')),
		columns: { id: true }
	});

	return rows.length;
}

export async function markUserNotificationsRead(userId: string) {
	await db
		.update(appNotification)
		.set({
			status: 'read',
			readAt: new Date()
		})
		.where(and(eq(appNotification.userId, userId), eq(appNotification.status, 'unread')));
}

export async function processTherapySessionReminders(now = new Date()) {
	const until = new Date(now.getTime() + SESSION_REMINDER_LOOKAHEAD_MS);
	const sessions = await db.query.therapySession.findMany({
		where: and(
			notInArray(therapySession.status, SESSION_REMINDER_ACTIVE_STATUSES),
			gte(therapySession.scheduledStartAt, now),
			lte(therapySession.scheduledStartAt, until)
		),
		with: {
			patient: {
				columns: {
					id: true,
					name: true
				}
			},
			therapist: {
				columns: {
					id: true,
					name: true
				}
			}
		},
		orderBy: [therapySession.scheduledStartAt]
	});

	let created = 0;

	for (const session of sessions) {
		if (!session.scheduledStartAt || !session.therapist?.id) {
			continue;
		}

		const windows = resolveSessionReminderWindows(session.scheduledStartAt.getTime() - now.getTime());
		if (windows.length === 0) {
			continue;
		}

		const modeLabel = formatModeLabel(session.mode);
		const sessionDate = formatSessionDate(session.scheduledStartAt);
		const therapistHref = session.meetingUrl ?? '/dashboard/therapist/followups';
		const patientHref = session.meetingUrl ?? '/dashboard/patient/care';

		for (const window of windows) {
			const therapistNotification = await createNotification({
				userId: session.therapist.id,
				type: 'therapy_session_reminder',
				title: reminderTitle(session.mode, window),
				body: `${modeLabel} with ${session.patient.name} is scheduled for ${sessionDate}.`,
				href: therapistHref,
				entityType: 'therapy_session',
				entityId: session.id,
				dedupeKey: `therapy-session:${session.id}:${session.therapist.id}:${window}`
			});
			if (therapistNotification.created) created += 1;

			const patientNotification = await createNotification({
				userId: session.patient.id,
				type: 'therapy_session_reminder',
				title: reminderTitle(session.mode, window),
				body: `${modeLabel} with ${session.therapist.name} is scheduled for ${sessionDate}.`,
				href: patientHref,
				entityType: 'therapy_session',
				entityId: session.id,
				dedupeKey: `therapy-session:${session.id}:${session.patient.id}:${window}`
			});
			if (patientNotification.created) created += 1;
		}
	}

	return { scanned: sessions.length, created };
}
