import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { normalizeFreeText } from '$lib/server/clinical';
import { db } from '$lib/server/db';
import {
	associatePatientAssignment,
	conversationMessage,
	conversationThread,
	therapistPatientAssignment,
	user
} from '$lib/server/db/schema';
import {
	associateHasPatientAssignment,
	getAssociatePatientIds,
	getTherapistPatientIds,
	therapistHasPatientAssignment
} from '$lib/server/relationships';

const ASSOCIATE_DIRECT_CHANNEL = 'associate_direct';
const ASSOCIATE_AI_CHANNEL = 'associate_ai';
const MAX_MESSAGES_PER_THREAD = 20;

type AllowedRole = 'therapist' | 'associate' | 'assistant';

type ThreadMessage<TRole extends AllowedRole> = {
	id: string;
	role: TRole;
	senderName: string;
	content: string;
	createdAt: Date;
};

export type TherapistAssociateConversationView = {
	threadId: string | null;
	patientId: string;
	patientName: string;
	patientEmail: string;
	therapistId: string;
	therapistName: string;
	therapistEmail: string;
	associateId: string;
	associateName: string;
	associateEmail: string;
	lastMessageAt: Date | null;
	lastMessagePreview: string | null;
	messages: Array<ThreadMessage<'therapist' | 'associate'>>;
};

export type AssociateAIConversationView = {
	threadId: string | null;
	patientId: string;
	patientName: string;
	patientEmail: string;
	associateId: string;
	associateName: string;
	lastMessageAt: Date | null;
	lastMessagePreview: string | null;
	messages: Array<ThreadMessage<'associate' | 'assistant'>>;
};

