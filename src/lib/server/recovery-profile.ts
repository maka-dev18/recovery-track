import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	patientHistorySignal,
	patientRecoveryProfile,
	riskScore
} from '$lib/server/db/schema';
import { getPreferredName } from '$lib/shared/virtual-therapist';

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function extractRiskWeight(signalValueJson: string): number | null {
	try {
		const parsed = JSON.parse(signalValueJson) as { riskWeight?: unknown };
		if (typeof parsed.riskWeight === 'number' && Number.isFinite(parsed.riskWeight)) {
			return clamp(parsed.riskWeight, 0, 100);
		}
	} catch {
		// Ignore invalid payloads
	}

	return null;
}

function extractText(signalValueJson: string): string {
	try {
		const parsed = JSON.parse(signalValueJson) as { summary?: unknown; label?: unknown; note?: unknown };
		for (const candidate of [parsed.summary, parsed.label, parsed.note]) {
			if (typeof candidate === 'string' && candidate.trim()) {
				return candidate.trim();
			}
		}
	} catch {
		// Ignore invalid payloads
	}

	return '';
}

function extractStructuredFields(signalValueJson: string) {
	try {
		const parsed = JSON.parse(signalValueJson) as {
			summary?: unknown;
			label?: unknown;
			note?: unknown;
			row?: Record<string, unknown>;
		};

		return {
			summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
			label: typeof parsed.label === 'string' ? parsed.label.trim() : '',
			note: typeof parsed.note === 'string' ? parsed.note.trim() : '',
			row: parsed.row && typeof parsed.row === 'object' ? parsed.row : null
		};
	} catch {
		return {
			summary: '',
			label: '',
			note: '',
			row: null
		};
	}
}

