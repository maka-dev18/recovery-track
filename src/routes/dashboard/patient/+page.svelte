<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SquareIcon from '@lucide/svelte/icons/square';
	import SendIcon from '@lucide/svelte/icons/send';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import { keepLatestMessagePinned } from '$lib/client/chat-scroll';
	import { getPreferredName, virtualTherapistProfile } from '$lib/shared/virtual-therapist';

	type PatientPageData = {
		patientName: string;
		latestRisk: {
			id: string;
			score: number;
			tier: string;
			factors: string;
			createdAt: Date;
		} | null;
		recentCheckins: Array<{
			id: string;
			mood: number;
			craving: number;
			stress: number;
			sleepHours: number;
			note: string | null;
			createdAt: Date;
		}>;
		recentAlerts: Array<{
			id: string;
			level: string;
			status: string;
			createdAt: Date;
		}>;
		aiChatSession: {
			id: string;
			status: string;
			startedAt: Date;
		} | null;
		aiLiveSession: {
			id: string;
			status: string;
			startedAt: Date;
		} | null;
		aiChatMessages: Array<{
			id: string;
			role: string;
			content: string;
			modality: string;
			createdAt: Date;
		}>;
		therapistConversations: Array<{
			threadId: string | null;
			patientId: string;
			patientName: string;
			patientEmail: string;
			therapistId: string;
			therapistName: string;
			therapistEmail: string;
			lastMessageAt: Date | null;
			lastMessagePreview: string | null;
			messages: Array<{
				id: string;
				role: 'patient' | 'therapist';
				senderName: string;
				content: string;
				createdAt: Date;
			}>;
		}>;
		upcomingSessions: Array<{
			id: string;
			patientId: string;
			patientName: string;
			therapistId: string | null;
			therapistName: string;
			mode: string;
			status: string;
			requiresConfirmation: boolean;
			summary: string;
			sessionAt: Date | null;
			automationReason: string | null;
			meetingUrl: string | null;
			meetingCode: string | null;
			confirmedAt: Date | null;
			createdAt: Date;
			updatedAt: Date;
			notes: {
				presentation: string;
				interventions: string[];
				response: string;
				homework: string[];
				riskLevel: string | null;
				nextSteps: string;
			};
		}>;
		rewardSummary: {
			totalPoints: number;
			badges: Array<{
				id: string;
				badgeKey: string;
				label: string;
				description: string;
				points: number;
				awardedAt: Date;
			}>;
		};
		copingRecommendations: Array<{
			toolKey: string;
			title: string;
			description: string;
			reason: string;
			priority: 'gentle' | 'important' | 'urgent';
		}>;
		copingActivity: Array<{
			id: string;
			toolKey: string;
			title: string;
			note: string | null;
			createdAt: Date;
		}>;
		recentSignals: Array<{
			id: string;
			patientId: string;
			threadId: string | null;
			messageId: string | null;
			therapySessionId: string | null;
			riskScoreId: string | null;
			detectedByUserId: string | null;
			source: string;
			signalType: string;
			status: string;
			severity: number;
			confidence: number;
			summary: string;
			payloadJson: string;
			occurredAt: Date;
			createdAt: Date;
		}>;
		aiFeatures: {
			chatEnabled: boolean;
			liveVoiceEnabled: boolean;
		};
	};

	type PatientPageForm = {
		message?: string;
		success?: string;
		mode?: string;
	} | null;

	type PatientView = 'today' | 'care' | 'messages' | 'history';
	let {
		data,
		form,
		initialView = 'today'
	}: { data: PatientPageData; form: PatientPageForm; initialView?: PatientView } = $props();
	let activeView = $derived(initialView);
	let activeAction = $state<string | null>(null);
	type ChatMessage = {
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		modality: 'text' | 'voice';
		createdAt: string;
	};
	function mapServerMessagesToChat(messages: PatientPageData['aiChatMessages']): ChatMessage[] {
		return messages
			.map((message) => ({
				id: message.id,
				role: (message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user') as
					| 'user'
				| 'assistant'
				| 'system',
			content: message.content,
			modality: (message.modality === 'voice' ? 'voice' : 'text') as 'voice' | 'text',
			createdAt: new Date(message.createdAt).toISOString()
		}))
		.sort(
			(left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
		);
	}
	let chatSessionId = $state<string | null>(null);
	let chatInput = $state('');
	let chatSending = $state(false);
	let chatError = $state<string | null>(null);
	let chatMessages = $state<ChatMessage[]>([]);
	let liveSessionId = $state<string | null>(null);
	let liveStatus = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle');
	let liveError = $state<string | null>(null);
	let liveLog = $state<Array<{ id: string; role: 'user' | 'assistant'; text: string; createdAt: string }>>([]);
	let liveSessionConnection: {
		close: () => void;
		sendRealtimeInput: (args: unknown) => void;
	} | null = null;
	let mediaRecorder: MediaRecorder | null = null;
	let mediaStream: MediaStream | null = null;
	let audioContext: AudioContext | null = null;
	let audioSourceNode: MediaStreamAudioSourceNode | null = null;
	let audioProcessorNode: ScriptProcessorNode | null = null;
	let outputAudioContext: AudioContext | null = null;
	let outputAudioQueueTime = 0;
	let outputAudioSources = new Set<AudioBufferSourceNode>();
	let supportsLiveVoice = $state(true);
	let liveStopRequested = $state(false);
	let liveAudioChunkCount = $state(0);
	let liveOutputChunkCount = $state(0);
	let liveDiagnostics = $state<Array<{ id: string; at: string; event: string; detail?: string }>>([]);
	let activeLiveModel = $state<string | null>(null);
	let activeLiveResponseModality = $state<'TEXT' | 'AUDIO' | null>(null);
	const MAX_LIVE_DIAGNOSTICS = 120;

	function safeDetail(value: unknown): string | undefined {
		if (value == null) return undefined;
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);

		if (value instanceof Error) {
			return `${value.name}: ${value.message}`;
		}

		try {
			const serialized = JSON.stringify(value);
			return serialized.length > 600 ? `${serialized.slice(0, 600)}...` : serialized;
		} catch {
			return String(value);
		}
	}

	function addLiveDiagnostic(event: string, detail?: unknown) {
		const detailText = safeDetail(detail);
		liveDiagnostics = [
			...liveDiagnostics,
			{
				id: crypto.randomUUID(),
				at: new Date().toISOString(),
				event,
				detail: detailText
			}
		].slice(-MAX_LIVE_DIAGNOSTICS);

		if (detailText) {
			console.info('[live-voice]', event, detailText);
		} else {
			console.info('[live-voice]', event);
		}
	}

	$effect(() => {
		if (chatSessionId === null && data.aiChatSession?.id) {
			chatSessionId = data.aiChatSession.id;
		}

		if (liveSessionId === null && data.aiLiveSession?.id) {
			liveSessionId = data.aiLiveSession.id;
		}

		if (chatMessages.length === 0 && data.aiChatMessages.length > 0) {
			chatMessages = mapServerMessagesToChat(data.aiChatMessages);
		}

		if (typeof window !== 'undefined') {
			const hasAudioContext =
				typeof window.AudioContext !== 'undefined' ||
				typeof (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !==
					'undefined';
			supportsLiveVoice =
				typeof navigator !== 'undefined' &&
				typeof navigator.mediaDevices?.getUserMedia === 'function' &&
				(typeof MediaRecorder !== 'undefined' || hasAudioContext);
		}
	});

	function pendingForm(node: HTMLFormElement, actionName: string) {
		return enhance(node, () => {
			activeAction = actionName;

			return async ({ update }) => {
				try {
					await update();
				} finally {
					activeAction = null;
				}
			};
		});
	}

	function formatDate(value: Date | string) {
		const date = typeof value === 'string' ? new Date(value) : value;
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}

	function formatDateTimeInput(value: Date | string | null) {
		if (!value) return '';
		const date = typeof value === 'string' ? new Date(value) : value;
		const pad = (input: number) => `${input}`.padStart(2, '0');

		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function tierBadgeClass(tier: string | null | undefined) {
		if (tier === 'critical') return 'bg-red-600 text-white';
		if (tier === 'high') return 'bg-orange-500 text-white';
		if (tier === 'moderate') return 'bg-amber-400 text-amber-950';
		return 'bg-blue-100 text-blue-700';
	}

	function modeLabel(value: string | null | undefined) {
		return value ? value.replaceAll('_', ' ') : 'session';
	}

	function parseFactors(raw: string | null | undefined): Array<{ label: string; points: number }> {
		if (!raw) return [];

		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(item): item is { label: string; points: number } =>
						typeof item?.label === 'string' && typeof item?.points === 'number'
				);
			}
		} catch {
			return [];
		}

		return [];
	}

	function formatTimestamp(value: string | Date) {
		return formatDate(typeof value === 'string' ? new Date(value) : value);
	}

	function resolveErrorMessage(error: unknown, fallback: string) {
		if (error instanceof Error) return error.message;
		return fallback;
	}

	async function streamResponseToMessage(response: Response, assistantMessageId: string) {
		const stream = response.body;
		if (!stream) {
			throw new Error('Chat response stream is unavailable.');
		}

		const decoder = new TextDecoder();
		const reader = stream.getReader();
		let accumulated = '';

		const assistantMessage: ChatMessage = {
			id: assistantMessageId,
			role: 'assistant',
			content: '',
			modality: 'text',
			createdAt: new Date().toISOString()
		};
		chatMessages = [...chatMessages, assistantMessage];

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			accumulated += decoder.decode(value, { stream: true });
			chatMessages = chatMessages.map((message) =>
				message.id === assistantMessageId ? { ...message, content: accumulated } : message
			);
		}

		accumulated += decoder.decode();
		chatMessages = chatMessages.map((message) =>
			message.id === assistantMessageId ? { ...message, content: accumulated } : message
		);
	}

	async function sendChatMessage() {
		if (!data.aiFeatures.chatEnabled) {
			chatError = `${virtualTherapistProfile.name} chat is currently disabled.`;
			return;
		}

		const text = chatInput.trim();
		if (!text || chatSending) return;

		chatSending = true;
		chatError = null;
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: text,
			modality: 'text',
			createdAt: new Date().toISOString()
		};
		chatMessages = [...chatMessages, userMessage];
		chatInput = '';

		try {
			const response = await fetch('/api/patient/ai-therapist/messages', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sessionId: chatSessionId ?? undefined,
					text
				})
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.message ?? `${virtualTherapistProfile.name} message failed.`);
			}

			const newSessionId = response.headers.get('x-ai-session-id');
			if (newSessionId) {
				chatSessionId = newSessionId;
			}

			await streamResponseToMessage(response, crypto.randomUUID());
			await invalidateAll();
		} catch (error) {
			chatError = resolveErrorMessage(error, 'Could not send chat message right now.');
		} finally {
			chatSending = false;
		}
	}

	async function blobToBase64(blob: Blob): Promise<string> {
		const arrayBuffer = await blob.arrayBuffer();
		const bytes = new Uint8Array(arrayBuffer);
		return bytesToBase64(bytes);
	}

	function bytesToBase64(bytes: Uint8Array): string {
		let binary = '';
		const CHUNK = 0x8000;
		for (let offset = 0; offset < bytes.length; offset += CHUNK) {
			const chunk = bytes.subarray(offset, offset + CHUNK);
			for (const byte of chunk) {
				binary += String.fromCharCode(byte);
			}
		}
		return btoa(binary);
	}

	function float32ToPcm16Bytes(input: Float32Array): Uint8Array {
		const output = new ArrayBuffer(input.length * 2);
		const view = new DataView(output);

		for (let index = 0; index < input.length; index += 1) {
			const sample = Math.max(-1, Math.min(1, input[index]));
			const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
			view.setInt16(index * 2, int16, true);
		}

		return new Uint8Array(output);
	}

	function isNativeAudioResponseMode() {
		return activeLiveResponseModality === 'AUDIO';
	}

	type LiveServerMessage = {
		text?: string;
		data?: string;
		serverContent?: {
			modelTurn?: {
				parts?: Array<{
					text?: string;
					inlineData?: { mimeType?: string; data?: string };
				}>;
			};
			interrupted?: boolean;
			inputTranscription?: { text?: string };
			outputTranscription?: { text?: string };
		};
	};

	function getSupportedRecorderMimeType() {
		const candidates = [
			'audio/webm;codecs=opus',
			'audio/webm',
			'audio/mp4',
			'audio/ogg;codecs=opus'
		];

		if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
			return null;
		}

		for (const candidate of candidates) {
			if (MediaRecorder.isTypeSupported(candidate)) {
				return candidate;
			}
		}

		return null;
	}

	function cleanupLiveVoiceConnection(options?: { signalEnd?: boolean; closeSession?: boolean }) {
		const shouldSignalEnd = options?.signalEnd ?? false;
		const shouldCloseSession = options?.closeSession ?? true;

		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}

		if (mediaStream) {
			for (const track of mediaStream.getTracks()) {
				track.stop();
			}
		}

		if (liveSessionConnection) {
			if (shouldSignalEnd) {
				try {
					liveSessionConnection.sendRealtimeInput({ audioStreamEnd: true });
				} catch {
					// Connection can close before final input dispatch.
				}
			}

			if (shouldCloseSession) {
				try {
					liveSessionConnection.close();
				} catch {
					// Connection may already be closed.
				}
			}
		}

		mediaRecorder = null;
		mediaStream = null;
		liveSessionConnection = null;
		liveAudioChunkCount = 0;
		activeLiveModel = null;
		activeLiveResponseModality = null;

		if (audioProcessorNode) {
			audioProcessorNode.onaudioprocess = null;
			audioProcessorNode.disconnect();
		}

		if (audioSourceNode) {
			audioSourceNode.disconnect();
		}

		if (audioContext && audioContext.state !== 'closed') {
			void audioContext.close().catch(() => {
				// Audio context can already be closing.
			});
		}

		for (const source of outputAudioSources) {
			try {
				source.stop();
			} catch {
				// Source may have already ended.
			}
		}
		outputAudioSources.clear();

		if (outputAudioContext && outputAudioContext.state !== 'closed') {
			void outputAudioContext.close().catch(() => {
				// Audio context can already be closing.
			});
		}

		audioProcessorNode = null;
		audioSourceNode = null;
		audioContext = null;
		outputAudioContext = null;
		outputAudioQueueTime = 0;
		liveOutputChunkCount = 0;
	}

	function base64ToBytes(base64: string): Uint8Array {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	}

	function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
		const safeLength = bytes.byteLength - (bytes.byteLength % 2);
		const view = new DataView(bytes.buffer, bytes.byteOffset, safeLength);
		const sampleCount = safeLength / 2;
		const output = new Float32Array(sampleCount);

		for (let index = 0; index < sampleCount; index += 1) {
			output[index] = view.getInt16(index * 2, true) / 0x8000;
		}

		return output;
	}

	function parsePcmSampleRate(mimeType: string | undefined) {
		if (!mimeType) return 24000;
		const match = /rate=(\d+)/i.exec(mimeType);
		if (!match) return 24000;
		const parsed = Number.parseInt(match[1], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 24000;
	}

	function extractAudioChunks(
		message: LiveServerMessage
	): Array<{ data: string; mimeType: string; source: 'parts' | 'message_data' }> {
		const chunks: Array<{ data: string; mimeType: string; source: 'parts' | 'message_data' }> = [];
		const parts = message.serverContent?.modelTurn?.parts ?? [];

		for (const part of parts) {
			const inline = part.inlineData;
			if (!inline?.data || typeof inline.data !== 'string') continue;
			const mimeType = inline.mimeType ?? '';
			if (!mimeType.toLowerCase().startsWith('audio/')) continue;
			chunks.push({
				data: inline.data,
				mimeType,
				source: 'parts'
			});
		}

		if (chunks.length === 0 && typeof message.data === 'string' && message.data.length > 0) {
			chunks.push({
				data: message.data,
				mimeType: 'audio/pcm;rate=24000',
				source: 'message_data'
			});
		}

		return chunks;
	}

	async function ensureOutputAudioContext() {
		if (!outputAudioContext || outputAudioContext.state === 'closed') {
			const AudioContextCtor =
				window.AudioContext ||
				(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

			if (!AudioContextCtor) {
				throw new Error('Audio output context is not available in this browser.');
			}

			outputAudioContext = new AudioContextCtor();
			outputAudioQueueTime = 0;
			addLiveDiagnostic('audio_output_context_created', {
				sampleRate: outputAudioContext.sampleRate
			});
		}

		if (outputAudioContext.state === 'suspended') {
			await outputAudioContext.resume();
		}

		return outputAudioContext;
	}

	function resetOutputAudioQueue() {
		for (const source of outputAudioSources) {
			try {
				source.stop();
			} catch {
				// Source may already be stopped.
			}
		}
		outputAudioSources.clear();
		outputAudioQueueTime = outputAudioContext?.currentTime ?? 0;
	}

	async function playModelAudioChunk(data: string, mimeType: string) {
		if (!mimeType.toLowerCase().startsWith('audio/pcm')) {
			addLiveDiagnostic('audio_output_unsupported_mime', { mimeType });
			return;
		}

		const context = await ensureOutputAudioContext();
		const bytes = base64ToBytes(data);
		if (bytes.byteLength < 2) return;

		const pcm = pcm16BytesToFloat32(bytes);
		if (pcm.length === 0) return;

		const sampleRate = parsePcmSampleRate(mimeType);
		const audioBuffer = context.createBuffer(1, pcm.length, sampleRate);
		audioBuffer.getChannelData(0).set(pcm);

		const source = context.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(context.destination);
		outputAudioSources.add(source);
		source.onended = () => {
			outputAudioSources.delete(source);
		};

		const now = context.currentTime;
		if (outputAudioQueueTime < now + 0.03) {
			outputAudioQueueTime = now + 0.03;
		}

		source.start(outputAudioQueueTime);
		outputAudioQueueTime += audioBuffer.duration;
	}

	async function handleLiveServerMessage(message: LiveServerMessage) {
		if (message.serverContent?.interrupted) {
			resetOutputAudioQueue();
			addLiveDiagnostic('audio_output_interrupted');
		}

		const audioChunks = extractAudioChunks(message);
		if (audioChunks.length > 0) {
			for (const chunk of audioChunks) {
				try {
					await playModelAudioChunk(chunk.data, chunk.mimeType);
					liveOutputChunkCount += 1;
					if (liveOutputChunkCount <= 3 || liveOutputChunkCount % 20 === 0) {
						addLiveDiagnostic('audio_output_chunk', {
							count: liveOutputChunkCount,
							size: chunk.data.length,
							mimeType: chunk.mimeType,
							source: chunk.source
						});
					}
				} catch (playbackError) {
					addLiveDiagnostic('audio_output_error', playbackError);
				}
			}
		}

		const userTranscript = message.serverContent?.inputTranscription?.text?.trim();
		if (userTranscript) {
			const userEvent = {
				id: crypto.randomUUID(),
				role: 'user' as const,
				text: userTranscript,
				createdAt: new Date().toISOString()
			};
			liveLog = [...liveLog, userEvent];
			await postLiveEvents([{ role: 'user', content: userTranscript, modality: 'voice' }]);
		}

		const assistantText =
			message.text?.trim() || message.serverContent?.outputTranscription?.text?.trim() || '';
		if (assistantText) {
			const assistantEvent = {
				id: crypto.randomUUID(),
				role: 'assistant' as const,
				text: assistantText,
				createdAt: new Date().toISOString()
			};
			liveLog = [...liveLog, assistantEvent];
			await postLiveEvents([{ role: 'assistant', content: assistantText, modality: 'voice' }]);
		}
	}

	async function postLiveEvents(events: Array<{ role: 'user' | 'assistant'; content: string; modality: 'voice' | 'text' }>) {
		const response = await fetch('/api/patient/ai-therapist/live-events', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				sessionId: liveSessionId ?? undefined,
				events
			})
		});

		if (!response.ok) {
			const payload = await response.json().catch(() => null);
			throw new Error(payload?.message ?? 'Failed to persist live events.');
		}

		const payload = await response.json();
		if (payload?.sessionId) {
			liveSessionId = payload.sessionId;
		}
	}

	async function startLiveVoice() {
		if (liveStatus === 'connecting' || liveStatus === 'connected') return;
		addLiveDiagnostic('start_requested', {
			liveStatus,
			featureEnabled: data.aiFeatures.liveVoiceEnabled,
			supportsLiveVoice
		});

		if (!data.aiFeatures.liveVoiceEnabled) {
			liveStatus = 'error';
			liveError = `Live voice sessions with ${virtualTherapistProfile.name} are currently disabled.`;
			addLiveDiagnostic('start_blocked_feature_disabled');
			return;
		}

		if (!supportsLiveVoice) {
			liveStatus = 'error';
			liveError = 'This browser does not support microphone live voice sessions.';
			addLiveDiagnostic('start_blocked_unsupported_browser');
			return;
		}

		liveStopRequested = false;
		liveError = null;
		liveStatus = 'connecting';

		try {
			const hasOutputAudioContext =
				typeof window !== 'undefined' &&
				(typeof window.AudioContext !== 'undefined' ||
					typeof (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !==
						'undefined');
			if (hasOutputAudioContext) {
				try {
					await ensureOutputAudioContext();
					addLiveDiagnostic('audio_output_ready');
				} catch (outputContextError) {
					addLiveDiagnostic('audio_output_context_error', outputContextError);
				}
			}

			const recorderMimeType = getSupportedRecorderMimeType();
			addLiveDiagnostic('request_live_token');
			const tokenResponse = await fetch('/api/patient/ai-therapist/live-token', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId: liveSessionId ?? undefined })
			});
			const tokenPayload = await tokenResponse.json();
			addLiveDiagnostic('live_token_response', {
				ok: tokenResponse.ok,
				status: tokenResponse.status,
				sessionId: tokenPayload?.sessionId ?? null,
				model: tokenPayload?.model ?? null,
				configuredModel: tokenPayload?.configuredModel ?? null,
				responseModality: tokenPayload?.responseModality ?? null
			});
			if (!tokenResponse.ok) {
				throw new Error(tokenPayload?.message ?? 'Could not initialize live token.');
			}

			liveSessionId = tokenPayload.sessionId ?? liveSessionId;
			activeLiveModel = tokenPayload.model ?? null;
			activeLiveResponseModality =
				tokenPayload?.responseModality === 'AUDIO' || tokenPayload?.responseModality === 'TEXT'
					? (tokenPayload.responseModality as 'AUDIO' | 'TEXT')
					: 'TEXT';

			const { GoogleGenAI, Modality } = await import('@google/genai');
			const liveResponseModality =
				activeLiveResponseModality === 'AUDIO' ? Modality.AUDIO : Modality.TEXT;
			const client = new GoogleGenAI({
				apiKey: tokenPayload.ephemeralToken,
				httpOptions: { apiVersion: 'v1alpha' }
			});

			addLiveDiagnostic('live_connect_start', {
				model: tokenPayload.model,
				responseModality: activeLiveResponseModality
			});
			const liveSession = await client.live.connect({
				model: tokenPayload.model,
				config: {
					responseModalities: [liveResponseModality],
					inputAudioTranscription: {},
					outputAudioTranscription: {}
				},
				callbacks: {
					onopen: () => {
						addLiveDiagnostic('socket_open');
					},
					onmessage: (message: LiveServerMessage) => {
						const hasUserTranscript = Boolean(message.serverContent?.inputTranscription?.text?.trim());
						const hasAssistantText = Boolean(
							message.text?.trim() || message.serverContent?.outputTranscription?.text?.trim()
						);
						if (hasUserTranscript || hasAssistantText) {
							addLiveDiagnostic('socket_message', {
								hasUserTranscript,
								hasAssistantText
							});
						}

						void handleLiveServerMessage(message).catch((messageError) => {
							liveStatus = 'error';
							liveError = resolveErrorMessage(
								messageError,
								'Live transcript processing failed while the session was active.'
							);
							addLiveDiagnostic('message_processing_error', messageError);
						});
					},
					onerror: (errorEvent: { error?: unknown; message?: string; type?: string }) => {
						addLiveDiagnostic('socket_error', {
							type: errorEvent?.type ?? null,
							message: errorEvent?.message ?? null,
							error: safeDetail(errorEvent?.error)
						});
						liveStatus = 'error';
						liveError =
							resolveErrorMessage(errorEvent?.error, '') ||
							errorEvent?.message ||
							'Live voice connection failed.';
						cleanupLiveVoiceConnection({ signalEnd: false, closeSession: true });
					},
					onclose: (closeEvent: CloseEvent) => {
						addLiveDiagnostic('socket_close', {
							code: closeEvent.code,
							reason: closeEvent.reason || null,
							wasClean: closeEvent.wasClean
						});
						cleanupLiveVoiceConnection({ signalEnd: false, closeSession: false });

						if (liveStopRequested) {
							liveStopRequested = false;
							liveStatus = 'idle';
							return;
						}

						if (liveStatus !== 'error') {
							liveStatus = 'error';
							liveError = `Live session closed unexpectedly (code ${closeEvent.code}${closeEvent.reason ? `: ${closeEvent.reason}` : ''})${activeLiveModel ? ` using model ${activeLiveModel}` : ''}${activeLiveResponseModality ? ` [${activeLiveResponseModality}]` : ''}.`;
						}
					}
				}
			});

			liveSessionConnection = {
				close: () => liveSession.close(),
				sendRealtimeInput: (args) =>
					liveSession.sendRealtimeInput(
						args as {
							audio?: { data: string; mimeType: string };
							audioStreamEnd?: boolean;
						}
						)
			};

			mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			addLiveDiagnostic('microphone_granted');

			if (isNativeAudioResponseMode()) {
				const AudioContextCtor =
					window.AudioContext ||
					(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
				if (!AudioContextCtor) {
					throw new Error('AudioContext is not available in this browser for PCM capture.');
				}

				audioContext = new AudioContextCtor();
				const pcmMimeType = `audio/pcm;rate=${Math.round(audioContext.sampleRate)}`;
				audioSourceNode = audioContext.createMediaStreamSource(mediaStream);
				audioProcessorNode = audioContext.createScriptProcessor(2048, 1, 1);

				addLiveDiagnostic('pcm_capture_ready', {
					sampleRate: audioContext.sampleRate,
					mimeType: pcmMimeType
				});

				audioProcessorNode.onaudioprocess = (processEvent) => {
					if (!liveSessionConnection) return;

					try {
						const channel = processEvent.inputBuffer.getChannelData(0);
						const pcmBytes = float32ToPcm16Bytes(channel);
						const data = bytesToBase64(pcmBytes);
						liveAudioChunkCount += 1;
						if (liveAudioChunkCount <= 3 || liveAudioChunkCount % 20 === 0) {
							addLiveDiagnostic('audio_chunk', {
								count: liveAudioChunkCount,
								size: pcmBytes.byteLength,
								mimeType: pcmMimeType
							});
						}

						liveSessionConnection.sendRealtimeInput({
							audio: {
								data,
								mimeType: pcmMimeType
							}
						});
					} catch (recordingError) {
						liveStatus = 'error';
						liveError = resolveErrorMessage(recordingError, 'Failed to stream PCM microphone audio.');
						addLiveDiagnostic('audio_stream_error', recordingError);
					}
				};

				audioSourceNode.connect(audioProcessorNode);
				audioProcessorNode.connect(audioContext.destination);
			} else {
				mediaRecorder = recorderMimeType
					? new MediaRecorder(mediaStream, { mimeType: recorderMimeType })
					: new MediaRecorder(mediaStream);
				addLiveDiagnostic('media_recorder_ready', {
					mimeType: recorderMimeType ?? mediaRecorder.mimeType ?? null
				});

				mediaRecorder.onstart = () => {
					addLiveDiagnostic('media_recorder_started');
				};

				mediaRecorder.onstop = () => {
					addLiveDiagnostic('media_recorder_stopped');
				};

				mediaRecorder.onerror = (event) => {
					addLiveDiagnostic('media_recorder_error', event);
				};

				mediaRecorder.ondataavailable = async (event) => {
					if (!liveSessionConnection || event.data.size === 0) return;
					liveAudioChunkCount += 1;
					if (liveAudioChunkCount <= 3 || liveAudioChunkCount % 20 === 0) {
						addLiveDiagnostic('audio_chunk', {
							count: liveAudioChunkCount,
							size: event.data.size,
							mimeType: event.data.type || recorderMimeType || 'audio/webm'
						});
					}

					try {
						const data = await blobToBase64(event.data);
						liveSessionConnection.sendRealtimeInput({
							audio: {
								data,
								mimeType: event.data.type || recorderMimeType || 'audio/webm'
							}
						});
					} catch (recordingError) {
						liveStatus = 'error';
						liveError = resolveErrorMessage(recordingError, 'Failed to stream microphone audio.');
						addLiveDiagnostic('audio_stream_error', recordingError);
					}
				};

				mediaRecorder.start(500);
			}
			liveStatus = 'connected';
			addLiveDiagnostic('session_connected', { sessionId: liveSessionId });
		} catch (error) {
			cleanupLiveVoiceConnection({ signalEnd: false, closeSession: true });
			liveStatus = 'error';
			liveError = resolveErrorMessage(error, 'Unable to start live voice session.');
			addLiveDiagnostic('start_failed', error);
		}
	}

	function stopLiveVoice() {
		liveStopRequested = true;
		addLiveDiagnostic('stop_requested');
		cleanupLiveVoiceConnection({ signalEnd: true, closeSession: true });
		liveStatus = 'idle';
	}

	onDestroy(() => {
		stopLiveVoice();
	});
