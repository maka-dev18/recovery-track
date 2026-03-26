import { describe, expect, it } from 'vitest';
import {
	normalizeSignalSeverity,
	parseDelimitedStringList,
	parseOptionalDateTimeInput,
	parseTherapySessionNotes,
	normalizeFreeText,
	sanitizeStringList,
	serializeTherapySessionNotes,
	serializeJsonObject,
	serializeStringList
} from '../../src/lib/server/clinical';

describe('sanitizeStringList', () => {
	it('trims, deduplicates, and limits values in order', () => {
		expect(
			sanitizeStringList(['  relapse prevention  ', '', 'sleep', 'sleep', null, undefined], {
				maxItems: 3,
				maxLength: 20
			})
		).toEqual(['relapse prevention', 'sleep']);
	});

	it('truncates long items and respects maxItems', () => {
		expect(
			sanitizeStringList(['a very long goal name', 'cravings', 'support meetings'], {
				maxItems: 2,
				maxLength: 8
			})
		).toEqual(['a very l', 'cravings']);
	});
});

describe('serialize helpers', () => {
	it('serializes cleaned string lists as JSON', () => {
		expect(serializeStringList([' goals ', 'goals', 'sleep hygiene'])).toBe(
			JSON.stringify(['goals', 'sleep hygiene'])
		);
	});

	it('falls back to an empty object when JSON metadata is missing', () => {
		expect(serializeJsonObject(undefined)).toBe('{}');
		expect(serializeJsonObject(null)).toBe('{}');
	});
});

describe('text and list parsing helpers', () => {
	it('normalizes free text and removes surrounding whitespace', () => {
		expect(normalizeFreeText('  session summary  ', { maxLength: 40 })).toBe('session summary');
		expect(normalizeFreeText(undefined)).toBe('');
	});

	it('parses delimited lists from commas and line breaks', () => {
		expect(parseDelimitedStringList('CBT, grounding\njournaling ; CBT')).toEqual([
			'CBT',
			'grounding',
			'journaling'
		]);
	});

	it('parses valid datetime-local values and rejects invalid ones', () => {
		expect(parseOptionalDateTimeInput('2026-03-19T09:30')).toBeInstanceOf(Date);
		expect(parseOptionalDateTimeInput('not-a-date')).toBeNull();
		expect(parseOptionalDateTimeInput('')).toBeNull();
	});
});

describe('therapy session note helpers', () => {
	it('serializes structured therapy notes with normalized values', () => {
		expect(
			serializeTherapySessionNotes({
				presentation: '  anxious but engaged  ',
				interventions: ['CBT reframing', 'CBT reframing', 'grounding'],
				response: ' Participated well ',
				homework: ['journal', 'meeting'],
				riskLevel: 'moderate',
				nextSteps: ' follow up next week '
			})
		).toBe(
			JSON.stringify({
				presentation: 'anxious but engaged',
				interventions: ['CBT reframing', 'grounding'],
				response: 'Participated well',
				homework: ['journal', 'meeting'],
				riskLevel: 'moderate',
				nextSteps: 'follow up next week'
			})
		);
	});

	it('parses note JSON and falls back safely for plain text legacy notes', () => {
		expect(
			parseTherapySessionNotes(
				JSON.stringify({
					presentation: 'Stable',
					interventions: ['relapse plan'],
					response: 'Open',
					homework: ['meeting'],
					riskLevel: 'high',
					nextSteps: 'check in tomorrow'
				})
			)
		).toEqual({
			presentation: 'Stable',
			interventions: ['relapse plan'],
			response: 'Open',
			homework: ['meeting'],
			riskLevel: 'high',
			nextSteps: 'check in tomorrow'
		});

		expect(parseTherapySessionNotes('Freeform legacy note')).toEqual({
			presentation: 'Freeform legacy note',
			interventions: [],
			response: '',
			homework: [],
			riskLevel: null,
			nextSteps: ''
		});
	});
});

describe('normalizeSignalSeverity', () => {
	it('rounds and clamps values into the supported range', () => {
		expect(normalizeSignalSeverity(34.6)).toBe(35);
		expect(normalizeSignalSeverity(180)).toBe(100);
		expect(normalizeSignalSeverity(-12)).toBe(0);
	});

	it('returns zero for invalid numeric inputs', () => {
		expect(normalizeSignalSeverity(undefined)).toBe(0);
		expect(normalizeSignalSeverity(null)).toBe(0);
		expect(normalizeSignalSeverity(Number.NaN)).toBe(0);
	});
});
