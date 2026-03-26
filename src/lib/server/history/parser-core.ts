import { parse as parseCsv } from 'csv-parse/sync';

export type HistorySignalCandidate = {
	signalType: string;
	signalValue: Record<string, unknown>;
	confidence: number;
	occurredAt: Date | null;
};

const EMPTY_CSV_ERROR = 'CSV history file did not contain any patient records.';

const CSV_HEADER_ALIASES: Record<string, string> = {
	created: 'created_at',
	created_date: 'created_at',
	created_on: 'created_at',
	craving_level: 'craving',
	craving_score: 'craving',
	coping_mechanism: 'coping_tools',
	coping_mechanisms: 'coping_tools',
	coping_strategy: 'coping_tools',
	coping_strategies: 'coping_tools',
	event_date: 'date',
	logged_at: 'recorded_at',
	logged_on: 'recorded_at',
	mood_level: 'mood',
	mood_score: 'mood',
	protective: 'protective_factor',
	recorded: 'recorded_at',
	recorded_date: 'recorded_at',
	recorded_on: 'recorded_at',
	relapse_trigger: 'risk_trigger',
	relapse_triggers: 'risk_trigger',
	return_patterns: 'return_pattern',
	risk_factors: 'risk_trigger',
	risk_score: 'risk_score',
	risk_trigger: 'risk_trigger',
	risk_triggers: 'risk_trigger',
	session_date: 'date',
	sleep: 'sleep_hours',
	sleep_duration: 'sleep_hours',
	sleep_hour: 'sleep_hours',
	sleephours: 'sleep_hours',
	stress_level: 'stress',
	stress_score: 'stress',
	support_network: 'supports',
	support_networks: 'supports',
	support_people: 'supports',
	support_system: 'supports',
	support_systems: 'supports',
	timestamp_utc: 'timestamp',
	warning_patterns: 'warning_pattern'
};

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function parseNumeric(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return null;
}

export function normalizeCsvHeader(header: string): string {
	const normalized = header
		.replace(/^\ufeff/, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_+/g, '_');

	return CSV_HEADER_ALIASES[normalized] ?? normalized;
}

function isBlankValue(value: unknown): boolean {
	return value == null || `${value}`.trim() === '';
}

function assignIfMissing(
	record: Record<string, unknown>,
	key: string,
	value: unknown
) {
	if (!key || isBlankValue(value)) {
		return;
	}

	if (isBlankValue(record[key])) {
		record[key] = value;
	}
}

export function normalizeCsvRecord(record: Record<string, unknown>): Record<string, unknown> {
	const normalizedRecord: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(record)) {
		assignIfMissing(normalizedRecord, normalizeCsvHeader(key), value);
	}

	return normalizedRecord;
}

function hasMeaningfulValues(record: Record<string, unknown>): boolean {
	return Object.values(record).some((value) => !isBlankValue(value));
}

export function parseDateCandidate(record: Record<string, unknown>): Date | null {
	const dateKeys = [
		'date',
		'timestamp',
		'created_at',
		'recorded_at',
		'occurred_at'
	];

	for (const key of dateKeys) {
		const value = record[key];
		if (value instanceof Date && !Number.isNaN(value.getTime())) {
			return value;
		}

		if (typeof value !== 'string' || value.trim() === '') continue;
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}

	return null;
}

