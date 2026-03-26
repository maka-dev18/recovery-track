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

export const conversationThread = sqliteTable(
	'conversation_thread',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		therapistId: text('therapist_id').references(() => user.id, { onDelete: 'set null' }),
		associateId: text('associate_id').references(() => user.id, { onDelete: 'set null' }),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		legacyAiSessionId: text('legacy_ai_session_id').references(() => aiSession.id, {
			onDelete: 'set null'
		}),
		channel: text('channel').notNull().default('ai_companion'),
		status: text('status').notNull().default('active'),
		subject: text('subject'),
		lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }),
		closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(table) => [
		index('conversation_thread_patient_idx').on(table.patientId),
		index('conversation_thread_therapist_idx').on(table.therapistId),
		index('conversation_thread_associate_idx').on(table.associateId),
		index('conversation_thread_channel_idx').on(table.channel),
		index('conversation_thread_status_idx').on(table.status),
		index('conversation_thread_last_message_idx').on(table.lastMessageAt),
		index('conversation_thread_legacy_ai_session_idx').on(table.legacyAiSessionId)
	]
);

export const conversationMessage = sqliteTable(
	'conversation_message',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => conversationThread.id, { onDelete: 'cascade' }),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		senderUserId: text('sender_user_id').references(() => user.id, { onDelete: 'set null' }),
		legacyAiMessageId: text('legacy_ai_message_id').references(() => aiMessage.id, {
			onDelete: 'set null'
		}),
		role: text('role').notNull(),
		content: text('content').notNull(),
		modality: text('modality').notNull().default('text'),
		visibility: text('visibility').notNull().default('shared'),
		metadataJson: text('metadata_json').notNull().default('{}'),
		occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull().default(now),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('conversation_message_thread_idx').on(table.threadId),
		index('conversation_message_patient_idx').on(table.patientId),
		index('conversation_message_sender_idx').on(table.senderUserId),
		index('conversation_message_role_idx').on(table.role),
		index('conversation_message_occurred_idx').on(table.occurredAt),
		index('conversation_message_legacy_ai_message_idx').on(table.legacyAiMessageId)
	]
);

