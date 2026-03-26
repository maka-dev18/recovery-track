import { and, eq, gt, inArray, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { therapySession, therapySessionSignal } from '$lib/server/db/schema';

export function getSessionJoinPath(sessionId: string) {
	return `/dashboard/session/${sessionId}`;
}

export async function getAccessibleTherapySession(sessionId: string, userId: string) {
	return db.query.therapySession.findFirst({
		where: and(
			eq(therapySession.id, sessionId),
			or(eq(therapySession.patientId, userId), eq(therapySession.therapistId, userId))
		),
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			therapist: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});
}

export async function appendSessionSignal(args: {
	sessionId: string;
	senderUserId: string;
	signalType: 'offer' | 'answer' | 'ice' | 'hangup' | 'ready';
	payload: Record<string, unknown>;
}) {
	const signalId = crypto.randomUUID();
	await db.insert(therapySessionSignal).values({
		id: signalId,
		sessionId: args.sessionId,
		senderUserId: args.senderUserId,
		signalType: args.signalType,
		payloadJson: JSON.stringify(args.payload)
	});

	return signalId;
}

export async function listSessionSignals(args: {
	sessionId: string;
	since?: Date | null;
	excludeUserId?: string | null;
}) {
	const signals = await db.query.therapySessionSignal.findMany({
		where: args.since
			? and(eq(therapySessionSignal.sessionId, args.sessionId), gt(therapySessionSignal.createdAt, args.since))
			: eq(therapySessionSignal.sessionId, args.sessionId),
		orderBy: (table, { asc }) => [asc(table.createdAt)]
	});

	return signals
		.filter((signal) => !args.excludeUserId || signal.senderUserId !== args.excludeUserId)
		.map((signal) => ({
			id: signal.id,
			senderUserId: signal.senderUserId,
			signalType: signal.signalType,
			payload: JSON.parse(signal.payloadJson) as Record<string, unknown>,
			createdAt: signal.createdAt
		}));
}
