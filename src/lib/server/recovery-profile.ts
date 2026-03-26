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

export async function getPatientPersonalizationContext(patientId: string) {
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

	return [
		patientRecord?.name ? `Patient name: ${patientRecord.name}.` : null,
		preferredName ? `Use ${preferredName} when greeting the patient.` : null,
		profile ? `Recovery stage: ${profile.recoveryStage}.` : 'Recovery stage: active recovery.',
		profile?.baselineRiskLevel ? `Baseline risk: ${profile.baselineRiskLevel}.` : null,
		goalSummary ? `Goals: ${goalSummary}.` : null,
		supportSummary ? `Support preferences: ${supportSummary}.` : null,
		latestRisk ? `Current risk tier: ${latestRisk.tier} (${latestRisk.score}).` : null,
		historySummary ? `History signals: ${historySummary}.` : 'History signals: no parsed baseline details yet.',
		profileNotes ? `Uploaded history notes: ${profileNotes}.` : null
	]
		.filter(Boolean)
		.join(' ');
}
