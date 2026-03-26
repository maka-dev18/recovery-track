import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
	conversationMessage,
	conversationThread,
	patientRecoveryProfile,
	patientSignal,
	therapySession
} from '$lib/server/db/schema';

export const conversationThreadChannelValues = [
	'ai_companion',
	'therapist_direct',
	'associate_direct',
	'associate_ai',
	'care_team'
] as const;
export type ConversationThreadChannel = (typeof conversationThreadChannelValues)[number];

export const conversationThreadStatusValues = ['active', 'archived', 'closed'] as const;
export type ConversationThreadStatus = (typeof conversationThreadStatusValues)[number];

export const conversationMessageRoleValues = [
	'patient',
	'therapist',
	'associate',
	'assistant',
	'system'
] as const;
export type ConversationMessageRole = (typeof conversationMessageRoleValues)[number];

export const conversationMessageVisibilityValues = ['shared', 'clinical', 'internal'] as const;
export type ConversationMessageVisibility = (typeof conversationMessageVisibilityValues)[number];

export const therapySessionModeValues = ['in_person', 'video', 'phone', 'async'] as const;
export type TherapySessionMode = (typeof therapySessionModeValues)[number];

export const therapySessionStatusValues = [
	'scheduled',
	'in_progress',
	'completed',
	'cancelled',
	'no_show'
] as const;
export type TherapySessionStatus = (typeof therapySessionStatusValues)[number];

export const therapySessionRiskLevelValues = ['low', 'moderate', 'high', 'critical'] as const;
export type TherapySessionRiskLevel = (typeof therapySessionRiskLevelValues)[number];

export const patientSignalSourceValues = [
	'checkin',
	'observation',
	'conversation',
	'therapy_session',
	'history_import',
	'manual',
	'risk_engine'
] as const;
export type PatientSignalSource = (typeof patientSignalSourceValues)[number];

export type ConversationThreadRecord = InferSelectModel<typeof conversationThread>;
export type NewConversationThread = InferInsertModel<typeof conversationThread>;

export type ConversationMessageRecord = InferSelectModel<typeof conversationMessage>;
export type NewConversationMessage = InferInsertModel<typeof conversationMessage>;

export type TherapySessionRecord = InferSelectModel<typeof therapySession>;
export type NewTherapySession = InferInsertModel<typeof therapySession>;

export type PatientRecoveryProfileRecord = InferSelectModel<typeof patientRecoveryProfile>;
export type NewPatientRecoveryProfile = InferInsertModel<typeof patientRecoveryProfile>;

export type PatientSignalRecord = InferSelectModel<typeof patientSignal>;
export type NewPatientSignal = InferInsertModel<typeof patientSignal>;

type StringListOptions = {
	maxItems?: number;
	maxLength?: number;
};

export type TherapySessionNoteShape = {
	presentation: string;
	interventions: string[];
	response: string;
	homework: string[];
	riskLevel: TherapySessionRiskLevel | null;
	nextSteps: string;
};

const emptyTherapySessionNote: TherapySessionNoteShape = {
	presentation: '',
	interventions: [],
	response: '',
	homework: [],
	riskLevel: null,
	nextSteps: ''
};

export function normalizeFreeText(
	value: string | null | undefined,
	options: { maxLength?: number } = {}
): string {
	const maxLength = options.maxLength ?? 4000;

	if (typeof value !== 'string') {
		return '';
	}

	return value.trim().slice(0, maxLength);
}

export function sanitizeStringList(
	values: Iterable<string | null | undefined>,
	options: StringListOptions = {}
): string[] {
	const maxItems = options.maxItems ?? 12;
	const maxLength = options.maxLength ?? 120;
	const unique = new Set<string>();

	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}

		const normalized = value.trim();
		if (!normalized) {
			continue;
		}

		unique.add(normalized.slice(0, maxLength));
		if (unique.size >= maxItems) {
			break;
		}
	}

	return [...unique];
}

export function serializeStringList(values: Iterable<string | null | undefined>): string {
	return JSON.stringify(sanitizeStringList(values));
}

export function serializeJsonObject(value: Record<string, unknown> | null | undefined): string {
	if (!value) {
		return '{}';
	}

	return JSON.stringify(value);
}

export function parseDelimitedStringList(
	value: string | null | undefined,
	options: StringListOptions = {}
): string[] {
	if (typeof value !== 'string') {
		return [];
	}

	return sanitizeStringList(value.split(/[\n,;]+/), options);
}

export function parseOptionalDateTimeInput(value: string | null | undefined): Date | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();
	if (!normalized) {
		return null;
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return parsed;
}

export function normalizeTherapySessionRiskLevel(
	value: string | null | undefined
): TherapySessionRiskLevel | null {
	if (!value) {
		return null;
	}

	return therapySessionRiskLevelValues.includes(value as TherapySessionRiskLevel)
		? (value as TherapySessionRiskLevel)
		: null;
}

export function serializeTherapySessionNotes(
	value: Partial<TherapySessionNoteShape> | null | undefined
): string {
	return JSON.stringify({
		presentation: normalizeFreeText(value?.presentation, { maxLength: 1600 }),
		interventions: sanitizeStringList(value?.interventions ?? [], { maxItems: 10, maxLength: 120 }),
		response: normalizeFreeText(value?.response, { maxLength: 1600 }),
		homework: sanitizeStringList(value?.homework ?? [], { maxItems: 10, maxLength: 120 }),
		riskLevel: normalizeTherapySessionRiskLevel(value?.riskLevel ?? null),
		nextSteps: normalizeFreeText(value?.nextSteps, { maxLength: 1600 })
	} satisfies TherapySessionNoteShape);
}

export function parseTherapySessionNotes(raw: string | null | undefined): TherapySessionNoteShape {
	if (!raw) {
		return { ...emptyTherapySessionNote };
	}

	try {
		const parsed = JSON.parse(raw) as Partial<TherapySessionNoteShape>;

		return {
			presentation: normalizeFreeText(parsed.presentation, { maxLength: 1600 }),
			interventions: sanitizeStringList(parsed.interventions ?? [], {
				maxItems: 10,
				maxLength: 120
			}),
			response: normalizeFreeText(parsed.response, { maxLength: 1600 }),
			homework: sanitizeStringList(parsed.homework ?? [], { maxItems: 10, maxLength: 120 }),
			riskLevel: normalizeTherapySessionRiskLevel(parsed.riskLevel ?? null),
			nextSteps: normalizeFreeText(parsed.nextSteps, { maxLength: 1600 })
		};
	} catch {
		return {
			...emptyTherapySessionNote,
			presentation: normalizeFreeText(raw, { maxLength: 1600 })
		};
	}
}

export function normalizeSignalSeverity(value: number | null | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.min(100, Math.round(value)));
}
