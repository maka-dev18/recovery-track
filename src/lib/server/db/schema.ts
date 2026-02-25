import { relations, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const task = sqliteTable('task', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const userCredentialPolicy = sqliteTable('user_credential_policy', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(now)
		.$onUpdate(() => new Date())
});

export const patientProfile = sqliteTable('patient_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
});

export const therapistProfile = sqliteTable('therapist_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
});

export const associateProfile = sqliteTable('associate_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
});

export const therapistPatientAssignment = sqliteTable(
	'therapist_patient_assignment',
	{
		therapistId: text('therapist_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		primaryKey({ columns: [table.therapistId, table.patientId] }),
		index('therapist_assignment_patient_idx').on(table.patientId),
		index('therapist_assignment_assigned_by_idx').on(table.assignedBy)
	]
);

export const associatePatientAssignment = sqliteTable(
	'associate_patient_assignment',
	{
		associateId: text('associate_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		relationshipLabel: text('relationship_label').notNull().default('family'),
		assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		primaryKey({ columns: [table.associateId, table.patientId] }),
		index('associate_assignment_patient_idx').on(table.patientId),
		index('associate_assignment_assigned_by_idx').on(table.assignedBy)
	]
);

export const patientCheckin = sqliteTable(
	'patient_checkin',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		mood: integer('mood').notNull(),
		craving: integer('craving').notNull(),
		stress: integer('stress').notNull(),
		sleepHours: integer('sleep_hours').notNull(),
		note: text('note'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('patient_checkin_patient_idx').on(table.patientId),
		index('patient_checkin_created_idx').on(table.createdAt)
	]
);

export const associateObservation = sqliteTable(
	'associate_observation',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		associateId: text('associate_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		category: text('category').notNull(),
		severity: integer('severity').notNull(),
		note: text('note').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('associate_observation_patient_idx').on(table.patientId),
		index('associate_observation_associate_idx').on(table.associateId),
		index('associate_observation_created_idx').on(table.createdAt)
	]
);

export const riskScore = sqliteTable(
	'risk_score',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		score: integer('score').notNull(),
		tier: text('tier').notNull(),
		source: text('source').notNull(),
		factors: text('factors').notNull(),
		checkinId: text('checkin_id').references(() => patientCheckin.id, { onDelete: 'set null' }),
		observationId: text('observation_id').references(() => associateObservation.id, {
			onDelete: 'set null'
		}),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('risk_score_patient_idx').on(table.patientId),
		index('risk_score_tier_idx').on(table.tier),
		index('risk_score_created_idx').on(table.createdAt)
	]
);

export const riskAlert = sqliteTable(
	'risk_alert',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		therapistId: text('therapist_id').references(() => user.id, { onDelete: 'set null' }),
		riskScoreId: text('risk_score_id').references(() => riskScore.id, { onDelete: 'set null' }),
		status: text('status').notNull().default('open'),
		level: text('level').notNull(),
		reason: text('reason').notNull(),
		details: text('details'),
		triggeredByUserId: text('triggered_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		acknowledgedByUserId: text('acknowledged_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp_ms' }),
		resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
		resolutionNote: text('resolution_note'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('risk_alert_patient_idx').on(table.patientId),
		index('risk_alert_therapist_idx').on(table.therapistId),
		index('risk_alert_status_idx').on(table.status),
		index('risk_alert_level_idx').on(table.level),
		index('risk_alert_created_idx').on(table.createdAt)
	]
);

export const patientHistoryFile = sqliteTable(
	'patient_history_file',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		uploadedByUserId: text('uploaded_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		fileName: text('file_name').notNull(),
		mimeType: text('mime_type').notNull(),
		byteSize: integer('byte_size').notNull(),
		s3Key: text('s3_key').notNull(),
		checksum: text('checksum'),
		parseStatus: text('parse_status').notNull().default('pending'),
		parseError: text('parse_error'),
		parsedAt: integer('parsed_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('patient_history_file_patient_idx').on(table.patientId),
		index('patient_history_file_status_idx').on(table.parseStatus),
		index('patient_history_file_created_idx').on(table.createdAt)
	]
);

export const patientHistorySignal = sqliteTable(
	'patient_history_signal',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		fileId: text('file_id')
			.notNull()
			.references(() => patientHistoryFile.id, { onDelete: 'cascade' }),
		signalType: text('signal_type').notNull(),
		signalValueJson: text('signal_value_json').notNull(),
		confidence: integer('confidence').notNull().default(0),
		occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('patient_history_signal_patient_idx').on(table.patientId),
		index('patient_history_signal_file_idx').on(table.fileId),
		index('patient_history_signal_type_idx').on(table.signalType),
		index('patient_history_signal_created_idx').on(table.createdAt)
	]
);

export const aiSession = sqliteTable(
	'ai_session',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		mode: text('mode').notNull(),
		status: text('status').notNull().default('active'),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(now),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		index('ai_session_patient_idx').on(table.patientId),
		index('ai_session_mode_idx').on(table.mode),
		index('ai_session_status_idx').on(table.status),
		index('ai_session_started_idx').on(table.startedAt)
	]
);

export const aiMessage = sqliteTable(
	'ai_message',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		sessionId: text('session_id')
			.notNull()
			.references(() => aiSession.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		content: text('content').notNull(),
		modality: text('modality').notNull().default('text'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('ai_message_session_idx').on(table.sessionId),
		index('ai_message_role_idx').on(table.role),
		index('ai_message_created_idx').on(table.createdAt)
	]
);

export const aiRiskSignal = sqliteTable(
	'ai_risk_signal',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		sessionId: text('session_id')
			.notNull()
			.references(() => aiSession.id, { onDelete: 'cascade' }),
		severity: integer('severity').notNull(),
		labelsJson: text('labels_json').notNull(),
		explanation: text('explanation').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('ai_risk_signal_patient_idx').on(table.patientId),
		index('ai_risk_signal_session_idx').on(table.sessionId),
		index('ai_risk_signal_severity_idx').on(table.severity),
		index('ai_risk_signal_created_idx').on(table.createdAt)
	]
);

export const jobQueue = sqliteTable(
	'job_queue',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		type: text('type').notNull(),
		payloadJson: text('payload_json').notNull(),
		status: text('status').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		runAfter: integer('run_after', { mode: 'timestamp_ms' }).notNull().default(now),
		lastError: text('last_error'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(table) => [
		index('job_queue_status_idx').on(table.status),
		index('job_queue_run_after_idx').on(table.runAfter),
		index('job_queue_type_idx').on(table.type),
		index('job_queue_created_idx').on(table.createdAt)
	]
);

export const userCredentialPolicyRelations = relations(userCredentialPolicy, ({ one }) => ({
	user: one(user, {
		fields: [userCredentialPolicy.userId],
		references: [user.id]
	})
}));

export const patientProfileRelations = relations(patientProfile, ({ one, many }) => ({
	user: one(user, {
		fields: [patientProfile.userId],
		references: [user.id]
	}),
	therapists: many(therapistPatientAssignment),
	associates: many(associatePatientAssignment)
}));

export const therapistProfileRelations = relations(therapistProfile, ({ one, many }) => ({
	user: one(user, {
		fields: [therapistProfile.userId],
		references: [user.id]
	}),
	patients: many(therapistPatientAssignment)
}));

export const associateProfileRelations = relations(associateProfile, ({ one, many }) => ({
	user: one(user, {
		fields: [associateProfile.userId],
		references: [user.id]
	}),
	patients: many(associatePatientAssignment)
}));

export const therapistPatientAssignmentRelations = relations(
	therapistPatientAssignment,
	({ one }) => ({
		therapist: one(user, {
			fields: [therapistPatientAssignment.therapistId],
			references: [user.id]
		}),
		patient: one(user, {
			fields: [therapistPatientAssignment.patientId],
			references: [user.id]
		}),
		assignedByUser: one(user, {
			fields: [therapistPatientAssignment.assignedBy],
			references: [user.id]
		})
	})
);

export const associatePatientAssignmentRelations = relations(
	associatePatientAssignment,
	({ one }) => ({
		associate: one(user, {
			fields: [associatePatientAssignment.associateId],
			references: [user.id]
		}),
		patient: one(user, {
			fields: [associatePatientAssignment.patientId],
			references: [user.id]
		}),
		assignedByUser: one(user, {
			fields: [associatePatientAssignment.assignedBy],
			references: [user.id]
		})
	})
);

export const patientCheckinRelations = relations(patientCheckin, ({ one, many }) => ({
	patient: one(user, {
		fields: [patientCheckin.patientId],
		references: [user.id]
	}),
	riskScores: many(riskScore)
}));

export const associateObservationRelations = relations(associateObservation, ({ one, many }) => ({
	patient: one(user, {
		fields: [associateObservation.patientId],
		references: [user.id]
	}),
	associate: one(user, {
		fields: [associateObservation.associateId],
		references: [user.id]
	}),
	riskScores: many(riskScore)
}));

export const riskScoreRelations = relations(riskScore, ({ one, many }) => ({
	patient: one(user, {
		fields: [riskScore.patientId],
		references: [user.id]
	}),
	checkin: one(patientCheckin, {
		fields: [riskScore.checkinId],
		references: [patientCheckin.id]
	}),
	observation: one(associateObservation, {
		fields: [riskScore.observationId],
		references: [associateObservation.id]
	}),
	alerts: many(riskAlert)
}));

export const riskAlertRelations = relations(riskAlert, ({ one }) => ({
	patient: one(user, {
		fields: [riskAlert.patientId],
		references: [user.id]
	}),
	therapist: one(user, {
		fields: [riskAlert.therapistId],
		references: [user.id]
	}),
	riskScore: one(riskScore, {
		fields: [riskAlert.riskScoreId],
		references: [riskScore.id]
	}),
	triggeredByUser: one(user, {
		fields: [riskAlert.triggeredByUserId],
		references: [user.id]
	}),
	acknowledgedByUser: one(user, {
		fields: [riskAlert.acknowledgedByUserId],
		references: [user.id]
	}),
	resolvedByUser: one(user, {
		fields: [riskAlert.resolvedByUserId],
		references: [user.id]
	})
}));

export const patientHistoryFileRelations = relations(patientHistoryFile, ({ one, many }) => ({
	patient: one(user, {
		fields: [patientHistoryFile.patientId],
		references: [user.id]
	}),
	uploadedByUser: one(user, {
		fields: [patientHistoryFile.uploadedByUserId],
		references: [user.id]
	}),
	signals: many(patientHistorySignal)
}));

export const patientHistorySignalRelations = relations(patientHistorySignal, ({ one }) => ({
	patient: one(user, {
		fields: [patientHistorySignal.patientId],
		references: [user.id]
	}),
	file: one(patientHistoryFile, {
		fields: [patientHistorySignal.fileId],
		references: [patientHistoryFile.id]
	})
}));

export const aiSessionRelations = relations(aiSession, ({ one, many }) => ({
	patient: one(user, {
		fields: [aiSession.patientId],
		references: [user.id]
	}),
	messages: many(aiMessage),
	riskSignals: many(aiRiskSignal)
}));

export const aiMessageRelations = relations(aiMessage, ({ one }) => ({
	session: one(aiSession, {
		fields: [aiMessage.sessionId],
		references: [aiSession.id]
	})
}));

export const aiRiskSignalRelations = relations(aiRiskSignal, ({ one }) => ({
	patient: one(user, {
		fields: [aiRiskSignal.patientId],
		references: [user.id]
	}),
	session: one(aiSession, {
		fields: [aiRiskSignal.sessionId],
		references: [aiSession.id]
	})
}));

export * from './auth.schema';
