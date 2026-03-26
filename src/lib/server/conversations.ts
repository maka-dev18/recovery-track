import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { normalizeFreeText } from '$lib/server/clinical';
import { db } from '$lib/server/db';
import {
	conversationMessage,
	conversationThread,
	therapistPatientAssignment
} from '$lib/server/db/schema';
import { therapistHasPatientAssignment } from '$lib/server/relationships';

const THERAPIST_DIRECT_CHANNEL = 'therapist_direct';
const MAX_MESSAGES_PER_THREAD = 16;

export type TherapistDirectConversationView = {
	threadId: string | null;
	patientId: string;
	patientName: string;
	patientEmail: string;
	therapistId: string;
	therapistName: string;
	therapistEmail: string;
	lastMessageAt: Date | null;
	lastMessagePreview: string | null;
	messages: Array<{
		id: string;
		role: 'patient' | 'therapist';
		senderName: string;
		content: string;
		createdAt: Date;
	}>;
};

type ThreadRecord = {
	id: string;
	patientId: string;
	therapistId: string | null;
	createdByUserId: string | null;
	lastMessageAt: Date | null;
	createdAt: Date;
	status: string;
};

function buildPreview(content: string): string {
	const normalized = normalizeFreeText(content, { maxLength: 140 });
	return normalized.length === 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function groupMessagesByThread(
	messages: Array<{
		id: string;
		threadId: string;
		role: string;
		content: string;
		createdAt: Date;
		senderUser: { name: string } | null;
	}>
) {
	const grouped = new Map<string, TherapistDirectConversationView['messages']>();

	for (const message of messages) {
		if (message.role !== 'patient' && message.role !== 'therapist') {
			continue;
		}

		const existing = grouped.get(message.threadId) ?? [];
		existing.push({
			id: message.id,
			role: message.role,
			senderName: message.senderUser?.name ?? 'Care team',
			content: message.content,
			createdAt: message.createdAt
		});
		grouped.set(message.threadId, existing);
	}

	return grouped;
}

async function loadMessagesByThreadIds(threadIds: string[]) {
	if (threadIds.length === 0) {
		return new Map<string, TherapistDirectConversationView['messages']>();
	}

	const messages = await db.query.conversationMessage.findMany({
		where: inArray(conversationMessage.threadId, threadIds),
		orderBy: (table, operators) => [asc(table.occurredAt), asc(table.createdAt)],
		with: {
			senderUser: {
				columns: {
					name: true
				}
			}
		}
	});

	const grouped = groupMessagesByThread(messages);

	for (const [threadId, threadMessages] of grouped.entries()) {
		if (threadMessages.length > MAX_MESSAGES_PER_THREAD) {
			grouped.set(threadId, threadMessages.slice(-MAX_MESSAGES_PER_THREAD));
		}
	}

	return grouped;
}

async function findTherapistDirectThreads(
	patientIds: string[],
	therapistIds: string[]
): Promise<ThreadRecord[]> {
	if (patientIds.length === 0 || therapistIds.length === 0) {
		return [];
	}

	return db.query.conversationThread.findMany({
		where: and(
			eq(conversationThread.channel, THERAPIST_DIRECT_CHANNEL),
			inArray(conversationThread.patientId, patientIds),
			or(
				inArray(conversationThread.therapistId, therapistIds),
				and(
					isNull(conversationThread.therapistId),
					inArray(conversationThread.createdByUserId, therapistIds)
				)
			)
		),
		orderBy: (table, operators) => [desc(table.lastMessageAt), desc(table.createdAt)]
	});
}

export async function listTherapistDirectConversationsForTherapist(
	therapistId: string
): Promise<TherapistDirectConversationView[]> {
	const assignments = await db.query.therapistPatientAssignment.findMany({
		where: eq(therapistPatientAssignment.therapistId, therapistId),
		orderBy: (table, operators) => [desc(table.createdAt)],
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

	const patientIds = assignments.map((assignment) => assignment.patientId);
	const threads = await findTherapistDirectThreads(patientIds, [therapistId]);
	const messagesByThreadId = await loadMessagesByThreadIds(threads.map((thread) => thread.id));
	const threadByPatientId = new Map(threads.map((thread) => [thread.patientId, thread]));

	return assignments
		.filter((assignment) => assignment.patient && assignment.therapist)
		.map((assignment) => {
			const thread = threadByPatientId.get(assignment.patientId) ?? null;
			const messages = thread ? messagesByThreadId.get(thread.id) ?? [] : [];
			const lastMessage = messages.at(-1);

			return {
				threadId: thread?.id ?? null,
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				therapistId: assignment.therapistId,
				therapistName: assignment.therapist!.name,
				therapistEmail: assignment.therapist!.email,
				lastMessageAt: thread?.lastMessageAt ?? null,
				lastMessagePreview: lastMessage ? buildPreview(lastMessage.content) : null,
				messages
			};
		})
		.sort((left, right) => {
			const leftTime = left.lastMessageAt?.getTime() ?? 0;
			const rightTime = right.lastMessageAt?.getTime() ?? 0;
			return rightTime - leftTime || left.patientName.localeCompare(right.patientName);
		});
}

export async function listTherapistDirectConversationsForPatient(
	patientId: string
): Promise<TherapistDirectConversationView[]> {
	const assignments = await db.query.therapistPatientAssignment.findMany({
		where: eq(therapistPatientAssignment.patientId, patientId),
		orderBy: (table, operators) => [desc(table.createdAt)],
		with: {
			therapist: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});

	const therapistIds = assignments.map((assignment) => assignment.therapistId);
	const threads = await findTherapistDirectThreads([patientId], therapistIds);
	const messagesByThreadId = await loadMessagesByThreadIds(threads.map((thread) => thread.id));
	const threadByTherapistId = new Map(
		threads
			.filter((thread) => thread.therapistId || thread.createdByUserId)
			.map((thread) => [thread.therapistId ?? thread.createdByUserId!, thread])
	);

	return assignments
		.filter((assignment) => assignment.therapist && assignment.patient)
		.map((assignment) => {
			const thread = threadByTherapistId.get(assignment.therapistId) ?? null;
			const messages = thread ? messagesByThreadId.get(thread.id) ?? [] : [];
			const lastMessage = messages.at(-1);

			return {
				threadId: thread?.id ?? null,
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				therapistId: assignment.therapistId,
				therapistName: assignment.therapist!.name,
				therapistEmail: assignment.therapist!.email,
				lastMessageAt: thread?.lastMessageAt ?? null,
				lastMessagePreview: lastMessage ? buildPreview(lastMessage.content) : null,
				messages
			};
		})
		.sort((left, right) => {
			const leftTime = left.lastMessageAt?.getTime() ?? 0;
			const rightTime = right.lastMessageAt?.getTime() ?? 0;
			return rightTime - leftTime || left.therapistName.localeCompare(right.therapistName);
		});
}

export async function findTherapistDirectThread(therapistId: string, patientId: string) {
	return db.query.conversationThread.findFirst({
		where: and(
			eq(conversationThread.channel, THERAPIST_DIRECT_CHANNEL),
			eq(conversationThread.patientId, patientId),
			or(
				eq(conversationThread.therapistId, therapistId),
				and(isNull(conversationThread.therapistId), eq(conversationThread.createdByUserId, therapistId))
			)
		)
	});
}

export async function sendTherapistDirectMessage(input: {
	therapistId: string;
	patientId: string;
	senderUserId: string;
	senderRole: 'patient' | 'therapist';
	content: string;
}) {
	if (!(await therapistHasPatientAssignment(input.therapistId, input.patientId))) {
		throw new Error('You can only message assigned therapist-patient pairs.');
	}

	if (input.senderRole === 'therapist' && input.senderUserId !== input.therapistId) {
		throw new Error('Therapist message sender does not match the assigned therapist.');
	}

	if (input.senderRole === 'patient' && input.senderUserId !== input.patientId) {
		throw new Error('Patient message sender does not match the assigned patient.');
	}

	const content = normalizeFreeText(input.content, { maxLength: 2000 });
	if (content.length < 1) {
		throw new Error('Message content is required.');
	}

	const timestamp = new Date();
	let thread = await findTherapistDirectThread(input.therapistId, input.patientId);
	let createdThread = false;

	if (!thread) {
		createdThread = true;
		const threadId = crypto.randomUUID();

		// Direct therapist threads are keyed to the assigned therapist until a participant table exists.
		await db.insert(conversationThread).values({
			id: threadId,
			patientId: input.patientId,
			therapistId: input.therapistId,
			createdByUserId: input.therapistId,
			channel: THERAPIST_DIRECT_CHANNEL,
			status: 'active',
			lastMessageAt: timestamp
		});

		thread = await findTherapistDirectThread(input.therapistId, input.patientId);
	}

	if (!thread) {
		throw new Error('Could not open the therapist conversation thread.');
	}

	const messageId = crypto.randomUUID();
	await db.insert(conversationMessage).values({
		id: messageId,
		threadId: thread.id,
		patientId: input.patientId,
		senderUserId: input.senderUserId,
		role: input.senderRole,
		content,
		modality: 'text',
		visibility: 'shared',
		metadataJson: '{}',
		occurredAt: timestamp
	});

	await db
		.update(conversationThread)
		.set({
			status: 'active',
			lastMessageAt: timestamp,
			closedAt: null
		})
		.where(eq(conversationThread.id, thread.id));

	return {
		threadId: thread.id,
		messageId,
		createdThread
	};
}
