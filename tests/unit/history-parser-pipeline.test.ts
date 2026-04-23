import { beforeEach, describe, expect, it, vi } from 'vitest';

const pipelineState = vi.hoisted(() => ({
	historyFile: {
		id: 'file-1',
		patientId: 'patient-1',
		uploadedByUserId: 'admin-1',
		s3Key: 'patient-history/patient-1/history.csv',
		mimeType: 'text/csv',
		fileName: 'history.csv'
	},
	objectBytes: Buffer.from('Recorded At,Mood Score\n2026-02-03,2\n'),
	updateCalls: [] as Array<Record<string, unknown>>,
	insertedSignalBatches: [] as Array<Array<Record<string, unknown>>>,
	deleteCount: 0,
	events: [] as string[]
}));

const findFirstMock = vi.hoisted(() => vi.fn(async () => pipelineState.historyFile));
const updateMock = vi.hoisted(() =>
	vi.fn(() => ({
		set(values: Record<string, unknown>) {
			return {
				where: vi.fn(async () => {
					pipelineState.updateCalls.push(values);
					pipelineState.events.push(`update:${String(values.parseStatus ?? 'unknown')}`);
				})
			};
		}
	}))
);
const deleteMock = vi.hoisted(() =>
	vi.fn(() => ({
		where: vi.fn(async () => {
			pipelineState.deleteCount += 1;
			pipelineState.events.push('delete');
		})
	}))
);
const insertMock = vi.hoisted(() =>
	vi.fn(() => ({
		values: vi.fn(async (values: Array<Record<string, unknown>>) => {
			pipelineState.insertedSignalBatches.push(values);
			pipelineState.events.push('insert');
		})
	}))
);
const getS3ObjectBytesMock = vi.hoisted(() => vi.fn(async () => pipelineState.objectBytes));
const recalculatePatientRiskMock = vi.hoisted(() => vi.fn(async () => {}));
const syncPatientRecoveryProfileMock = vi.hoisted(() => vi.fn(async () => {}));
const logErrorMock = vi.hoisted(() => vi.fn());
const logInfoMock = vi.hoisted(() => vi.fn());
const logWarnMock = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ left, right }))
}));

vi.mock('$lib/server/db/schema', () => ({
	patientHistoryFile: { id: 'patient_history_file.id' },
	patientHistorySignal: { fileId: 'patient_history_signal.file_id' }
}));

vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			patientHistoryFile: {
				findFirst: findFirstMock
			}
		},
		update: updateMock,
		delete: deleteMock,
		insert: insertMock
	}
}));

vi.mock('$lib/server/storage/s3', () => ({
	getS3ObjectBytes: getS3ObjectBytesMock
}));

vi.mock('$lib/server/risk', () => ({
	recalculatePatientRisk: recalculatePatientRiskMock
}));

vi.mock('$lib/server/recovery-profile', () => ({
	syncPatientRecoveryProfile: syncPatientRecoveryProfileMock
}));

vi.mock('$lib/server/utils/log', () => ({
	logError: logErrorMock,
	logInfo: logInfoMock,
	logWarn: logWarnMock
}));

vi.mock('$lib/server/ai/deidentify', () => ({
	deidentifyText: vi.fn((text: string) => text)
}));

vi.mock('$lib/server/ai/provider', () => ({
	getRiskModel: vi.fn(() => 'mock-risk-model')
}));

vi.mock('ai', () => ({
	generateObject: vi.fn()
}));

vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn(function MockGoogleGenAI() {
		return {
			files: {
				upload: vi.fn(async () => ({ name: 'mock-gemini-file', uri: 'mock://gemini-file' }))
			},
			models: {
				generateContent: vi.fn(async () => {
					throw new Error('mock gemini unavailable');
				})
			}
		};
	})
}));

vi.mock('pdf-parse', () => ({
	PDFParse: vi.fn()
}));