function parseDelimitedTextList(value: unknown) {
	if (Array.isArray(value)) {
		return value
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	if (typeof value !== 'string') {
		return [];
	}

	return value
		.split(/[\n,;|]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getRowFields(row: Record<string, unknown> | null, keys: string[]) {
	if (!row) {
		return [];
	}

	const values: unknown[] = [];
	for (const key of keys) {
		const value = row[key];
		if (value != null && `${value}`.trim() !== '') {
			values.push(value);
		}
	}

	return values;
}

function collectHistoryInsights(
	historySignals: Array<{ signalType: string; signalValueJson: string }>
) {
	const journeySummaries: string[] = [];
	const triggerCandidates = new Set<string>();
	const patternCandidates = new Set<string>();
	const protectiveCandidates = new Set<string>();

	for (const signal of historySignals) {
		const fields = extractStructuredFields(signal.signalValueJson);
		const primaryText = fields.summary || fields.label || fields.note;

		if (signal.signalType === 'history_summary' && fields.summary) {
			journeySummaries.push(fields.summary);
		}

		if (signal.signalType === 'rehab_journey' && fields.summary) {
			journeySummaries.push(fields.summary);
		}

		if (signal.signalType === 'relapse_trigger') {
			if (fields.label) triggerCandidates.add(fields.label);
			if (fields.summary) triggerCandidates.add(fields.summary);
		}

		if (signal.signalType === 'return_pattern') {
			if (fields.summary) patternCandidates.add(fields.summary);
			if (fields.label) patternCandidates.add(fields.label);
		}

		if (signal.signalType === 'protective_factor') {
			if (fields.label) protectiveCandidates.add(fields.label);
			if (fields.summary) protectiveCandidates.add(fields.summary);
		}

		if (signal.signalType === 'warning_signal') {
			if (primaryText && triggerCandidates.size < 6) {
				triggerCandidates.add(primaryText);
			}

			if (fields.note && patternCandidates.size < 5) {
				patternCandidates.add(fields.note);
			}
		}

		if (signal.signalType === 'historical_record') {
			for (const value of getRowFields(fields.row, ['trigger', 'triggers', 'stressor', 'stressors', 'risk_trigger'])) {
				for (const trigger of parseDelimitedTextList(value)) {
					triggerCandidates.add(trigger);
				}
			}

			for (const value of getRowFields(fields.row, ['pattern', 'relapse_pattern', 'return_pattern', 'warning_pattern'])) {
				for (const pattern of parseDelimitedTextList(value)) {
					patternCandidates.add(pattern);
				}
			}

			for (const value of getRowFields(fields.row, [
				'protective_factor',
				'protective_factors',
				'coping_tool',
				'coping_tools',
				'support',
				'supports'
			])) {
				for (const protective of parseDelimitedTextList(value)) {
					protectiveCandidates.add(protective);
				}
			}
		}
	}

	return {
		journeySummary: journeySummaries.find(Boolean) ?? '',
		triggers: [...triggerCandidates].slice(0, 6),
		returnPatterns: [...patternCandidates].slice(0, 5),
		protectiveFactors: [...protectiveCandidates].slice(0, 6)
	};
}

function deriveRecoveryStage(averageWeight: number, latestRiskTier: string | null) {
	if (latestRiskTier === 'critical' || latestRiskTier === 'high' || averageWeight >= 65) {
		return 'high_support';
	}

	if (averageWeight >= 40) {
		return 'stabilizing';
	}

	return 'maintenance';
}

function deriveGoals(sourceText: string) {
	const goals = new Set<string>();

	if (/sleep|rest/i.test(sourceText)) goals.add('Improve sleep consistency');
	if (/stress|anxiety/i.test(sourceText)) goals.add('Reduce daily stress triggers');
	if (/meeting|sponsor|support/i.test(sourceText)) goals.add('Maintain support-network contact');
	if (/diet|meal|appetite/i.test(sourceText)) goals.add('Protect nutrition and meal routine');
	if (/journal|coping|grounding/i.test(sourceText)) goals.add('Use coping tools before urges escalate');

	if (goals.size === 0) {
		goals.add('Maintain consistent daily recovery check-ins');
	}

	return [...goals].slice(0, 5);
}

function deriveSupportPreferences(sourceText: string) {
	return {
		prefersSponsorContact: /sponsor/i.test(sourceText),
		prefersFamilySupport: /family|associate|guardian/i.test(sourceText),
		prefersStructuredMeetings: /meeting|group/i.test(sourceText),
		prefersSkillsBasedSupport: /coping|grounding|journal|cbt/i.test(sourceText)
	};
}

function summarizeSupportPreferences(raw: string | null | undefined) {
	if (!raw) {
		return '';
	}

	try {
		const parsed = JSON.parse(raw) as {
			prefersSponsorContact?: unknown;
			prefersFamilySupport?: unknown;
			prefersStructuredMeetings?: unknown;
			prefersSkillsBasedSupport?: unknown;
		};
		const preferences: string[] = [];
		if (parsed.prefersSponsorContact === true) preferences.push('sponsor contact');
		if (parsed.prefersFamilySupport === true) preferences.push('family or associate support');
		if (parsed.prefersStructuredMeetings === true) preferences.push('structured meetings');
		if (parsed.prefersSkillsBasedSupport === true) preferences.push('skills-based coping tools');
		return preferences.join(', ');
	} catch {
		return '';
	}
}

export type PatientHistoryInsightSnapshot = {
	journeySummary: string;
	triggers: string[];
	returnPatterns: string[];
	protectiveFactors: string[];
};

export type PatientPersonalizationSnapshot = {
	patientName: string | null;
	preferredName: string | null;
	recoveryStage: string;
	baselineRiskLevel: string | null;
	goals: string[];
	supportPreferences: string[];
	currentRisk: {
		tier: string;
		score: number;
	} | null;
	historySignalsSummary: string;
	journeySummary: string;
	triggers: string[];
	returnPatterns: string[];
	protectiveFactors: string[];
	uploadedHistoryNotes: string;
};

export async function syncPatientRecoveryProfile(patientId: string) {
	const [historySignals, latestRisk] = await Promise.all([
		db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 24
		}),
		db.query.riskScore.findFirst({
			where: eq(riskScore.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
		})
	]);

	const weights = historySignals
		.map((signal) => extractRiskWeight(signal.signalValueJson))
		.filter((value): value is number => value !== null);
	const averageWeight = weights.length > 0 ? weights.reduce((sum, value) => sum + value, 0) / weights.length : 35;
	const combinedText = historySignals.map((signal) => extractText(signal.signalValueJson)).join(' ');
	const goals = deriveGoals(combinedText);
	const supportPreferences = deriveSupportPreferences(combinedText);
	const baselineRiskLevel =
		averageWeight >= 70 ? 'high' : averageWeight >= 50 ? 'moderate' : averageWeight >= 30 ? 'guarded' : 'low';
	const recoveryStage = deriveRecoveryStage(averageWeight, latestRisk?.tier ?? null);

	await db
		.insert(patientRecoveryProfile)
		.values({
			patientId,
			recoveryStage,
			carePlanStatus: 'active',
			baselineRiskLevel,
			primaryGoalsJson: JSON.stringify(goals),
			supportPreferencesJson: JSON.stringify(supportPreferences),
			lastReviewedAt: new Date(),
			notes: combinedText.slice(0, 1_500) || null
		})
		.onConflictDoUpdate({
			target: patientRecoveryProfile.patientId,
			set: {
				recoveryStage,
				carePlanStatus: 'active',
				baselineRiskLevel,
				primaryGoalsJson: JSON.stringify(goals),
				supportPreferencesJson: JSON.stringify(supportPreferences),
				lastReviewedAt: new Date(),
				notes: combinedText.slice(0, 1_500) || null
			}
		});
}

export async function getPatientPersonalizationSnapshot(
	patientId: string
): Promise<PatientPersonalizationSnapshot> {
	const [profile, historySignals, latestRisk, patientRecord] = await Promise.all([
		db.query.patientRecoveryProfile.findFirst({
			where: eq(patientRecoveryProfile.patientId, patientId)
		}),
		db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)],
			limit: 6
		}),
		db.query.riskScore.findFirst({
			where: eq(riskScore.patientId, patientId),
			orderBy: (table, { desc: orderDesc }) => [orderDesc(table.createdAt)]
		}),
		db.query.user.findFirst({
			where: (table, { eq: equals }) => equals(table.id, patientId),
			columns: {
				name: true
			}
		})
	]);

	const historySummary = historySignals
		.map((signal) => extractText(signal.signalValueJson))
		.filter(Boolean)
		.slice(0, 4)
		.join(' | ');
	const historyInsights = collectHistoryInsights(historySignals);

	let goalSummary = '';
	if (profile?.primaryGoalsJson) {
		try {
			const parsed = JSON.parse(profile.primaryGoalsJson) as unknown;
			if (Array.isArray(parsed)) {
				goalSummary = parsed.filter((entry): entry is string => typeof entry === 'string').join(', ');
			}
		} catch {
			goalSummary = '';
		}
	}

	const supportSummary = summarizeSupportPreferences(profile?.supportPreferencesJson ?? null);
	const preferredName = patientRecord?.name ? getPreferredName(patientRecord.name) : null;
	const profileNotes = profile?.notes?.trim().slice(0, 240) ?? '';
	const journeySummary = historyInsights.journeySummary || profileNotes;
	const protectiveFactors =
		historyInsights.protectiveFactors.length > 0
			? historyInsights.protectiveFactors
			: [...new Set([supportSummary, ...goalSummary.split(',').map((entry) => entry.trim()).filter(Boolean)])];
	const supportPreferences = supportSummary
		? supportSummary
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];

	return {
		patientName: patientRecord?.name ?? null,
		preferredName,
		recoveryStage: profile?.recoveryStage ?? 'active recovery',
		baselineRiskLevel: profile?.baselineRiskLevel ?? null,
		goals: goalSummary
			? goalSummary
					.split(',')
					.map((entry) => entry.trim())
					.filter(Boolean)
			: [],
		supportPreferences,
		currentRisk: latestRisk
			? {
					tier: latestRisk.tier,
					score: latestRisk.score
				}
			: null,
		historySignalsSummary: historySummary,
		journeySummary,
		triggers: historyInsights.triggers,
		returnPatterns: historyInsights.returnPatterns,
		protectiveFactors,
		uploadedHistoryNotes: profileNotes
	};
}