function buildPreview(content: string): string {
	const normalized = normalizeFreeText(content, { maxLength: 140 });
	return normalized.length === 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function groupMessagesByThread<TRole extends AllowedRole>(
	messages: Array<{
		id: string;
		threadId: string;
		role: string;
		content: string;
		createdAt: Date;
		senderUser: { name: string } | null;
	}>,
	allowedRoles: TRole[]
) {
	const roleSet = new Set(allowedRoles);
	const grouped = new Map<string, Array<ThreadMessage<TRole>>>();

	for (const message of messages) {
		if (!roleSet.has(message.role as TRole)) {
			continue;
		}

		const existing = grouped.get(message.threadId) ?? [];
		existing.push({
			id: message.id,
			role: message.role as TRole,
			senderName: message.senderUser?.name ?? 'Care team',
			content: message.content,
			createdAt: message.createdAt
		});
		grouped.set(message.threadId, existing);
	}

	return grouped;
}

async function loadMessagesByThreadIds<TRole extends AllowedRole>(
	threadIds: string[],
	allowedRoles: TRole[]
) {
	if (threadIds.length === 0) {
		return new Map<string, Array<ThreadMessage<TRole>>>();
	}

	const messages = await db.query.conversationMessage.findMany({
		where: inArray(conversationMessage.threadId, threadIds),
		orderBy: (table, { asc: orderAsc }) => [orderAsc(table.occurredAt), orderAsc(table.createdAt)],
		with: {
			senderUser: {
				columns: {
					name: true
				}
			}
		}
	});

	const grouped = groupMessagesByThread(messages, allowedRoles);
	for (const [threadId, threadMessages] of grouped.entries()) {
		if (threadMessages.length > MAX_MESSAGES_PER_THREAD) {
			grouped.set(threadId, threadMessages.slice(-MAX_MESSAGES_PER_THREAD));
		}
	}

	return grouped;
}

export async function findTherapistAssociateThread(
	therapistId: string,
	associateId: string,
	patientId: string
) {
	return db.query.conversationThread.findFirst({
		where: and(
			eq(conversationThread.channel, ASSOCIATE_DIRECT_CHANNEL),
			eq(conversationThread.patientId, patientId),
			eq(conversationThread.therapistId, therapistId),
			eq(conversationThread.associateId, associateId)
		)
	});
}

export async function sendTherapistAssociateMessage(input: {
	therapistId: string;
	associateId: string;
	patientId: string;
	senderUserId: string;
	senderRole: 'therapist' | 'associate';
	content: string;
}) {
	if (!(await therapistHasPatientAssignment(input.therapistId, input.patientId))) {
		throw new Error('Therapist is not assigned to this patient.');
	}

	if (!(await associateHasPatientAssignment(input.associateId, input.patientId))) {
		throw new Error('Associate is not linked to this patient.');
	}

	if (input.senderRole === 'therapist' && input.senderUserId !== input.therapistId) {
		throw new Error('Therapist sender does not match the assigned therapist.');
	}

	if (input.senderRole === 'associate' && input.senderUserId !== input.associateId) {
		throw new Error('Associate sender does not match the linked associate.');
	}

	const content = normalizeFreeText(input.content, { maxLength: 2_000 });
	if (!content) {
		throw new Error('Message content is required.');
	}

	const timestamp = new Date();
	let thread = await findTherapistAssociateThread(
		input.therapistId,
		input.associateId,
		input.patientId
	);
	let createdThread = false;

	if (!thread) {
		createdThread = true;
		const threadId = crypto.randomUUID();
		await db.insert(conversationThread).values({
			id: threadId,
			patientId: input.patientId,
			therapistId: input.therapistId,
			associateId: input.associateId,
			createdByUserId: input.senderRole === 'therapist' ? input.therapistId : input.associateId,
			channel: ASSOCIATE_DIRECT_CHANNEL,
			status: 'active',
			lastMessageAt: timestamp
		});

		thread = await findTherapistAssociateThread(input.therapistId, input.associateId, input.patientId);
	}

	if (!thread) {
		throw new Error('Could not open the therapist-associate conversation thread.');
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

export async function listTherapistAssociateConversationsForTherapist(
	therapistId: string
): Promise<TherapistAssociateConversationView[]> {
	const patientIds = await getTherapistPatientIds(therapistId);
	if (patientIds.length === 0) {
		return [];
	}

	const associateAssignments = await db.query.associatePatientAssignment.findMany({
		where: inArray(associatePatientAssignment.patientId, patientIds),
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			associate: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		},
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
	});

	const therapist = await db.query.user.findFirst({
		where: eq(user.id, therapistId),
		columns: {
			id: true,
			name: true,
			email: true
		}
	});

	if (!therapist) {
		return [];
	}

	const threads = await db.query.conversationThread.findMany({
		where: and(
			eq(conversationThread.channel, ASSOCIATE_DIRECT_CHANNEL),
			eq(conversationThread.therapistId, therapistId),
			inArray(conversationThread.patientId, patientIds)
		),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.lastMessageAt), orderDesc(table.createdAt)]
	});
	const messagesByThreadId = await loadMessagesByThreadIds(threads.map((thread) => thread.id), [
		'therapist',
		'associate'
	]);
	const threadByKey = new Map(
		threads.map((thread) => [`${thread.patientId}:${thread.associateId ?? ''}`, thread])
	);

	return associateAssignments
		.filter((assignment) => assignment.patient && assignment.associate)
		.map((assignment) => {
			const key = `${assignment.patientId}:${assignment.associateId}`;
			const thread = threadByKey.get(key) ?? null;
			const messages = thread ? messagesByThreadId.get(thread.id) ?? [] : [];
			const lastMessage = messages.at(-1);

			return {
				threadId: thread?.id ?? null,
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				therapistId,
				therapistName: therapist.name,
				therapistEmail: therapist.email,
				associateId: assignment.associateId,
				associateName: assignment.associate!.name,
				associateEmail: assignment.associate!.email,
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

export async function listTherapistAssociateConversationsForAssociate(
	associateId: string
): Promise<TherapistAssociateConversationView[]> {
	const patientIds = await getAssociatePatientIds(associateId);
	if (patientIds.length === 0) {
		return [];
	}

	const associateAssignments = await db.query.associatePatientAssignment.findMany({
		where: and(
			eq(associatePatientAssignment.associateId, associateId),
			inArray(associatePatientAssignment.patientId, patientIds)
		),
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			associate: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});

	const therapistAssignments = await db.query.therapistPatientAssignment.findMany({
		where: inArray(therapistPatientAssignment.patientId, patientIds),
		with: {
			therapist: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			}
		}
	});

	const threads = await db.query.conversationThread.findMany({
		where: and(
			eq(conversationThread.channel, ASSOCIATE_DIRECT_CHANNEL),
			eq(conversationThread.associateId, associateId),
			inArray(conversationThread.patientId, patientIds)
		),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.lastMessageAt), orderDesc(table.createdAt)]
	});
	const messagesByThreadId = await loadMessagesByThreadIds(threads.map((thread) => thread.id), [
		'therapist',
		'associate'
	]);
	const threadByKey = new Map(
		threads.map((thread) => [`${thread.patientId}:${thread.therapistId ?? ''}`, thread])
	);
	const associateAssignmentByPatientId = new Map(
		associateAssignments
			.filter((assignment) => assignment.patient && assignment.associate)
			.map((assignment) => [assignment.patientId, assignment])
	);

	return therapistAssignments
		.filter((assignment) => assignment.therapist)
		.map((assignment) => {
			const associateAssignment = associateAssignmentByPatientId.get(assignment.patientId);
			if (!associateAssignment || !associateAssignment.patient || !associateAssignment.associate) {
				return null;
			}

			const key = `${assignment.patientId}:${assignment.therapistId}`;
			const thread = threadByKey.get(key) ?? null;
			const messages = thread ? messagesByThreadId.get(thread.id) ?? [] : [];
			const lastMessage = messages.at(-1);

			return {
				threadId: thread?.id ?? null,
				patientId: assignment.patientId,
				patientName: associateAssignment.patient.name,
				patientEmail: associateAssignment.patient.email,
				therapistId: assignment.therapistId,
				therapistName: assignment.therapist!.name,
				therapistEmail: assignment.therapist!.email,
				associateId,
				associateName: associateAssignment.associate.name,
				associateEmail: associateAssignment.associate.email,
				lastMessageAt: thread?.lastMessageAt ?? null,
				lastMessagePreview: lastMessage ? buildPreview(lastMessage.content) : null,
				messages
			} satisfies TherapistAssociateConversationView;
		})
		.filter((entry): entry is TherapistAssociateConversationView => Boolean(entry))
		.sort((left, right) => {
			const leftTime = left.lastMessageAt?.getTime() ?? 0;
			const rightTime = right.lastMessageAt?.getTime() ?? 0;
			return rightTime - leftTime || left.patientName.localeCompare(right.patientName);
		});
}

export async function findAssociateAiThread(associateId: string, patientId: string) {
	return db.query.conversationThread.findFirst({
		where: and(
			eq(conversationThread.channel, ASSOCIATE_AI_CHANNEL),
			eq(conversationThread.patientId, patientId),
			eq(conversationThread.associateId, associateId)
		)
	});
}

export async function appendAssociateAiMessage(input: {
	associateId: string;
	patientId: string;
	role: 'associate' | 'assistant';
	content: string;
	senderUserId?: string | null;
	metadataJson?: string;
}) {
	if (!(await associateHasPatientAssignment(input.associateId, input.patientId))) {
		throw new Error('Associate is not linked to this patient.');
	}

	const content = normalizeFreeText(input.content, { maxLength: 4_000 });
	if (!content) {
		throw new Error('Message content is required.');
	}

	const timestamp = new Date();
	let thread = await findAssociateAiThread(input.associateId, input.patientId);

	if (!thread) {
		const threadId = crypto.randomUUID();
		await db.insert(conversationThread).values({
			id: threadId,
			patientId: input.patientId,
			associateId: input.associateId,
			createdByUserId: input.associateId,
			channel: ASSOCIATE_AI_CHANNEL,
			status: 'active',
			lastMessageAt: timestamp
		});

		thread = await findAssociateAiThread(input.associateId, input.patientId);
	}

	if (!thread) {
		throw new Error('Could not open the associate AI thread.');
	}

	const messageId = crypto.randomUUID();
	await db.insert(conversationMessage).values({
		id: messageId,
		threadId: thread.id,
		patientId: input.patientId,
		senderUserId: input.senderUserId ?? null,
		role: input.role,
		content,
		modality: 'text',
		visibility: 'shared',
		metadataJson: input.metadataJson ?? '{}',
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
		messageId
	};
}

export async function listAssociateAiConversationsForAssociate(
	associateId: string
): Promise<AssociateAIConversationView[]> {
	const assignments = await db.query.associatePatientAssignment.findMany({
		where: eq(associatePatientAssignment.associateId, associateId),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
		with: {
			patient: {
				columns: {
					id: true,
					name: true,
					email: true
				}
			},
			associate: {
				columns: {
					id: true,
					name: true
				}
			}
		}
	});

	const patientIds = assignments.map((assignment) => assignment.patientId);
	if (patientIds.length === 0) {
		return [];
	}

	const threads = await db.query.conversationThread.findMany({
		where: and(
			eq(conversationThread.channel, ASSOCIATE_AI_CHANNEL),
			eq(conversationThread.associateId, associateId),
			inArray(conversationThread.patientId, patientIds)
		),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.lastMessageAt), orderDesc(table.createdAt)]
	});
	const messagesByThreadId = await loadMessagesByThreadIds(threads.map((thread) => thread.id), [
		'associate',
		'assistant'
	]);
	const threadByPatientId = new Map(threads.map((thread) => [thread.patientId, thread]));

	return assignments
		.filter((assignment) => assignment.patient && assignment.associate)
		.map((assignment) => {
			const thread = threadByPatientId.get(assignment.patientId) ?? null;
			const messages = thread ? messagesByThreadId.get(thread.id) ?? [] : [];
			const lastMessage = messages.at(-1);

			return {
				threadId: thread?.id ?? null,
				patientId: assignment.patientId,
				patientName: assignment.patient!.name,
				patientEmail: assignment.patient!.email,
				associateId,
				associateName: assignment.associate!.name,
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
