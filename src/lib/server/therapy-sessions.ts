import { and, asc, desc, eq, gte, inArray, notInArray } from 'drizzle-orm';
import {
	normalizeFreeText,
	parseTherapySessionNotes,
	serializeTherapySessionNotes,
	type TherapySessionMode,
	type TherapySessionNoteShape,
	type TherapySessionStatus
} from '$lib/server/clinical';
import { findTherapistDirectThread } from '$lib/server/conversations';
import { db } from '$lib/server/db';
import { therapistPatientAssignment, therapySession } from '$lib/server/db/schema';
import { therapistHasPatientAssignment } from '$lib/server/relationships';
import { getSessionJoinPath } from '$lib/server/session-calls';

export type TherapySessionNoteView = {
	id: string;
	patientId: string;
	patientName: string;
	mode: TherapySessionMode;
	status: TherapySessionStatus;
	requiresConfirmation: boolean;
	summary: string;
	sessionAt: Date | null;
	automationReason: string | null;
	meetingUrl: string | null;
	meetingCode: string | null;
	confirmedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	notes: TherapySessionNoteShape;
};

export type UpcomingTherapySessionView = TherapySessionNoteView & {
	therapistId: string | null;
	therapistName: string;
};

const BUSINESS_DAY_START_HOUR = 8;
const BUSINESS_DAY_END_HOUR = 18;
const SLOT_DURATION_MINUTES = 60;

function riskRank(tier: 'low' | 'moderate' | 'high' | 'critical' | null | undefined) {
	if (tier === 'critical') return 3;
	if (tier === 'high') return 2;
	if (tier === 'moderate') return 1;
	return 0;
}

function roundToNextSlot(date: Date) {
	const rounded = new Date(date);
	rounded.setMilliseconds(0);
	rounded.setSeconds(0);
	rounded.setMinutes(0);
	rounded.setHours(Math.max(BUSINESS_DAY_START_HOUR, rounded.getHours()));

	if (date.getMinutes() > 0 || date.getSeconds() > 0 || date.getMilliseconds() > 0) {
		rounded.setHours(rounded.getHours() + 1);
	}

	if (rounded.getHours() >= BUSINESS_DAY_END_HOUR) {
		rounded.setDate(rounded.getDate() + 1);
		rounded.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
	}

	return rounded;
}

function addMinutes(date: Date, minutes: number) {
	return new Date(date.getTime() + minutes * 60 * 1000);
}

function intervalsOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
	return startA < endB && startB < endA;
}

function resolveMeetingFields(sessionId: string, mode: TherapySessionMode) {
	if (mode !== 'video' && mode !== 'phone') {
		return {
			meetingUrl: null,
			meetingCode: null
		};
	}

	return {
		meetingUrl: getSessionJoinPath(sessionId),
		meetingCode: sessionId.slice(0, 8).toUpperCase()
	};
}

function resolveSessionTimestamps(status: TherapySessionStatus, sessionAt: Date | null) {
	if (!sessionAt) {
		return {
			scheduledStartAt: null,
			startedAt: null,
			endedAt: null
		};
	}

	if (status === 'scheduled') {
		return {
			scheduledStartAt: sessionAt,
			startedAt: null,
			endedAt: null
		};
	}

	return {
		scheduledStartAt: null,
		startedAt: sessionAt,
		endedAt: status === 'completed' ? sessionAt : null
	};
}