export async function getPatientPersonalizationContext(patientId: string) {
	const snapshot = await getPatientPersonalizationSnapshot(patientId);

	return [
		snapshot.patientName ? `Patient name: ${snapshot.patientName}.` : null,
		snapshot.preferredName ? `Use ${snapshot.preferredName} when greeting the patient.` : null,
		snapshot.journeySummary ? `Rehabilitation journey summary: ${snapshot.journeySummary}.` : null,
		`Recovery stage: ${snapshot.recoveryStage}.`,
		snapshot.baselineRiskLevel ? `Baseline risk: ${snapshot.baselineRiskLevel}.` : null,
		snapshot.goals.length > 0 ? `Goals: ${snapshot.goals.join(', ')}.` : null,
		snapshot.triggers.length > 0
			? `Likely triggers from uploaded history: ${snapshot.triggers.join(', ')}.`
			: null,
		snapshot.returnPatterns.length > 0
			? `Patterns that can lead back to old behavior: ${snapshot.returnPatterns.join(', ')}.`
			: null,
		snapshot.protectiveFactors.length > 0
			? `Protective factors and stabilizers: ${snapshot.protectiveFactors.join(', ')}.`
			: null,
		snapshot.supportPreferences.length > 0
			? `Support preferences: ${snapshot.supportPreferences.join(', ')}.`
			: null,
		snapshot.currentRisk
			? `Current risk tier: ${snapshot.currentRisk.tier} (${snapshot.currentRisk.score}).`
			: null,
		snapshot.historySignalsSummary
			? `History signals: ${snapshot.historySignalsSummary}.`
			: 'History signals: no parsed baseline details yet.',
		snapshot.uploadedHistoryNotes ? `Uploaded history notes: ${snapshot.uploadedHistoryNotes}.` : null
	]
		.filter(Boolean)
		.join(' ');
}
