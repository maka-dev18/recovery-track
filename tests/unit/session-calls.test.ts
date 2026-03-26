import { beforeEach, describe, expect, it, vi } from 'vitest';

const findManyMock = vi.hoisted(() => vi.fn());
const findFirstMock = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm', () => ({
	and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
	gt: vi.fn((left: unknown, right: unknown) => ({ type: 'gt', left, right })),
	inArray: vi.fn((left: unknown, right: unknown) => ({ type: 'inArray', left, right })),
	or: vi.fn((...args: unknown[]) => ({ type: 'or', args }))
}));

vi.mock('$lib/server/db/schema', () => ({
	therapySession: {
		id: 'therapy_session.id',
		patientId: 'therapy_session.patient_id',
		therapistId: 'therapy_session.therapist_id'
	},
	therapySessionSignal: {
		sessionId: 'therapy_session_signal.session_id',
		createdAt: 'therapy_session_signal.created_at'
	}
}));

vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			therapySession: {
				findFirst: findFirstMock
			},
			therapySessionSignal: {
				findMany: findManyMock
			}
		}
	}
}));

const { getSessionJoinPath, listSessionSignals } = await import('../../src/lib/server/session-calls');

describe('session call helpers', () => {
	beforeEach(() => {
		findManyMock.mockReset();
		findFirstMock.mockReset();
	});

	it('builds a dashboard session join path', () => {
		expect(getSessionJoinPath('session-123')).toBe('/dashboard/session/session-123');
	});

	it('returns only signals from the latest reset window and still excludes the current user', async () => {
		findManyMock.mockResolvedValue([
			{
				id: 'sig-1',
				sessionId: 'session-1',
				senderUserId: 'therapist-1',
				signalType: 'offer',
				payloadJson: JSON.stringify({ type: 'offer', sdp: 'old-offer' }),
				createdAt: new Date('2026-03-26T08:00:00.000Z')
			},
			{
				id: 'sig-2',
				sessionId: 'session-1',
				senderUserId: 'therapist-1',
				signalType: 'reset',
				payloadJson: JSON.stringify({}),
				createdAt: new Date('2026-03-26T08:05:00.000Z')
			},
			{
				id: 'sig-3',
				sessionId: 'session-1',
				senderUserId: 'therapist-1',
				signalType: 'ready',
				payloadJson: JSON.stringify({}),
				createdAt: new Date('2026-03-26T08:05:01.000Z')
			},
			{
				id: 'sig-4',
				sessionId: 'session-1',
				senderUserId: 'therapist-1',
				signalType: 'offer',
				payloadJson: JSON.stringify({ type: 'offer', sdp: 'fresh-offer' }),
				createdAt: new Date('2026-03-26T08:05:02.000Z')
			},
			{
				id: 'sig-5',
				sessionId: 'session-1',
				senderUserId: 'patient-1',
				signalType: 'answer',
				payloadJson: JSON.stringify({ type: 'answer', sdp: 'fresh-answer' }),
				createdAt: new Date('2026-03-26T08:05:03.000Z')
			}
		]);

		const signals = await listSessionSignals({
			sessionId: 'session-1',
			excludeUserId: 'therapist-1'
		});

		expect(signals).toEqual([
			{
				id: 'sig-5',
				senderUserId: 'patient-1',
				signalType: 'answer',
				payload: { type: 'answer', sdp: 'fresh-answer' },
				createdAt: new Date('2026-03-26T08:05:03.000Z')
			}
		]);
	});
});