export async function listTherapySessionsForTherapist(
	therapistId: string,
	limit = 12
): Promise<TherapySessionNoteView[]> {
	const patientAssignments = await db.query.therapistPatientAssignment.findMany({
		where: eq(therapistPatientAssignment.therapistId, therapistId),
		with: {
			patient: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	const patientIds = patientAssignments.map((assignment) => assignment.patientId);
	if (patientIds.length === 0) {
		return [];
	}

	const patientNameById = new Map(
		patientAssignments
			.filter((assignment) => assignment.patient)
			.map((assignment) => [assignment.patientId, assignment.patient!.name])
	);

	const sessions = await db.query.therapySession.findMany({
		where: and(
			eq(therapySession.therapistId, therapistId),
			inArray(therapySession.patientId, patientIds)
		),
		orderBy: (table, operators) => [desc(table.startedAt), desc(table.createdAt)],
		limit
	});

	return sessions.map((session) => ({
		id: session.id,
		patientId: session.patientId,
		patientName: patientNameById.get(session.patientId) ?? 'Assigned patient',
		mode: session.mode as TherapySessionMode,
		status: session.status as TherapySessionStatus,
		requiresConfirmation: session.requiresConfirmation,
		summary: session.summary ?? '',
		sessionAt: session.startedAt ?? session.scheduledStartAt ?? null,
		automationReason: session.automationReason ?? null,
		meetingUrl: session.meetingUrl ?? null,
		meetingCode: session.meetingCode ?? null,
		confirmedAt: session.confirmedAt ?? null,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		notes: parseTherapySessionNotes(session.notes)
	}));
}

export async function listUpcomingTherapySessionsForTherapist(
	therapistId: string,
	limit = 12
): Promise<UpcomingTherapySessionView[]> {
	const sessions = await db.query.therapySession.findMany({
		where: and(
			eq(therapySession.therapistId, therapistId),
			notInArray(therapySession.status, ['completed', 'cancelled', 'no_show']),
			gte(therapySession.scheduledStartAt, new Date(Date.now() - 30 * 60 * 1000))
		),
		orderBy: (table, { asc }) => [asc(table.scheduledStartAt), asc(table.createdAt)],
		limit,
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
		}
	});

	return sessions.map((session) => ({
		id: session.id,
		patientId: session.patientId,
		patientName: session.patient?.name ?? 'Assigned patient',
		therapistId: session.therapistId,
		therapistName: session.therapist?.name ?? 'Therapist',
		mode: session.mode as TherapySessionMode,
		status: session.status as TherapySessionStatus,
		requiresConfirmation: session.requiresConfirmation,
		summary: session.summary ?? '',
		sessionAt: session.scheduledStartAt ?? session.startedAt ?? null,
		automationReason: session.automationReason ?? null,
		meetingUrl: session.meetingUrl ?? null,
		meetingCode: session.meetingCode ?? null,
		confirmedAt: session.confirmedAt ?? null,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		notes: parseTherapySessionNotes(session.notes)
	}));
}

export async function listUpcomingTherapySessionsForPatient(
	patientId: string,
	limit = 12
): Promise<UpcomingTherapySessionView[]> {
	const sessions = await db.query.therapySession.findMany({
		where: and(
			eq(therapySession.patientId, patientId),
			notInArray(therapySession.status, ['completed', 'cancelled', 'no_show']),
			gte(therapySession.scheduledStartAt, new Date(Date.now() - 30 * 60 * 1000))
		),
		orderBy: (table, { asc }) => [asc(table.scheduledStartAt), asc(table.createdAt)],
		limit,
		with: {
			therapist: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	return sessions.map((session) => ({
		id: session.id,
		patientId: session.patientId,
		patientName: 'You',
		therapistId: session.therapistId,
		therapistName: session.therapist?.name ?? 'Therapist',
		mode: session.mode as TherapySessionMode,
		status: session.status as TherapySessionStatus,
		requiresConfirmation: session.requiresConfirmation,
		summary: session.summary ?? '',
		sessionAt: session.scheduledStartAt ?? session.startedAt ?? null,
		automationReason: session.automationReason ?? null,
		meetingUrl: session.meetingUrl ?? null,
		meetingCode: session.meetingCode ?? null,
		confirmedAt: session.confirmedAt ?? null,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		notes: parseTherapySessionNotes(session.notes)
	}));
}

export async function findNextAvailableTherapistSlot(therapistId: string, options?: { startAt?: Date | null }) {
	const searchStart = roundToNextSlot(options?.startAt ?? new Date());
	const searchEnd = addMinutes(searchStart, 14 * 24 * 60);

	const existingSessions = await db.query.therapySession.findMany({
		where: and(
			eq(therapySession.therapistId, therapistId),
			notInArray(therapySession.status, ['completed', 'cancelled', 'no_show']),
			gte(therapySession.scheduledStartAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
		),
		orderBy: (table, { asc }) => [asc(table.scheduledStartAt)]
	});

	let candidate = new Date(searchStart);
	while (candidate.getTime() < searchEnd.getTime()) {
		if (candidate.getHours() < BUSINESS_DAY_START_HOUR) {
			candidate.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
		}

		if (candidate.getHours() >= BUSINESS_DAY_END_HOUR) {
			candidate.setDate(candidate.getDate() + 1);
			candidate.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
			continue;
		}

		const candidateEnd = addMinutes(candidate, SLOT_DURATION_MINUTES);
		const hasConflict = existingSessions.some((session) => {
			const sessionStart = session.scheduledStartAt ?? session.startedAt;
			if (!sessionStart) return false;
			const sessionEnd = addMinutes(sessionStart, session.durationMinutes || SLOT_DURATION_MINUTES);
			return intervalsOverlap(candidate, candidateEnd, sessionStart, sessionEnd);
		});

		if (!hasConflict) {
			return candidate;
		}

		candidate = addMinutes(candidate, SLOT_DURATION_MINUTES);
	}

	return roundToNextSlot(addMinutes(searchStart, SLOT_DURATION_MINUTES));
}

export async function ensureRiskFollowUpSession(args: {
	patientId: string;
	therapistId: string;
	tier: 'moderate' | 'high' | 'critical';
	reason: string;
}) {
	const mode: TherapySessionMode = args.tier === 'critical' ? 'in_person' : 'video';
	const requiresConfirmation = args.tier === 'moderate';
	const summary =
		args.tier === 'critical'
			? 'Automated urgent in-person follow-up scheduled after a critical relapse prediction.'
			: args.tier === 'high'
				? 'Automated video follow-up scheduled after a high relapse prediction.'
				: 'Automated video follow-up proposed after a moderate-risk review.';

	const existingSession = await db.query.therapySession.findFirst({
		where: and(
			eq(therapySession.patientId, args.patientId),
			eq(therapySession.therapistId, args.therapistId),
			eq(therapySession.automationSource, 'risk_engine'),
			notInArray(therapySession.status, ['completed', 'cancelled', 'no_show']),
			gte(therapySession.scheduledStartAt, new Date())
		),
		orderBy: (table, { asc }) => [asc(table.scheduledStartAt)]
	});

	if (existingSession) {
		const existingNotes = parseTherapySessionNotes(existingSession.notes);
		const shouldUpgrade =
			riskRank(args.tier) >= riskRank(existingNotes.riskLevel) &&
			(existingSession.mode !== mode ||
				existingSession.requiresConfirmation !== requiresConfirmation ||
				existingNotes.riskLevel !== args.tier);

		if (shouldUpgrade) {
			const meeting = resolveMeetingFields(existingSession.id, mode);
			await db
				.update(therapySession)
				.set({
					mode,
					requiresConfirmation,
					automationReason: args.reason,
					meetingUrl: meeting.meetingUrl,
					meetingCode: meeting.meetingCode,
					summary,
					confirmedByUserId: requiresConfirmation ? null : existingSession.confirmedByUserId,
					confirmedAt: requiresConfirmation ? null : existingSession.confirmedAt,
					notes: serializeTherapySessionNotes({
						...existingNotes,
						riskLevel: args.tier,
						nextSteps: args.reason
					})
				})
				.where(eq(therapySession.id, existingSession.id));
		}

		return {
			sessionId: existingSession.id,
			created: false,
			updated: shouldUpgrade
		};
	}

	const sessionId = crypto.randomUUID();
	const scheduledStartAt = await findNextAvailableTherapistSlot(args.therapistId);
	const meeting = resolveMeetingFields(sessionId, mode);

	await db.insert(therapySession).values({
		id: sessionId,
		patientId: args.patientId,
		therapistId: args.therapistId,
		createdByUserId: args.therapistId,
		sessionType: 'therapy',
		mode,
		status: 'scheduled',
		requiresConfirmation,
		durationMinutes: SLOT_DURATION_MINUTES,
		scheduledStartAt,
		automationSource: 'risk_engine',
		automationReason: args.reason,
		meetingUrl: meeting.meetingUrl,
		meetingCode: meeting.meetingCode,
		summary,
		notes: serializeTherapySessionNotes({
			presentation: '',
			interventions: [],
			response: '',
			homework: [],
			riskLevel: args.tier === 'moderate' ? 'moderate' : args.tier,
			nextSteps: args.reason
		})
	});

	return {
		sessionId,
		created: true,
		updated: false
	};
}

export async function confirmSuggestedTherapySession(args: {
	sessionId: string;
	therapistId: string;
	sessionAt?: Date | null;
}) {
	const session = await db.query.therapySession.findFirst({
		where: and(eq(therapySession.id, args.sessionId), eq(therapySession.therapistId, args.therapistId))
	});

	if (!session) {
		throw new Error('Scheduled session not found.');
	}

	const nextStartAt = args.sessionAt ?? session.scheduledStartAt;
	if (!nextStartAt) {
		throw new Error('A scheduled time is required for confirmation.');
	}

	await db
		.update(therapySession)
		.set({
			scheduledStartAt: nextStartAt,
			requiresConfirmation: false,
			confirmedByUserId: args.therapistId,
			confirmedAt: new Date()
		})
		.where(eq(therapySession.id, args.sessionId));
}

export async function rescheduleTherapySession(args: {
	sessionId: string;
	therapistId: string;
	sessionAt: Date;
}) {
	const session = await db.query.therapySession.findFirst({
		where: and(eq(therapySession.id, args.sessionId), eq(therapySession.therapistId, args.therapistId))
	});

	if (!session) {
		throw new Error('Session not found for this therapist.');
	}

	await db
		.update(therapySession)
		.set({
			scheduledStartAt: args.sessionAt,
			confirmedByUserId: args.therapistId,
			confirmedAt: session.requiresConfirmation ? new Date() : session.confirmedAt,
			requiresConfirmation: false
		})
		.where(eq(therapySession.id, args.sessionId));
}

export async function reschedulePatientTherapySession(args: {
	sessionId: string;
	patientId: string;
	sessionAt: Date;
}) {
	const session = await db.query.therapySession.findFirst({
		where: and(eq(therapySession.id, args.sessionId), eq(therapySession.patientId, args.patientId))
	});

	if (!session) {
		throw new Error('Session not found for this patient.');
	}

	if (['completed', 'cancelled', 'no_show'].includes(session.status)) {
		throw new Error('This session can no longer be rescheduled.');
	}

	await db
		.update(therapySession)
		.set({
			scheduledStartAt: args.sessionAt,
			requiresConfirmation: true,
			confirmedByUserId: null,
			confirmedAt: null,
			automationReason: session.automationReason
				? `${session.automationReason} Patient requested a new time.`
				: 'Patient requested a new session time.'
		})
		.where(eq(therapySession.id, args.sessionId));
}

export async function saveTherapySessionNote(input: {
	sessionId?: string;
	patientId: string;
	therapistId: string;
	mode: TherapySessionMode;
	status: TherapySessionStatus;
	sessionAt: Date | null;
	summary: string;
	notes: TherapySessionNoteShape;
}) {
	if (!(await therapistHasPatientAssignment(input.therapistId, input.patientId))) {
		throw new Error('You can only document sessions for assigned patients.');
	}

	const summary = normalizeFreeText(input.summary, { maxLength: 600 });
	if (summary.length < 6) {
		throw new Error('Provide a concise session summary.');
	}

	const timestamps = resolveSessionTimestamps(input.status, input.sessionAt);
	const thread = await findTherapistDirectThread(input.therapistId, input.patientId);
	const notes = serializeTherapySessionNotes(input.notes);

	if (input.sessionId) {
		const existingSession = await db.query.therapySession.findFirst({
			where: and(
				eq(therapySession.id, input.sessionId),
				eq(therapySession.therapistId, input.therapistId),
				eq(therapySession.patientId, input.patientId)
			)
		});

		if (!existingSession) {
			throw new Error('Therapy session note not found for this patient.');
		}

		await db
			.update(therapySession)
			.set({
				mode: input.mode,
				status: input.status,
				summary,
				notes,
				threadId: existingSession.threadId ?? thread?.id ?? null,
				scheduledStartAt: timestamps.scheduledStartAt,
				startedAt: timestamps.startedAt,
				endedAt: timestamps.endedAt,
				...(input.status === 'scheduled'
					? resolveMeetingFields(existingSession.id, input.mode)
					: {
							meetingUrl: existingSession.meetingUrl,
							meetingCode: existingSession.meetingCode
						})
			})
			.where(eq(therapySession.id, input.sessionId));

		return {
			sessionId: input.sessionId,
			updated: true
		};
	}

	const sessionId = crypto.randomUUID();
	const meeting = resolveMeetingFields(sessionId, input.mode);
	await db.insert(therapySession).values({
		id: sessionId,
		patientId: input.patientId,
		therapistId: input.therapistId,
		threadId: thread?.id ?? null,
		createdByUserId: input.therapistId,
		sessionType: 'therapy',
		mode: input.mode,
		status: input.status,
		requiresConfirmation: false,
		durationMinutes: SLOT_DURATION_MINUTES,
		scheduledStartAt: timestamps.scheduledStartAt,
		startedAt: timestamps.startedAt,
		endedAt: timestamps.endedAt,
		meetingUrl: meeting.meetingUrl,
		meetingCode: meeting.meetingCode,
		summary,
		notes
	});

	return {
		sessionId,
		updated: false
	};
}
