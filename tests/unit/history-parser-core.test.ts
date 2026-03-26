import { describe, expect, it } from 'vitest';
import {
	extractSignalsFromCsvText,
	inferTextRiskWeight,
	normalizeCsvHeader
} from '../../src/lib/server/history/parser-core';

describe('normalizeCsvHeader', () => {
	it('normalizes common exported history headers into stable keys', () => {
		expect(normalizeCsvHeader('Mood Score')).toBe('mood');
		expect(normalizeCsvHeader('Sleep Hours')).toBe('sleep_hours');
		expect(normalizeCsvHeader('Recorded At')).toBe('recorded_at');
		expect(normalizeCsvHeader('Risk Triggers')).toBe('risk_trigger');
		expect(normalizeCsvHeader('Support Network')).toBe('supports');
	});
});

describe('extractSignalsFromCsvText', () => {
	it('extracts normalized records, summary text, triggers, patterns, and protective factors', () => {
		const csvText = [
			'Recorded At,Mood Score,Craving Score,Stress Level,Sleep Hours,Risk Trigger,Return Pattern,Protective Factors,Support Network',
			'2026-02-03,2,8,7,4,"arguments|loneliness","isolates; skips meetings","journaling; morning walk","older sister"',
			'2026-02-10,4,5,6,6,"work stress","stops checking in","group support","sponsor"'
		].join('\n');

		const signals = extractSignalsFromCsvText(csvText);
		const historySummary = signals.find((signal) => signal.signalType === 'history_summary');
		const firstHistoricalRecord = signals.find((signal) => signal.signalType === 'historical_record');
		const triggerLabels = signals
			.filter((signal) => signal.signalType === 'relapse_trigger')
			.map((signal) => signal.signalValue.label);
		const patternSummaries = signals
			.filter((signal) => signal.signalType === 'return_pattern')
			.map((signal) => signal.signalValue.summary);
		const protectiveLabels = signals
			.filter((signal) => signal.signalType === 'protective_factor')
			.map((signal) => signal.signalValue.label);

		expect(historySummary?.signalValue.summary).toContain('cover 2 entries from 2026-02-03 to 2026-02-10');
		expect(historySummary?.signalValue.summary).toContain('average mood 3.0/5');
		expect(historySummary?.signalValue.summary).toContain('average craving 6.5/10');
		expect(historySummary?.signalValue.summary).toContain('average sleep 5.0 hours');
		expect(firstHistoricalRecord?.signalValue.row).toMatchObject({
			recorded_at: '2026-02-03',
			mood: '2',
			craving: '8',
			stress: '7',
			sleep_hours: '4',
			risk_trigger: 'arguments|loneliness',
			return_pattern: 'isolates; skips meetings',
			protective_factors: 'journaling; morning walk',
			supports: 'older sister'
		});
		expect(triggerLabels).toEqual(expect.arrayContaining(['arguments', 'loneliness', 'work stress']));
		expect(patternSummaries).toEqual(
			expect.arrayContaining(['isolates', 'skips meetings', 'stops checking in'])
		);
		expect(protectiveLabels).toEqual(
			expect.arrayContaining(['journaling', 'morning walk', 'group support', 'older sister', 'sponsor'])
		);
	});

	it('rejects empty CSV files instead of silently succeeding', () => {
		expect(() => extractSignalsFromCsvText('Recorded At,Mood Score\n')).toThrow(
			'CSV history file did not contain any patient records.'
		);
	});
});

describe('inferTextRiskWeight', () => {
	it('scores high-risk narratives above stable recovery narratives', () => {
		const highRisk = inferTextRiskWeight('Relapse occurred after missed session and unsafe overdose behavior.');
		const stable = inferTextRiskWeight('Improving with a stable housing plan and strong support network.');

		expect(highRisk).toBeGreaterThan(stable);
		expect(highRisk).toBeGreaterThanOrEqual(70);
		expect(stable).toBeLessThanOrEqual(35);
	});
});
