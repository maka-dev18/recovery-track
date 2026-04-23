import { and, desc, eq, inArray } from 'drizzle-orm';
import { normalizeFreeText } from '$lib/server/clinical';
import { db } from '$lib/server/db';
import { patientSignal, therapistPatientAssignment } from '$lib/server/db/schema';
import { getTherapistPatientIds } from '$lib/server/relationships';

type SignalType =
	| 'safety_risk'
	| 'relapse_risk'
	| 'engagement_drop'
	| 'coping_progress'
	| 'habit_change'
	| 'support_update';

type HeuristicSignal = {
	signalType: SignalType;
	severity: number;
	confidence: number;
	summary: string;
	tags: string[];
};

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function buildSummary(text: string, prefix: string) {
	const normalized = normalizeFreeText(text.replace(/\s+/g, ' '), { maxLength: 220 });
	return normalized ? `${prefix}: ${normalized}` : prefix;
}

function detectSignal(text: string, source: string): HeuristicSignal {
	const lowered = text.toLowerCase();

	if (/(suicide|self harm|end my life|hurt myself|unsafe|overdose)/.test(lowered)) {
		return {
			signalType: 'safety_risk',
			severity: 92,
			confidence: 88,
			summary: buildSummary(text, `${source} flagged immediate safety risk`),
			tags: ['safety', 'urgent']
		};
	}

	if (/(relapse|use again|drink again|drug|craving|trigger|withdrawal)/.test(lowered)) {
		return {
			signalType: 'relapse_risk',
			severity: /(relapse|use again|drink again)/.test(lowered) ? 76 : 62,
			confidence: 82,
			summary: buildSummary(text, `${source} reported relapse-risk language`),
			tags: ['relapse', 'craving']
		};
	}

	if (/(missed session|no show|isolated|not logging in|not responding|stopped)/.test(lowered)) {
		return {
			signalType: 'engagement_drop',
			severity: 54,
			confidence: 74,
			summary: buildSummary(text, `${source} suggests disengagement from recovery support`),
			tags: ['engagement']
		};
	}

	if (/(sleep|diet|appetite|meal|exercise|routine|work|school|activity)/.test(lowered)) {
		return {
			signalType: 'habit_change',
			severity: 35,
			confidence: 68,
			summary: buildSummary(text, `${source} captured a daily-habit update`),
			tags: ['habits']
		};
	}

	if (/(meeting|sponsor|journal|therapy homework|coping|grounding|breathing|support)/.test(lowered)) {
		return {
			signalType: 'coping_progress',
			severity: 18,
			confidence: 72,
			summary: buildSummary(text, `${source} highlighted coping or protective behavior`),
			tags: ['coping', 'protective']
		};
	}

	return {
		signalType: 'support_update',
		severity: 22,
		confidence: 55,
		summary: buildSummary(text, `${source} added a recovery support update`),
		tags: ['support']
	};
}

export async function createPatientSignal(args: {
	patientId: string;
	source:
		| 'conversation'
		| 'therapy_session'
		| 'manual'
		| 'risk_engine'
		| 'history_import'
		| 'checkin'
		| 'observation';
	signalType: string;
	summary: string;
	severity: number;
	confidence: number;
	payload?: Record<string, unknown>;
	threadId?: string | null;
	messageId?: string | null;
	therapySessionId?: string | null;
	riskScoreId?: string | null;
	detectedByUserId?: string | null;
	occurredAt?: Date;
	status?: string;
}) {
	const signalId = crypto.randomUUID();
	await db.insert(patientSignal).values({
		id: signalId,
		patientId: args.patientId,
		threadId: args.threadId ?? null,
		messageId: args.messageId ?? null,
		therapySessionId: args.therapySessionId ?? null,
		riskScoreId: args.riskScoreId ?? null,
		detectedByUserId: args.detectedByUserId ?? null,
		source: args.source,
		signalType: args.signalType,
		status: args.status ?? 'observed',
		severity: clamp(args.severity, 0, 100),
		confidence: clamp(args.confidence, 0, 100),
		summary: normalizeFreeText(args.summary, { maxLength: 500 }),
		payloadJson: JSON.stringify(args.payload ?? {}),
		occurredAt: args.occurredAt ?? new Date()
	});

	return signalId;
}

export async function analyzeTextIntoPatientSignal(args: {
	patientId: string;
	text: string;
	source: 'conversation' | 'therapy_session' | 'manual' | 'observation' | 'checkin';
	originLabel: string;
	threadId?: string | null;
	messageId?: string | null;
	therapySessionId?: string | null;
	detectedByUserId?: string | null;
	extraPayload?: Record<string, unknown>;
}) {
	const text = normalizeFreeText(args.text, { maxLength: 4_000 });
	if (!text) {
		return null;
	}

	const detected = detectSignal(text, args.originLabel);
	return createPatientSignal({
		patientId: args.patientId,
		source: args.source,
		signalType: detected.signalType,
		summary: detected.summary,
		severity: detected.severity,
		confidence: detected.confidence,
		threadId: args.threadId ?? null,
		messageId: args.messageId ?? null,
		therapySessionId: args.therapySessionId ?? null,
		detectedByUserId: args.detectedByUserId ?? null,
		payload: {
			textPreview: text.slice(0, 220),
			tags: detected.tags,
			originLabel: args.originLabel,
			...args.extraPayload
		}
	});
}

export async function listRecentSignalsForTherapist(therapistId: string, limit = 40) {
	const patientIds = await getTherapistPatientIds(therapistId);
	if (patientIds.length === 0) {
		return [];
	}

	const rows = await db.query.patientSignal.findMany({
		where: inArray(patientSignal.patientId, patientIds),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.occurredAt), orderDesc(table.createdAt)],
		limit,
		with: {
			patient: {
				columns: {
					id: true,
					name: true
				}
			},
			detectedByUser: {
				columns: {
					id: true,
					name: true,
					role: true
				}
			}
		}
	});

	return rows
		.filter((row) => row.patient)
		.map((row) => ({
			id: row.id,
			patientId: row.patientId,
			patientName: row.patient!.name,
			source: row.source,
			signalType: row.signalType,
			status: row.status,
			severity: row.severity,
			confidence: row.confidence,
			summary: row.summary,
			occurredAt: row.occurredAt,
			detectedBy:
				row.detectedByUser?.name ??
				(row.source === 'therapy_session' ? 'Therapy session' : 'Signal engine')
		}));
}

export async function listRecentSignalsForPatient(patientId: string, limit = 20) {
	return db.query.patientSignal.findMany({
		where: eq(patientSignal.patientId, patientId),
		orderBy: (table, { desc: orderDesc }) => [orderDesc(table.occurredAt), orderDesc(table.createdAt)],
		limit
	});
}