</script>

<div class="space-y-6">
	{#if form?.message}
		<div class="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
			{form.message}
		</div>
	{:else if form?.success}
		<div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
			{form.success}
		</div>
	{/if}

	<section class="rounded-lg border bg-white p-4 shadow-sm md:p-5">
		<div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold">Hi {getPreferredName(data.patientName)}</h1>
			</div>
			<div class="grid gap-2 sm:grid-cols-3 lg:min-w-[28rem]">
				<div class="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
					<p class="text-xs text-emerald-700">Risk</p>
					<p class="font-semibold text-emerald-950">{data.latestRisk?.tier ?? 'No data'}</p>
				</div>
				<div class="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2">
					<p class="text-xs text-cyan-700">Sessions</p>
					<p class="font-semibold text-cyan-950">{data.upcomingSessions.length}</p>
				</div>
				<div class="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
					<p class="text-xs text-amber-700">Rewards</p>
					<p class="font-semibold text-amber-950">{data.rewardSummary.totalPoints} pts</p>
				</div>
			</div>
		</div>
	</section>

	{#if activeView === 'today'}
	<section class="grid gap-4 md:grid-cols-3">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm md:col-span-2">
			<Card.Header>
				<Badge class="w-fit bg-blue-100 text-blue-700 hover:bg-blue-100">Patient</Badge>
				<Card.Title>Daily recovery check-in</Card.Title>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/submitCheckin"
					class="grid gap-4 md:grid-cols-2"
					use:pendingForm={'submit-checkin'}
				>
					<div class="grid gap-2">
						<Label for="mood">Mood (1-5)</Label>
						<Input id="mood" name="mood" type="number" min="1" max="5" required value="3" />
					</div>
					<div class="grid gap-2">
						<Label for="craving">Urge to use substances (0-10)</Label>
						<Input id="craving" name="craving" type="number" min="0" max="10" required value="2" />
					</div>
					<div class="grid gap-2">
						<Label for="stress">Stress (0-10)</Label>
						<Input id="stress" name="stress" type="number" min="0" max="10" required value="3" />
					</div>
					<div class="grid gap-2">
						<Label for="sleepHours">Sleep (0-12 hrs)</Label>
						<Input id="sleepHours" name="sleepHours" type="number" min="0" max="12" required value="7" />
					</div>
					<div class="grid gap-2 md:col-span-2">
						<Label for="note">Optional note</Label>
						<Textarea id="note" name="note" placeholder="Anything your therapist should know today." />
					</div>
					<div class="md:col-span-2">
						<Button
							type="submit"
							class="w-full bg-blue-600 text-white hover:bg-blue-700"
							disabled={activeAction === 'submit-checkin'}
						>
							{#if activeAction === 'submit-checkin'}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Submitting check-in...
							{:else}
								Submit check-in
							{/if}
						</Button>
					</div>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Risk snapshot</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.latestRisk}
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<span class="text-sm">Current score</span>
							<span class="text-2xl font-semibold">{data.latestRisk.score}</span>
						</div>
						<Badge class={tierBadgeClass(data.latestRisk.tier)}>{data.latestRisk.tier}</Badge>
						<p class="text-muted-foreground text-xs">Updated {formatDate(data.latestRisk.createdAt)}</p>
						<div class="space-y-2">
							{#each parseFactors(data.latestRisk.factors) as factor (factor.label)}
								<div class="flex items-center justify-between rounded-md bg-blue-50 px-2 py-1 text-xs">
									<span>{factor.label}</span>
									<span class="font-medium">+{factor.points}</span>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<p class="text-muted-foreground text-sm">No risk snapshot yet. Submit your first check-in.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === 'care'}
	<section class="grid gap-6 xl:grid-cols-3">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Upcoming care calendar</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if data.upcomingSessions.length === 0}
					<p class="text-muted-foreground text-sm">
						No follow-up sessions are scheduled yet.
					</p>
				{:else}
					{#each data.upcomingSessions as session (session.id)}
						<div class="space-y-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
							<div class="flex items-center justify-between gap-3">
								<div>
									<p class="font-medium">{modeLabel(session.mode)} with {session.therapistName}</p>
									<p class="text-muted-foreground text-xs">{session.sessionAt ? formatDate(session.sessionAt) : 'Time pending'}</p>
								</div>
								<div class="flex flex-col items-end gap-1">
									<Badge variant="outline">{session.status}</Badge>
									{#if session.requiresConfirmation}
										<Badge class="bg-amber-100 text-amber-900 hover:bg-amber-100">Awaiting therapist confirmation</Badge>
									{/if}
								</div>
							</div>
							{#if session.automationReason}
								<p class="text-muted-foreground text-xs">{session.automationReason}</p>
							{/if}
							{#if session.meetingUrl}
								<Button
									type="button"
									variant="outline"
									class="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
									onclick={() => (window.location.href = session.meetingUrl!)}
								>
									Join {modeLabel(session.mode)}
								</Button>
							{/if}
							<form
								method="POST"
								action="?/rescheduleSession"
								class="grid gap-2 sm:grid-cols-[1fr_auto]"
								use:pendingForm={`patient-reschedule-session-${session.id}`}
							>
								<input type="hidden" name="sessionId" value={session.id} />
								<Input
									name="sessionAt"
									type="datetime-local"
									value={formatDateTimeInput(session.sessionAt)}
								/>
								<Button
									type="submit"
									variant="outline"
									class="border-blue-200 text-blue-700 hover:bg-blue-50"
									disabled={activeAction === `patient-reschedule-session-${session.id}`}
								>
									{#if activeAction === `patient-reschedule-session-${session.id}`}
										<LoaderCircleIcon class="size-4 animate-spin" />
									{:else}
										Request time
									{/if}
								</Button>
							</form>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Coping recommendations</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#each data.copingRecommendations as recommendation (recommendation.toolKey)}
					<form
						method="POST"
						action="?/logCopingActivity"
						class="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3"
						use:pendingForm={`coping-${recommendation.toolKey}`}
					>
						<input type="hidden" name="toolKey" value={recommendation.toolKey} />
						<input type="hidden" name="title" value={recommendation.title} />
						<div class="flex items-start justify-between gap-3">
							<div>
								<p class="font-medium">{recommendation.title}</p>
								<p class="text-muted-foreground text-xs">{recommendation.reason}</p>
							</div>
							<Badge class={recommendation.priority === 'urgent' ? 'bg-red-100 text-red-700 hover:bg-red-100' : recommendation.priority === 'important' ? 'bg-amber-100 text-amber-900 hover:bg-amber-100' : 'bg-blue-100 text-blue-700 hover:bg-blue-100'}>
								{recommendation.priority}
							</Badge>
						</div>
						<p class="text-sm">{recommendation.description}</p>
						<Button
							type="submit"
							variant="outline"
							class="border-blue-200 text-blue-700 hover:bg-blue-50"
							disabled={activeAction === `coping-${recommendation.toolKey}`}
						>
							{#if activeAction === `coping-${recommendation.toolKey}`}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Logging...
							{:else}
								Mark done
							{/if}
						</Button>
					</form>
				{/each}

				{#if data.copingActivity.length > 0}
					<div class="space-y-2 rounded-lg border border-blue-100 bg-white p-3">
						<p class="text-sm font-medium">Recent coping wins</p>
						{#each data.copingActivity.slice(0, 4) as entry (entry.id)}
							<div class="flex items-center justify-between gap-3 text-xs">
								<span>{entry.title}</span>
								<span class="text-muted-foreground">{formatDate(entry.createdAt)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Badges and rewards</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="rounded-lg bg-blue-600 px-4 py-4 text-white">
					<p class="text-sm text-blue-100">Recovery points</p>
					<p class="text-3xl font-semibold">{data.rewardSummary.totalPoints}</p>
				</div>
				{#if data.rewardSummary.badges.length === 0}
					<p class="text-muted-foreground text-sm">
						Submit check-ins, use coping tools, and stay engaged to unlock your first badge.
					</p>
				{:else}
					<div class="space-y-3">
						{#each data.rewardSummary.badges.slice(0, 5) as badge (badge.id)}
							<div class="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="font-medium">{badge.label}</p>
										<p class="text-muted-foreground text-xs">{badge.description}</p>
									</div>
									<Badge class="bg-blue-100 text-blue-700 hover:bg-blue-100">+{badge.points}</Badge>
								</div>
								<p class="text-muted-foreground mt-2 text-xs">Awarded {formatDate(badge.awardedAt)}</p>
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === 'messages'}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Badge class="w-fit bg-blue-100 text-blue-700 hover:bg-blue-100">{virtualTherapistProfile.name}</Badge>
				<Card.Title>Therapy chat</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if !data.aiFeatures.chatEnabled}
					<div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
						{virtualTherapistProfile.name} chat is disabled right now. Continue using daily check-ins and request human support if needed.
					</div>
				{:else}
					{#if chatError}
						<div class="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
							{chatError}
						</div>
					{/if}
					<div
						use:keepLatestMessagePinned={{ threshold: 120 }}
						class="max-h-[320px] space-y-2 overflow-y-auto rounded-md border bg-blue-50/30 p-3 [overflow-anchor:none]"
					>
						{#if chatMessages.length === 0}
							<div class="space-y-2 rounded-md bg-white px-3 py-3 text-sm">
								<p class="font-medium">Hi {getPreferredName(data.patientName)}, I&apos;m {virtualTherapistProfile.name}.</p>
								<p class="text-muted-foreground">
									I already have your recovery history, goals, and recent check-ins in view, so you can start anywhere.
								</p>
								<p class="text-muted-foreground">
									If you mention urgent safety concerns, the care team is alerted right away.
								</p>
							</div>
						{:else}
							{#each chatMessages as message (message.id)}
								<div class={`rounded-md px-3 py-2 text-sm ${message.role === 'user' ? 'ml-auto max-w-[85%] bg-blue-600 text-white' : 'max-w-[90%] bg-white'}`}>
									<p class="text-xs opacity-70">
										{message.role === 'user' ? 'You' : virtualTherapistProfile.name} · {formatTimestamp(message.createdAt)}
									</p>
									<p class="whitespace-pre-wrap">{message.content}</p>
								</div>
							{/each}
						{/if}
					</div>
					<div class="sticky bottom-0 rounded-md border bg-white p-2">
						<div class="flex gap-2">
							<Input
								value={chatInput}
								oninput={(event) => (chatInput = (event.currentTarget as HTMLInputElement).value)}
								placeholder="Share how you're feeling right now..."
								onkeydown={(event) => {
									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault();
										void sendChatMessage();
									}
								}}
							/>
							<Button
								type="button"
								class="bg-blue-600 text-white hover:bg-blue-700"
								disabled={chatSending || !chatInput.trim()}
								onclick={sendChatMessage}
							>
								{#if chatSending}
									<LoaderCircleIcon class="size-4 animate-spin" />
								{:else}
									<SendIcon class="size-4" />
								{/if}
							</Button>
						</div>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Live voice with {virtualTherapistProfile.name}</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="flex items-center gap-2">
					<Badge variant="outline">{liveStatus}</Badge>
					{#if liveSessionId}
						<span class="text-muted-foreground text-xs">Session: {liveSessionId.slice(0, 8)}...</span>
					{/if}
				</div>
				{#if liveError}
					<div class="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
						{liveError}
					</div>
				{/if}
				<div class="flex gap-2">
					<Button
						type="button"
						class="bg-blue-600 text-white hover:bg-blue-700"
						disabled={liveStatus === 'connecting' || liveStatus === 'connected' || !data.aiFeatures.liveVoiceEnabled || !supportsLiveVoice}
						onclick={startLiveVoice}
					>
						<MicIcon class="size-4" />
						{liveStatus === 'connecting' ? 'Connecting...' : 'Start live voice'}
					</Button>
					<Button
						type="button"
						variant="outline"
						class="border-red-300 text-red-700 hover:bg-red-50"
						disabled={liveStatus !== 'connected'}
						onclick={stopLiveVoice}
					>
						<SquareIcon class="size-4" />
						Stop session
					</Button>
				</div>
				{#if !data.aiFeatures.liveVoiceEnabled}
					<p class="text-amber-700 text-xs">Live voice is currently disabled by configuration.</p>
				{:else if !supportsLiveVoice}
					<p class="text-amber-700 text-xs">
						Your browser does not support the audio APIs required for live microphone and speaker streaming.
					</p>
				{/if}
				<p class="text-muted-foreground text-xs">
					Microphone audio is streamed to Gemini Live for {virtualTherapistProfile.name}; transcripts are stored for care safety monitoring.
				</p>
				<details class="rounded-md border bg-white p-3 text-xs">
					<summary class="cursor-pointer font-medium">Connection diagnostics</summary>
					<div class="mt-2 max-h-[180px] space-y-1 overflow-y-auto">
						{#if liveDiagnostics.length === 0}
							<p class="text-muted-foreground">No diagnostics captured yet.</p>
						{:else}
							{#each liveDiagnostics as entry (entry.id)}
								<div class="rounded bg-blue-50/60 px-2 py-1">
									<p class="font-medium">{formatTimestamp(entry.at)} · {entry.event}</p>
									{#if entry.detail}
										<p class="text-muted-foreground break-words">{entry.detail}</p>
									{/if}
								</div>
							{/each}
						{/if}
					</div>
				</details>
				<div class="max-h-[220px] space-y-2 overflow-y-auto rounded-md border bg-blue-50/30 p-3">
						{#if liveLog.length === 0}
							<p class="text-muted-foreground text-sm">
								No live transcript yet. Start a session and {virtualTherapistProfile.name} will respond using your name and recovery context.
							</p>
						{:else}
							{#each liveLog as entry (entry.id)}
								<div class={`rounded-md px-3 py-2 text-sm ${entry.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white'}`}>
									<p class="text-xs opacity-70">
										{entry.role === 'user' ? 'You' : virtualTherapistProfile.name} · {formatTimestamp(entry.createdAt)}
									</p>
									<p class="whitespace-pre-wrap">{entry.text}</p>
								</div>
						{/each}
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	<section>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Message your therapist</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.therapistConversations.length === 0}
					<p class="text-muted-foreground text-sm">
						No therapist assignment is available for direct messaging yet.
					</p>
				{:else}
					{#each data.therapistConversations as conversation (conversation.therapistId)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-medium">{conversation.therapistName}</p>
									<p class="text-muted-foreground text-xs">{conversation.therapistEmail}</p>
								</div>
								{#if conversation.lastMessageAt}
									<Badge variant="outline">{formatDate(conversation.lastMessageAt)}</Badge>
								{:else}
									<Badge variant="secondary">No messages yet</Badge>
								{/if}
							</div>
							<div class="max-h-56 space-y-2 overflow-y-auto rounded-md border bg-white p-3">
								{#if conversation.messages.length === 0}
									<p class="text-muted-foreground text-sm">
										Send the first update when you need asynchronous therapist follow-up.
									</p>
								{:else}
									{#each conversation.messages as message (message.id)}
										<div
											class={`rounded-md px-3 py-2 text-sm ${message.role === 'patient' ? 'ml-auto max-w-[90%] bg-blue-600 text-white' : 'max-w-[90%] bg-slate-100 text-slate-900'}`}
										>
											<p class="text-xs opacity-70">
												{message.senderName} · {formatDate(message.createdAt)}
											</p>
											<p class="whitespace-pre-wrap">{message.content}</p>
										</div>
									{/each}
								{/if}
							</div>
							<form
								method="POST"
								action="?/sendTherapistMessage"
								class="space-y-3"
								use:pendingForm={`send-therapist-message-${conversation.therapistId}`}
							>
								<input type="hidden" name="therapistId" value={conversation.therapistId} />
								<div class="grid gap-2">
									<Label for={`therapist-message-${conversation.therapistId}`}>Message</Label>
									<Textarea
										id={`therapist-message-${conversation.therapistId}`}
										name="content"
										required
										placeholder="Share an update, question, or support need."
									/>
								</div>
								<Button
									type="submit"
									class="bg-blue-600 text-white hover:bg-blue-700"
									disabled={activeAction === `send-therapist-message-${conversation.therapistId}`}
								>
									{#if activeAction === `send-therapist-message-${conversation.therapistId}`}
										<LoaderCircleIcon class="size-4 animate-spin" />
										Sending...
									{:else}
										Send to therapist
									{/if}
								</Button>
							</form>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === 'history'}
	<section>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Clinical signal log</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if data.recentSignals.length === 0}
					<p class="text-muted-foreground text-sm">
						No structured signals have been captured yet.
					</p>
				{:else}
					{#each data.recentSignals as signal (signal.id)}
						<div class="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
							<div class="flex items-center justify-between gap-3">
								<div class="flex items-center gap-2">
									<Badge class={tierBadgeClass(signal.severity >= 75 ? 'high' : signal.severity >= 45 ? 'moderate' : 'low')}>
										{signal.signalType.replaceAll('_', ' ')}
									</Badge>
									<Badge variant="outline">{signal.source.replaceAll('_', ' ')}</Badge>
								</div>
								<span class="text-muted-foreground text-xs">{formatDate(signal.occurredAt)}</span>
							</div>
							<p class="mt-2 text-sm">{signal.summary}</p>
							<p class="text-muted-foreground mt-1 text-xs">
								Severity {signal.severity} · Confidence {signal.confidence}
							</p>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Need immediate support?</Card.Title>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/requestHumanSupport"
					class="space-y-4"
					use:pendingForm={'request-human-support'}
				>
					<div class="grid gap-2">
						<Label for="reason">What is happening right now?</Label>
						<Textarea
							id="reason"
							name="reason"
							placeholder="I need someone to reach out immediately..."
						/>
					</div>
					<Button
						type="submit"
						variant="outline"
						class="w-full border-red-300 text-red-700 hover:bg-red-50"
						disabled={activeAction === 'request-human-support'}
					>
						{#if activeAction === 'request-human-support'}
							<LoaderCircleIcon class="size-4 animate-spin" />
							Escalating...
						{:else}
							Escalate to human support
						{/if}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Recent alerts</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Level</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Created</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.recentAlerts.length === 0}
								<Table.Row>
									<Table.Cell colspan={3} class="text-muted-foreground py-6 text-center">
										No alerts recorded.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.recentAlerts as alert (alert.id)}
									<Table.Row>
										<Table.Cell>
											<Badge class={tierBadgeClass(alert.level)}>{alert.level}</Badge>
										</Table.Cell>
										<Table.Cell>{alert.status}</Table.Cell>
										<Table.Cell>{formatDate(alert.createdAt)}</Table.Cell>
									</Table.Row>
								{/each}
							{/if}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
		<Card.Header>
			<Card.Title>Check-in history</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>When</Table.Head>
							<Table.Head>Mood</Table.Head>
							<Table.Head>Urge to use substances</Table.Head>
							<Table.Head>Stress</Table.Head>
							<Table.Head>Sleep</Table.Head>
							<Table.Head>Note</Table.Head>
							<Table.Head>Manage</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if data.recentCheckins.length === 0}
							<Table.Row>
								<Table.Cell colspan={7} class="text-muted-foreground py-6 text-center">
									No check-ins submitted yet.
								</Table.Cell>
							</Table.Row>
						{:else}
							{#each data.recentCheckins as checkin (checkin.id)}
								<Table.Row>
									<Table.Cell>{formatDate(checkin.createdAt)}</Table.Cell>
									<Table.Cell>{checkin.mood}</Table.Cell>
									<Table.Cell>{checkin.craving}</Table.Cell>
									<Table.Cell>{checkin.stress}</Table.Cell>
									<Table.Cell>{checkin.sleepHours}h</Table.Cell>
									<Table.Cell class="max-w-[280px] truncate">{checkin.note ?? '-'}</Table.Cell>
									<Table.Cell>
										<form
											method="POST"
											action="?/deleteCheckin"
											use:pendingForm={`delete-checkin-${checkin.id}`}
										>
											<input type="hidden" name="checkinId" value={checkin.id} />
											<Button
												type="submit"
												variant="ghost"
												class="text-destructive hover:text-destructive"
												disabled={activeAction === `delete-checkin-${checkin.id}`}
											>
												{#if activeAction === `delete-checkin-${checkin.id}`}
													<LoaderCircleIcon class="size-4 animate-spin" />
												{:else}
													Delete
												{/if}
											</Button>
										</form>
									</Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell colspan={7} class="bg-blue-50/60">
										<form
											method="POST"
											action="?/updateCheckin"
											class="grid gap-2 md:grid-cols-[80px_90px_90px_100px_1fr_auto]"
											use:pendingForm={`update-checkin-${checkin.id}`}
										>
											<input type="hidden" name="checkinId" value={checkin.id} />
											<Input name="mood" type="number" min="1" max="5" value={checkin.mood} required class="h-8" />
											<Input
												name="craving"
												type="number"
												min="0"
												max="10"
												value={checkin.craving}
												required
												class="h-8"
											/>
											<Input
												name="stress"
												type="number"
												min="0"
												max="10"
												value={checkin.stress}
												required
												class="h-8"
											/>
											<Input
												name="sleepHours"
												type="number"
												min="0"
												max="12"
												value={checkin.sleepHours}
												required
												class="h-8"
											/>
											<Input name="note" value={checkin.note ?? ''} class="h-8" />
											<Button
												type="submit"
												variant="outline"
												size="sm"
												disabled={activeAction === `update-checkin-${checkin.id}`}
											>
												{#if activeAction === `update-checkin-${checkin.id}`}
													<LoaderCircleIcon class="size-4 animate-spin" />
												{:else}
													Update
												{/if}
											</Button>
										</form>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>
	{/if}
</div>
