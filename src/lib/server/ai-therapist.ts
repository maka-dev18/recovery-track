import { desc, eq } from 'drizzle-orm';
import { deidentifyText } from '$lib/server/ai/deidentify';
import { buildPatientContextEvidenceSummary } from '$lib/server/ai-therapist-tools';
import { db } from '$lib/server/db';
import { patientCheckin, patientHistorySignal } from '$lib/server/db/schema';
import { getPatientPersonalizationContext } from '$lib/server/recovery-profile';
import { getPreferredName, virtualTherapistProfile } from '$lib/shared/virtual-therapist';

export function summarizeCheckins(
	checkins: Array<{
		mood: number;
		craving: number;
		stress: number;
		sleepHours: number;
		note: string | null;
		createdAt: Date;
	}>
): string {
	if (checkins.length === 0) {
		return 'No recent check-ins available.';
	}

	return checkins
		.map((checkin) => {
			const note = checkin.note ? ` note=${deidentifyText(checkin.note).slice(0, 120)}` : '';
			return `${checkin.createdAt.toISOString()}: mood=${checkin.mood}, substance_use_urge=${checkin.craving}, stress=${checkin.stress}, sleep=${checkin.sleepHours}${note}`;
		})
		.join('\n');
}

export function summarizeHistorySignals(
	historySignals: Array<{ signalType: string; signalValueJson: string; confidence: number; createdAt: Date }>
): string {
	if (historySignals.length === 0) {
		return 'No historical rehabilitation signals parsed yet.';
	}

	return historySignals
		.map((signal) => {
			let riskWeight = 'n/a';
			let excerpt = '';
			try {
				const parsed = JSON.parse(signal.signalValueJson) as {
					riskWeight?: unknown;
					summary?: unknown;
					label?: unknown;
				};
				if (typeof parsed.riskWeight === 'number') {
					riskWeight = String(Math.round(parsed.riskWeight));
				}

				if (typeof parsed.summary === 'string') {
					excerpt = parsed.summary.slice(0, 120);
				} else if (typeof parsed.label === 'string') {
					excerpt = parsed.label.slice(0, 80);
				}
			} catch {
				excerpt = '';
			}

			return `${signal.createdAt.toISOString()}: ${signal.signalType} riskWeight=${riskWeight} confidence=${signal.confidence}${excerpt ? ` summary=${deidentifyText(excerpt)}` : ''}`;
		})
		.join('\n');
}

export async function buildPatientAiTherapistSystemPrompt(input: {
	patientId: string;
	patientName: string;
	channel: 'text' | 'live_voice';
	hasAssistantHistory: boolean;
}) {
	const [recentCheckins, recentHistorySignals, personalizationContext, evidenceCoverage] = await Promise.all([
		db.query.patientCheckin.findMany({
			where: eq(patientCheckin.patientId, input.patientId),
			orderBy: (table, { desc }) => [desc(table.createdAt)],
			limit: 6
		}),
		db.query.patientHistorySignal.findMany({
			where: eq(patientHistorySignal.patientId, input.patientId),
			orderBy: (table, { desc }) => [desc(table.createdAt)],
			limit: 10
		}),
		getPatientPersonalizationContext(input.patientId),
		buildPatientContextEvidenceSummary(input.patientId)
	]);

	const preferredName = getPreferredName(input.patientName);
	const sessionStyleInstruction =
		input.channel === 'live_voice'
			? 'This is a live voice session. Keep responses warm, brief, and easy to say out loud.'
			: 'This is a text conversation. Keep responses warm, direct, and easy to scan.';
	const openingInstruction = input.hasAssistantHistory
		? `Continue the existing conversation with ${preferredName} without re-introducing yourself.`
		: `This is the first reply in this session. Start with a short greeting that uses ${preferredName}'s name once instead of generic openings like "Hi there".`;

	return [
		`You are ${virtualTherapistProfile.name}, a recovery-support therapist-style assistant for Recovery Track.`,
		`You are speaking directly with ${input.patientName}. You already know who the patient is from their account and uploaded rehabilitation history.`,
		`Address the patient naturally as ${preferredName}. Never say you do not know their name or background when the context below gives it to you.`,
		'If you need additional or more up-to-date patient information, use the available patient context tools instead of guessing.',
		'Before giving relapse-risk, care-plan, or progress analysis, use the patient context tools to check history, status, careTeam, support, and engagement unless the answer is purely generic.',
		'In patient-specific answers, include a short "What I checked" line that names the source categories used, such as patient check-ins, associate observations, therapist sessions/conversations, historical file extraction, risk alerts, and engagement data. If a category has no data, say it was not available instead of pretending.',
		'When analyzing relapse risk, separate the evidence by source: patient self-report, associate reports, therapist/care-team data, historical rehab records, and app engagement.',
		'If the patient asks whether you know their history, answer with a brief, clear summary of their rehabilitation journey, likely triggers, return-to-use patterns, and protective factors from the uploaded records.',
		'Use the known triggers, warning signs, and protective factors from the uploaded history when suggesting coping steps or relapse-prevention advice.',
		openingInstruction,
		sessionStyleInstruction,
		'Use motivational interviewing style and avoid medical diagnosis claims.',
		'If high-risk intent is expressed, tell the patient to contact their therapist or care team immediately and keep the guidance focused on reaching that therapist support.',
		`Available data source coverage:\n${evidenceCoverage}`,
		`Patient personalization profile:\n${personalizationContext}`,
		`Recent check-in summary:\n${summarizeCheckins(recentCheckins)}`,
		`Historical rehab signal summary:\n${summarizeHistorySignals(recentHistorySignals)}`
	].join('\n\n');
}