export const therapySession = sqliteTable(
	'therapy_session',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		therapistId: text('therapist_id').references(() => user.id, { onDelete: 'set null' }),
		threadId: text('thread_id').references(() => conversationThread.id, { onDelete: 'set null' }),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		sessionType: text('session_type').notNull().default('therapy'),
		mode: text('mode').notNull().default('in_person'),
		status: text('status').notNull().default('scheduled'),
		requiresConfirmation: integer('requires_confirmation', { mode: 'boolean' })
			.notNull()
			.default(false),
		durationMinutes: integer('duration_minutes').notNull().default(60),
		scheduledStartAt: integer('scheduled_start_at', { mode: 'timestamp_ms' }),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
		automationSource: text('automation_source'),
		automationReason: text('automation_reason'),
		meetingUrl: text('meeting_url'),
		meetingCode: text('meeting_code'),
		confirmedByUserId: text('confirmed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
		summary: text('summary'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(table) => [
		index('therapy_session_patient_idx').on(table.patientId),
		index('therapy_session_therapist_idx').on(table.therapistId),
		index('therapy_session_thread_idx').on(table.threadId),
		index('therapy_session_status_idx').on(table.status),
		index('therapy_session_confirmation_idx').on(table.requiresConfirmation),
		index('therapy_session_scheduled_idx').on(table.scheduledStartAt),
		index('therapy_session_started_idx').on(table.startedAt)
	]
);

export const therapySessionSignal = sqliteTable(
	'therapy_session_signal',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		sessionId: text('session_id')
			.notNull()
			.references(() => therapySession.id, { onDelete: 'cascade' }),
		senderUserId: text('sender_user_id').references(() => user.id, { onDelete: 'set null' }),
		signalType: text('signal_type').notNull(),
		payloadJson: text('payload_json').notNull().default('{}'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('therapy_session_signal_session_idx').on(table.sessionId),
		index('therapy_session_signal_sender_idx').on(table.senderUserId),
		index('therapy_session_signal_created_idx').on(table.createdAt)
	]
);

export const userPresence = sqliteTable(
	'user_presence',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		roleSnapshot: text('role_snapshot'),
		lastPath: text('last_path'),
		lastActiveAt: integer('last_active_at', { mode: 'timestamp_ms' }).notNull().default(now),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(table) => [index('user_presence_last_active_idx').on(table.lastActiveAt)]
);

export const adminOutreachLog = sqliteTable(
	'admin_outreach_log',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		adminUserId: text('admin_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		associateId: text('associate_id').references(() => user.id, { onDelete: 'set null' }),
		targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'set null' }),
		channel: text('channel').notNull(),
		note: text('note'),
		status: text('status').notNull().default('logged'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('admin_outreach_patient_idx').on(table.patientId),
		index('admin_outreach_channel_idx').on(table.channel),
		index('admin_outreach_created_idx').on(table.createdAt)
	]
);

export const patientBadge = sqliteTable(
	'patient_badge',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		badgeKey: text('badge_key').notNull(),
		label: text('label').notNull(),
		description: text('description').notNull(),
		points: integer('points').notNull().default(0),
		awardedAt: integer('awarded_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('patient_badge_patient_idx').on(table.patientId),
		index('patient_badge_key_idx').on(table.badgeKey),
		index('patient_badge_awarded_idx').on(table.awardedAt)
	]
);

export const patientCopingLog = sqliteTable(
	'patient_coping_log',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		toolKey: text('tool_key').notNull(),
		title: text('title').notNull(),
		note: text('note'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('patient_coping_log_patient_idx').on(table.patientId),
		index('patient_coping_log_tool_idx').on(table.toolKey),
		index('patient_coping_log_created_idx').on(table.createdAt)
	]
);

export const patientRecoveryProfile = sqliteTable(
	'patient_recovery_profile',
	{
		patientId: text('patient_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		recoveryStage: text('recovery_stage').notNull().default('intake'),
		carePlanStatus: text('care_plan_status').notNull().default('active'),
		baselineRiskLevel: text('baseline_risk_level'),
		primaryGoalsJson: text('primary_goals_json').notNull().default('[]'),
		supportPreferencesJson: text('support_preferences_json').notNull().default('{}'),
		lastReviewedAt: integer('last_reviewed_at', { mode: 'timestamp_ms' }),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(now)
			.$onUpdate(() => new Date())
	},
	(table) => [
		index('patient_recovery_profile_stage_idx').on(table.recoveryStage),
		index('patient_recovery_profile_care_plan_idx').on(table.carePlanStatus),
		index('patient_recovery_profile_reviewed_idx').on(table.lastReviewedAt)
	]
);

export const patientSignal = sqliteTable(
	'patient_signal',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		threadId: text('thread_id').references(() => conversationThread.id, { onDelete: 'set null' }),
		messageId: text('message_id').references(() => conversationMessage.id, { onDelete: 'set null' }),
		therapySessionId: text('therapy_session_id').references(() => therapySession.id, {
			onDelete: 'set null'
		}),
		riskScoreId: text('risk_score_id').references(() => riskScore.id, { onDelete: 'set null' }),
		detectedByUserId: text('detected_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		source: text('source').notNull(),
		signalType: text('signal_type').notNull(),
		status: text('status').notNull().default('observed'),
		severity: integer('severity').notNull().default(0),
		confidence: integer('confidence').notNull().default(0),
		summary: text('summary').notNull(),
		payloadJson: text('payload_json').notNull().default('{}'),
		occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull().default(now),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(table) => [
		index('patient_signal_patient_idx').on(table.patientId),
		index('patient_signal_thread_idx').on(table.threadId),
		index('patient_signal_message_idx').on(table.messageId),
		index('patient_signal_therapy_session_idx').on(table.therapySessionId),
		index('patient_signal_risk_score_idx').on(table.riskScoreId),
		index('patient_signal_source_idx').on(table.source),
		index('patient_signal_type_idx').on(table.signalType),
		index('patient_signal_severity_idx').on(table.severity),
		index('patient_signal_occurred_idx').on(table.occurredAt)
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

export const conversationThreadRelations = relations(conversationThread, ({ one, many }) => ({
	patient: one(user, {
		fields: [conversationThread.patientId],
		references: [user.id]
	}),
	therapist: one(user, {
		fields: [conversationThread.therapistId],
		references: [user.id]
	}),
	associate: one(user, {
		fields: [conversationThread.associateId],
		references: [user.id]
	}),
	createdByUser: one(user, {
		fields: [conversationThread.createdByUserId],
		references: [user.id]
	}),
	legacyAiSession: one(aiSession, {
		fields: [conversationThread.legacyAiSessionId],
		references: [aiSession.id]
	}),
	messages: many(conversationMessage),
	therapySessions: many(therapySession),
	signals: many(patientSignal)
}));

export const conversationMessageRelations = relations(conversationMessage, ({ one, many }) => ({
	thread: one(conversationThread, {
		fields: [conversationMessage.threadId],
		references: [conversationThread.id]
	}),
	patient: one(user, {
		fields: [conversationMessage.patientId],
		references: [user.id]
	}),
	senderUser: one(user, {
		fields: [conversationMessage.senderUserId],
		references: [user.id]
	}),
	legacyAiMessage: one(aiMessage, {
		fields: [conversationMessage.legacyAiMessageId],
		references: [aiMessage.id]
	}),
	signals: many(patientSignal)
}));

export const therapySessionRelations = relations(therapySession, ({ one, many }) => ({
	patient: one(user, {
		fields: [therapySession.patientId],
		references: [user.id]
	}),
	therapist: one(user, {
		fields: [therapySession.therapistId],
		references: [user.id]
	}),
	thread: one(conversationThread, {
		fields: [therapySession.threadId],
		references: [conversationThread.id]
	}),
	createdByUser: one(user, {
		fields: [therapySession.createdByUserId],
		references: [user.id]
	}),
	confirmedByUser: one(user, {
		fields: [therapySession.confirmedByUserId],
		references: [user.id]
	}),
	callSignals: many(therapySessionSignal),
	signals: many(patientSignal)
}));

export const therapySessionSignalRelations = relations(therapySessionSignal, ({ one }) => ({
	session: one(therapySession, {
		fields: [therapySessionSignal.sessionId],
		references: [therapySession.id]
	}),
	senderUser: one(user, {
		fields: [therapySessionSignal.senderUserId],
		references: [user.id]
	})
}));

export const userPresenceRelations = relations(userPresence, ({ one }) => ({
	user: one(user, {
		fields: [userPresence.userId],
		references: [user.id]
	})
}));

export const adminOutreachLogRelations = relations(adminOutreachLog, ({ one }) => ({
	patient: one(user, {
		fields: [adminOutreachLog.patientId],
		references: [user.id]
	}),
	adminUser: one(user, {
		fields: [adminOutreachLog.adminUserId],
		references: [user.id]
	}),
	associate: one(user, {
		fields: [adminOutreachLog.associateId],
		references: [user.id]
	}),
	targetUser: one(user, {
		fields: [adminOutreachLog.targetUserId],
		references: [user.id]
	})
}));

export const patientBadgeRelations = relations(patientBadge, ({ one }) => ({
	patient: one(user, {
		fields: [patientBadge.patientId],
		references: [user.id]
	})
}));

export const patientCopingLogRelations = relations(patientCopingLog, ({ one }) => ({
	patient: one(user, {
		fields: [patientCopingLog.patientId],
		references: [user.id]
	})
}));

export const patientRecoveryProfileRelations = relations(patientRecoveryProfile, ({ one }) => ({
	patient: one(user, {
		fields: [patientRecoveryProfile.patientId],
		references: [user.id]
	})
}));

export const patientSignalRelations = relations(patientSignal, ({ one }) => ({
	patient: one(user, {
		fields: [patientSignal.patientId],
		references: [user.id]
	}),
	thread: one(conversationThread, {
		fields: [patientSignal.threadId],
		references: [conversationThread.id]
	}),
	message: one(conversationMessage, {
		fields: [patientSignal.messageId],
		references: [conversationMessage.id]
	}),
	therapySession: one(therapySession, {
		fields: [patientSignal.therapySessionId],
		references: [therapySession.id]
	}),
	riskScore: one(riskScore, {
		fields: [patientSignal.riskScoreId],
		references: [riskScore.id]
	}),
	detectedByUser: one(user, {
		fields: [patientSignal.detectedByUserId],
		references: [user.id]
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