export function parseDelimitedTextList(value: unknown): string[] {
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

function getRecordFields(record: Record<string, unknown>, keys: string[]) {
	const values: unknown[] = [];

	for (const key of keys) {
		const value = record[key];
		if (!isBlankValue(value)) {
			values.push(value);
		}
	}

	return values;
}

function average(values: number[]) {
	if (values.length === 0) {
		return null;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDateLabel(value: Date | null) {
	if (!value) {
		return null;
	}

	return value.toISOString().slice(0, 10);
}

export function buildCsvHistorySummary(rows: Array<Record<string, unknown>>, riskWeights: number[]) {
	if (rows.length === 0) {
		return 'No historical rehabilitation records were available.';
	}

	const dates = rows
		.map((row) => parseDateCandidate(row))
		.filter((value): value is Date => value !== null)
		.sort((left, right) => left.getTime() - right.getTime());
	const averageMood = average(
		rows
			.map((row) => parseNumeric(row.mood))
			.filter((value): value is number => value !== null)
	);
	const averageCraving = average(
		rows
			.map((row) => parseNumeric(row.craving))
			.filter((value): value is number => value !== null)
	);
	const averageStress = average(
		rows
			.map((row) => parseNumeric(row.stress))
			.filter((value): value is number => value !== null)
	);
	const averageSleep = average(
		rows
			.map((row) => parseNumeric(row.sleep_hours ?? row.sleepHours))
			.filter((value): value is number => value !== null)
	);
	const averageRisk = average(riskWeights);

	const opening =
		dates.length > 1
			? `Historical rehab records cover ${rows.length} entries from ${formatDateLabel(dates[0])} to ${formatDateLabel(dates[dates.length - 1])}.`
			: `Historical rehab records include ${rows.length} entries.`;
	const details = [
		averageMood !== null ? `average mood ${averageMood.toFixed(1)}/5` : null,
		averageCraving !== null ? `average craving ${averageCraving.toFixed(1)}/10` : null,
		averageStress !== null ? `average stress ${averageStress.toFixed(1)}/10` : null,
		averageSleep !== null ? `average sleep ${averageSleep.toFixed(1)} hours` : null,
		averageRisk !== null ? `average risk ${Math.round(averageRisk)}/100` : null
	].filter(Boolean);

	return details.length > 0 ? `${opening} ${details.join(', ')}.` : opening;
}

export function scoreHistoricalRecord(record: Record<string, unknown>): number {
	const mood = parseNumeric(record.mood);
	const craving = parseNumeric(record.craving);
	const stress = parseNumeric(record.stress);
	const sleepHours = parseNumeric(record.sleep_hours ?? record.sleepHours);
	const explicitScore = parseNumeric(record.risk_score ?? record.riskScore ?? record.score);

	if (explicitScore !== null) {
		return clamp(Math.round(explicitScore), 0, 100);
	}

	let score = 0;
	if (mood !== null) score += clamp((5 - mood) * 10, 0, 40);
	if (craving !== null) score += clamp(craving * 4, 0, 40);
	if (stress !== null) score += clamp(stress * 2.5, 0, 25);
	if (sleepHours !== null) score += clamp((8 - sleepHours) * 3, 0, 24);

	return clamp(Math.round(score), 0, 100);
}

export function extractSignalsFromCsvText(csvText: string): HistorySignalCandidate[] {
	if (csvText.replace(/^\ufeff/, '').trim() === '') {
		throw new Error(EMPTY_CSV_ERROR);
	}

	const rows = parseCsv(csvText, {
		columns: true,
		bom: true,
		skip_empty_lines: true,
		trim: true,
		relax_column_count: true
	}) as Array<Record<string, unknown>>;

	const limitedRows = rows
		.map((row) => normalizeCsvRecord(row))
		.filter((row) => hasMeaningfulValues(row))
		.slice(0, 500);

	if (limitedRows.length === 0) {
		throw new Error(EMPTY_CSV_ERROR);
	}

	const riskWeights = limitedRows.map((row) => scoreHistoricalRecord(row));
	const signals: HistorySignalCandidate[] = limitedRows.map((row, index) => ({
		signalType: 'historical_record',
		signalValue: {
			riskWeight: riskWeights[index],
			source: 'csv',
			row
		},
		confidence: 80,
		occurredAt: parseDateCandidate(row)
	}));

	signals.unshift({
		signalType: 'history_summary',
		signalValue: {
			riskWeight: Math.round(average(riskWeights) ?? 35),
			source: 'csv',
			summary: buildCsvHistorySummary(limitedRows, riskWeights)
		},
		confidence: 70,
		occurredAt: null
	});

	const triggerCandidates = new Set<string>();
	const patternCandidates = new Set<string>();
	const protectiveCandidates = new Set<string>();

	for (const row of limitedRows) {
		for (const value of getRecordFields(row, ['trigger', 'triggers', 'stressor', 'stressors', 'risk_trigger'])) {
			for (const trigger of parseDelimitedTextList(value)) {
				triggerCandidates.add(trigger.slice(0, 80));
			}
		}

		for (const value of getRecordFields(row, ['pattern', 'relapse_pattern', 'return_pattern', 'warning_pattern'])) {
			for (const pattern of parseDelimitedTextList(value)) {
				patternCandidates.add(pattern.slice(0, 140));
			}
		}

		for (const value of getRecordFields(row, [
			'protective_factor',
			'protective_factors',
			'coping_tool',
			'coping_tools',
			'support',
			'supports'
		])) {
			for (const protective of parseDelimitedTextList(value)) {
				protectiveCandidates.add(protective.slice(0, 80));
			}
		}
	}

	for (const trigger of [...triggerCandidates].slice(0, 8)) {
		signals.push({
			signalType: 'relapse_trigger',
			signalValue: {
				label: trigger,
				source: 'csv'
			},
			confidence: 65,
			occurredAt: null
		});
	}

	for (const pattern of [...patternCandidates].slice(0, 6)) {
		signals.push({
			signalType: 'return_pattern',
			signalValue: {
				summary: pattern,
				source: 'csv'
			},
			confidence: 65,
			occurredAt: null
		});
	}

	for (const protective of [...protectiveCandidates].slice(0, 8)) {
		signals.push({
			signalType: 'protective_factor',
			signalValue: {
				label: protective,
				source: 'csv'
			},
			confidence: 65,
			occurredAt: null
		});
	}

	return signals;
}

export function inferTextRiskWeight(text: string): number {
	const lowered = text.toLowerCase();
	const rules: Array<{ pattern: RegExp; points: number }> = [
		{ pattern: /relapse|reuse|using again|recurrence/g, points: 18 },
		{ pattern: /overdose|self harm|suicid|unsafe/g, points: 28 },
		{ pattern: /missed session|noncompliant|dropout/g, points: 10 },
		{ pattern: /support network|stable housing|adherent|improving/g, points: -8 }
	];

	let score = 35;
	for (const rule of rules) {
		const matches = lowered.match(rule.pattern)?.length ?? 0;
		score += matches * rule.points;
	}

	return clamp(score, 0, 100);
}