const { processHistoryFile } = await import('../../src/lib/server/history/parser');

describe('processHistoryFile', () => {
	beforeEach(() => {
		pipelineState.historyFile = {
			id: 'file-1',
			patientId: 'patient-1',
			uploadedByUserId: 'admin-1',
			s3Key: 'patient-history/patient-1/history.csv',
			mimeType: 'text/csv',
			fileName: 'history.csv'
		};
		pipelineState.objectBytes = Buffer.from(
			[
				'Recorded At,Mood Score,Craving Score,Stress Level,Sleep Hours,Risk Trigger',
				'2026-02-03,2,8,7,4,"arguments|loneliness"'
			].join('\n')
		);
		pipelineState.updateCalls = [];
		pipelineState.insertedSignalBatches = [];
		pipelineState.deleteCount = 0;
		pipelineState.events = [];

		findFirstMock.mockClear();
		updateMock.mockClear();
		deleteMock.mockClear();
		insertMock.mockClear();
		getS3ObjectBytesMock.mockClear();
		recalculatePatientRiskMock.mockClear();
		syncPatientRecoveryProfileMock.mockClear();
		logErrorMock.mockClear();
		logInfoMock.mockClear();
		logWarnMock.mockClear();

		recalculatePatientRiskMock.mockImplementation(async () => {
			pipelineState.events.push('risk');
		});
		syncPatientRecoveryProfileMock.mockImplementation(async () => {
			pipelineState.events.push('profile');
		});
	});

	it('marks a file parsed only after signals are stored and downstream recalculation finishes', async () => {
		await processHistoryFile('file-1');

		expect(pipelineState.events).toEqual([
			'update:parsing',
			'delete',
			'insert',
			'risk',
			'profile',
			'update:parsed'
		]);
		expect(pipelineState.updateCalls[0]).toMatchObject({
			parseStatus: 'parsing',
			parseError: null,
			parsedAt: null
		});
		expect(pipelineState.updateCalls[1]).toMatchObject({
			parseStatus: 'parsed',
			parseError: null
		});
		expect(pipelineState.updateCalls[1].parsedAt).toBeInstanceOf(Date);
		expect(pipelineState.insertedSignalBatches[0].length).toBeGreaterThan(0);
		expect(recalculatePatientRiskMock).toHaveBeenCalledWith({
			patientId: 'patient-1',
			source: 'history',
			triggeredByUserId: 'admin-1'
		});
		expect(syncPatientRecoveryProfileMock).toHaveBeenCalledWith('patient-1');
	});

	it('fails loudly on empty CSV data and does not persist signals', async () => {
		pipelineState.objectBytes = Buffer.from('Recorded At,Mood Score\n');

		await expect(processHistoryFile('file-1')).rejects.toThrow(
			'CSV history file did not contain any patient records.'
		);

		expect(pipelineState.events).toEqual(['update:parsing', 'update:failed']);
		expect(pipelineState.deleteCount).toBe(0);
		expect(pipelineState.insertedSignalBatches).toHaveLength(0);
		expect(pipelineState.updateCalls[1]).toMatchObject({
			parseStatus: 'failed',
			parsedAt: null
		});
	});

	it('marks the file failed when downstream profile sync fails after parsing', async () => {
		syncPatientRecoveryProfileMock.mockImplementation(async () => {
			pipelineState.events.push('profile');
			throw new Error('profile sync failed');
		});

		await expect(processHistoryFile('file-1')).rejects.toThrow('profile sync failed');

		expect(pipelineState.events).toEqual([
			'update:parsing',
			'delete',
			'insert',
			'risk',
			'profile',
			'update:failed'
		]);
		expect(
			pipelineState.updateCalls.some((update) => update.parseStatus === 'parsed')
		).toBe(false);
		expect(pipelineState.updateCalls[1]).toMatchObject({
			parseStatus: 'failed',
			parseError: 'profile sync failed',
			parsedAt: null
		});
	});
});
