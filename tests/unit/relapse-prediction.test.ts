import { describe, expect, it } from 'vitest';
import { computeRelapsePrediction } from '../../src/lib/server/relapse-prediction';

const now = new Date('2026-04-21T12:00:00.000Z');

function daysAgo(days: number) {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

describe('computeRelapsePrediction', () => {
	const neutralCheckin = { mood: 4, craving: 3, stress: 3, sleepHours: 7, createdAt: daysAgo(1) };

	it('keeps low-data patients low while lowering confidence', () => {
		const prediction = computeRelapsePrediction({
			patientId: 'patient-1',
			patientName: 'Patient One',
			now
		});

		expect(prediction.likelihoodPercent).toBeLessThan(40);
		expect(prediction.tier).toBe('low');
		expect(prediction.flagged).toBe(false);
		expect(prediction.confidence).toBeLessThan(35);
	});

	it('raises likelihood for high craving, stress, poor sleep, and low mood', () => {
		const prediction = computeRelapsePrediction({
			patientId: 'patient-1',
			now,
			riskScores: [{ score: 30, tier: 'low', createdAt: daysAgo(1) }],
			checkins: [
				{ mood: 1, craving: 9, stress: 9, sleepHours: 3, createdAt: daysAgo(0.5) },
				{ mood: 4, craving: 4, stress: 4, sleepHours: 7, createdAt: daysAgo(3) },
				{ mood: 4, craving: 4, stress: 4, sleepHours: 7, createdAt: daysAgo(5) },
				{ mood: 4, craving: 4, stress: 4, sleepHours: 7, createdAt: daysAgo(7) },
				{ mood: 4, craving: 4, stress: 4, sleepHours: 7, createdAt: daysAgo(9) }
			]
		});

		expect(prediction.likelihoodPercent).toBeGreaterThanOrEqual(40);
		expect(prediction.flagged).toBe(true);
		expect(prediction.drivers.selfReport.length).toBeGreaterThan(0);
	});

	it('uses associate substance and safety observations as prediction drivers', () => {
		const prediction = computeRelapsePrediction({
			patientId: 'patient-1',
			now,
			riskScores: [{ score: 35, tier: 'low', createdAt: daysAgo(1) }],
			associateObservations: [
				{
					category: 'substance_signs',
					severity: 5,
					note: 'Found paraphernalia and patient seemed intoxicated.',
					createdAt: daysAgo(1)
				}
			]
		});

		expect(prediction.likelihoodPercent).toBeGreaterThanOrEqual(60);
		expect(prediction.drivers.associate[0].label).toBe('Associate warning observation');
	});

	it('increases likelihood when relapse-risk signals appear across sources', () => {
		const prediction = computeRelapsePrediction({
			patientId: 'patient-1',
			now,
			riskScores: [{ score: 32, tier: 'low', createdAt: daysAgo(1) }],
			clinicalSignals: [
				{
					source: 'conversation',
					signalType: 'relapse_risk',
					severity: 70,
					confidence: 80,
					summary: 'Patient mentioned wanting to use again.',
					occurredAt: daysAgo(1)
				},
				{
					source: 'therapy_session',
					signalType: 'relapse_risk',
					severity: 68,
					confidence: 75,
					summary: 'Therapy note documented relapse planning concern.',
					occurredAt: daysAgo(2)
				}
			],
			aiRiskSignals: [
				{
					severity: 76,
					labelsJson: JSON.stringify(['relapse_intent']),
					createdAt: daysAgo(1)
				}
			]
		});

		expect(prediction.likelihoodPercent).toBeGreaterThanOrEqual(60);
		expect(prediction.drivers.careTeam.length).toBeGreaterThanOrEqual(2);
	});

	it('lets historical relapse markers influence baseline without dominating current risk', () => {
		const prediction = computeRelapsePrediction({
			patientId: 'patient-1',
			now,
			riskScores: [{ score: 20, tier: 'low', createdAt: daysAgo(1) }],
			historySignals: [
				{
					signalType: 'relapse_trigger',
					signalValueJson: JSON.stringify({ riskWeight: 90, label: 'Isolation after conflict' }),
					confidence: 85,
					createdAt: daysAgo(20)
				},
				{
					signalType: 'warning_signal',
					signalValueJson: JSON.stringify({ riskWeight: 80, label: 'Skipped support meetings' }),
					confidence: 80,
					createdAt: daysAgo(22)
				}
			]
		});

		expect(prediction.drivers.history.length).toBe(1);
		expect(prediction.likelihoodPercent).toBeLessThan(50);
	});

	it('maps likelihood thresholds to tiers and flags', () => {
		expect(
			computeRelapsePrediction({
				patientId: 'patient-low',
				now,
				riskScores: [{ score: 39, tier: 'low', createdAt: daysAgo(1) }],
				checkins: [neutralCheckin]
			})
		).toMatchObject({ likelihoodPercent: 39, tier: 'low', flagged: false });

		expect(
			computeRelapsePrediction({
				patientId: 'patient-moderate',
				now,
				riskScores: [{ score: 40, tier: 'moderate', createdAt: daysAgo(1) }],
				checkins: [neutralCheckin]
			})
		).toMatchObject({ likelihoodPercent: 40, tier: 'moderate', flagged: true });

		expect(
			computeRelapsePrediction({
				patientId: 'patient-high',
				now,
				riskScores: [{ score: 60, tier: 'high', createdAt: daysAgo(1) }],
				checkins: [neutralCheckin]
			})
		).toMatchObject({ likelihoodPercent: 60, tier: 'high', flagged: true });

		expect(
			computeRelapsePrediction({
				patientId: 'patient-critical',
				now,
				riskScores: [{ score: 80, tier: 'critical', createdAt: daysAgo(1) }],
				checkins: [neutralCheckin]
			})
		).toMatchObject({ likelihoodPercent: 80, tier: 'critical', flagged: true });
	});
});
