<script lang="ts">
	import { onDestroy } from 'svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PhoneOffIcon from '@lucide/svelte/icons/phone-off';
	import VideoIcon from '@lucide/svelte/icons/video';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let localVideoEl = $state<HTMLVideoElement | null>(null);
	let remoteVideoEl = $state<HTMLVideoElement | null>(null);
	let remoteAudioEl = $state<HTMLAudioElement | null>(null);
	let localStream = $state<MediaStream | null>(null);
	let remoteStream = $state<MediaStream | null>(null);
	let callState = $state<'idle' | 'requesting' | 'connecting' | 'connected' | 'ended' | 'error'>('idle');
	let callError = $state<string | null>(null);
	let joined = $state(false);

	let peer: RTCPeerConnection | null = null;
	let pendingIceCandidates: RTCIceCandidateInit[] = [];
	let signalCursor = '';
	let pollHandle: ReturnType<typeof setInterval> | null = null;

	const isVideoMode = $derived(data.session.mode === 'video');
	const isInitiator = $derived(data.currentUser.role === 'therapist');
	type CallSignalType = 'offer' | 'answer' | 'ice' | 'hangup' | 'ready' | 'reset';

	function formatDate(value: string | Date | null) {
		if (!value) return 'TBD';
		const date = typeof value === 'string' ? new Date(value) : value;
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}

	async function playMediaElement(element: HTMLMediaElement | null) {
		if (!element) return;

		try {
			await element.play();
		} catch {
			// Browsers may block autoplay until media becomes active. Retry on the next attachment.
		}
	}

	function attachMediaTargets() {
		if (localVideoEl && localStream) {
			localVideoEl.srcObject = localStream;
			void playMediaElement(localVideoEl);
		} else if (localVideoEl) {
			localVideoEl.srcObject = null;
		}

		if (remoteVideoEl) {
			remoteVideoEl.srcObject = isVideoMode && remoteStream ? remoteStream : null;
			if (remoteVideoEl.srcObject) {
				void playMediaElement(remoteVideoEl);
			}
		}

		if (remoteAudioEl) {
			remoteAudioEl.srcObject = remoteStream;
			if (remoteAudioEl.srcObject) {
				void playMediaElement(remoteAudioEl);
			}
		}
	}

	$effect(() => {
		attachMediaTargets();
	});

	async function sendSignal(
		signalType: CallSignalType,
		payload: Record<string, unknown>
	) {
		const response = await fetch(`/api/session/${data.session.id}/signals`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				signalType,
				payload
			})
		});

		if (!response.ok) {
			const payload = await response.json().catch(() => null);
			throw new Error(payload?.message ?? 'Could not send the session signal.');
		}
	}

	function resetPeerConnectionState() {
		if (peer) {
			peer.onicecandidate = null;
			peer.ontrack = null;
			peer.onconnectionstatechange = null;
			peer.close();
		}

		for (const track of remoteStream?.getTracks() ?? []) {
			track.stop();
		}

		remoteStream = null;
		peer = null;
		pendingIceCandidates = [];
		attachMediaTargets();
	}

	async function ensurePeerConnection() {
		if (peer) {
			return peer;
		}

		peer = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		});
		remoteStream = new MediaStream();
		attachMediaTargets();

		peer.onicecandidate = async (event) => {
			if (!event.candidate) return;
			try {
				await sendSignal('ice', {
					candidate: event.candidate.toJSON()
				});
			} catch (error) {
				callError = error instanceof Error ? error.message : 'Failed to send ICE candidate.';
				callState = 'error';
			}
		};

		peer.ontrack = (event) => {
			if (!remoteStream) {
				remoteStream = new MediaStream();
			}

			const incomingTracks =
				event.streams.length > 0
					? event.streams.flatMap((stream) => stream.getTracks())
					: [event.track];

			for (const track of incomingTracks) {
				if (!remoteStream.getTracks().some((existing) => existing.id === track.id)) {
					remoteStream.addTrack(track);
				}
			}

			event.track.onunmute = () => {
				attachMediaTargets();
			};

			attachMediaTargets();
			if (remoteStream.getTracks().length > 0) {
				callState = 'connected';
			}
		};

		peer.onconnectionstatechange = () => {
			if (!peer) return;
			if (peer.connectionState === 'connected') {
				callState = 'connected';
			}
			if (peer.connectionState === 'connecting' || peer.connectionState === 'new') {
				callState = 'connecting';
			}
			if (peer.connectionState === 'disconnected' && joined) {
				callState = 'connecting';
			}
			if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
				callState = 'ended';
			}
		};

		if (localStream) {
			for (const track of localStream.getTracks()) {
				peer.addTrack(track, localStream);
			}
		}

		return peer;
	}

	async function flushPendingIce() {
		if (!peer || !peer.remoteDescription) return;

		while (pendingIceCandidates.length > 0) {
			const candidate = pendingIceCandidates.shift();
			if (!candidate) continue;
			await peer.addIceCandidate(new RTCIceCandidate(candidate));
		}
	}

	async function handleSignal(signal: {
		id: string;
		signalType: string;
		payload: Record<string, unknown>;
		createdAt: string;
	}) {
		signalCursor = signal.createdAt;

		if (!joined && signal.signalType !== 'ready' && signal.signalType !== 'reset') {
			return;
		}

		if (signal.signalType === 'reset') {
			resetPeerConnectionState();
			if (joined) {
				callState = 'connecting';
			}
			return;
		}

		if (signal.signalType === 'hangup') {
			cleanup(false);
			callState = 'ended';
			return;
		}

		if (signal.signalType === 'ready') {
			return;
		}

		const connection = await ensurePeerConnection();

		if (signal.signalType === 'offer') {
			const rawType =
				signal.payload.type === 'offer' ||
				signal.payload.type === 'answer' ||
				signal.payload.type === 'pranswer' ||
				signal.payload.type === 'rollback'
					? signal.payload.type
					: 'offer';
			const type = rawType as RTCSdpType;
			const sdp = typeof signal.payload.sdp === 'string' ? signal.payload.sdp : '';
			if (!sdp) return;

			await connection.setRemoteDescription({ type, sdp });
			await flushPendingIce();
			const answer = await connection.createAnswer();
			await connection.setLocalDescription(answer);
			await sendSignal('answer', {
				type: answer.type,
				sdp: answer.sdp
			});
			return;
		}

		if (signal.signalType === 'answer') {
			const rawType =
				signal.payload.type === 'offer' ||
				signal.payload.type === 'answer' ||
				signal.payload.type === 'pranswer' ||
				signal.payload.type === 'rollback'
					? signal.payload.type
					: 'answer';
			const type = rawType as RTCSdpType;
			const sdp = typeof signal.payload.sdp === 'string' ? signal.payload.sdp : '';
			if (!sdp || connection.currentRemoteDescription) return;

			await connection.setRemoteDescription({ type, sdp });
			await flushPendingIce();
			return;
		}

		if (signal.signalType === 'ice') {
			const candidate = signal.payload.candidate as RTCIceCandidateInit | undefined;
			if (!candidate) return;
			if (connection.remoteDescription) {
				await connection.addIceCandidate(new RTCIceCandidate(candidate));
			} else {
				pendingIceCandidates.push(candidate);
			}
		}
	}

	async function pollSignals() {
		const params = new URLSearchParams();
		if (signalCursor) {
			params.set('since', signalCursor);
		}

		const response = await fetch(`/api/session/${data.session.id}/signals?${params.toString()}`);
		if (!response.ok) {
			const payload = await response.json().catch(() => null);
			throw new Error(payload?.message ?? 'Could not load session updates.');
		}

		const payload = await response.json();
		for (const signal of payload.signals ?? []) {
			await handleSignal(signal);
		}
	}

	function startPolling() {
		if (pollHandle) return;
		void pollSignals().catch((error) => {
			callError = error instanceof Error ? error.message : 'Could not load call updates.';
		});

		pollHandle = setInterval(() => {
			void pollSignals().catch((error) => {
				callError = error instanceof Error ? error.message : 'Could not load call updates.';
			});
		}, 1200);
	}

	function stopPolling() {
		if (pollHandle) {
			clearInterval(pollHandle);
			pollHandle = null;
		}
	}

	async function startCall() {
		if (joined || callState === 'requesting') return;

		callState = 'requesting';
		callError = null;

		try {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: isVideoMode
			});
			attachMediaTargets();

			joined = true;
			callState = 'connecting';

			if (isInitiator) {
				await sendSignal('reset', {
					role: data.currentUser.role
				});
			}

			await ensurePeerConnection();
			startPolling();
			await sendSignal('ready', {
				role: data.currentUser.role
			});

			if (isInitiator && peer && !peer.localDescription) {
				const offer = await peer.createOffer();
				await peer.setLocalDescription(offer);
				await sendSignal('offer', {
					type: offer.type,
					sdp: offer.sdp
				});
			}
		} catch (error) {
			callError = error instanceof Error ? error.message : 'Unable to start the session.';
			callState = 'error';
			cleanup(false);
		}
	}

	async function endCall() {
		try {
			await sendSignal('hangup', {
				role: data.currentUser.role
			});
		} catch {
			// Ignore hangup delivery failure on local cleanup.
		}
		cleanup(false);
		callState = 'ended';
	}

	function cleanup(resetCursor = false) {
		stopPolling();

		for (const stream of [localStream, remoteStream]) {
			for (const track of stream?.getTracks() ?? []) {
				track.stop();
			}
		}

		if (peer) {
			peer.onicecandidate = null;
			peer.ontrack = null;
			peer.onconnectionstatechange = null;
			peer.close();
		}

		localStream = null;
		remoteStream = null;
		peer = null;
		pendingIceCandidates = [];
		joined = false;

		if (resetCursor) {
			signalCursor = '';
		}
	}

	onDestroy(() => {
		cleanup(false);
	});
</script>

<div class="space-y-6">
	<section class="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<div class="flex items-center justify-between gap-3">
					<div>
						<Card.Title>{isVideoMode ? 'Video follow-up room' : 'Audio follow-up room'}</Card.Title>
						<Card.Description>
							Meeting code {data.session.meetingCode ?? data.session.id.slice(0, 8).toUpperCase()}
						</Card.Description>
					</div>
					<Badge class="bg-blue-100 text-blue-700 hover:bg-blue-100">
						{data.session.mode.replaceAll('_', ' ')}
					</Badge>
				</div>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if callError}
					<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{callError}
					</div>
				{/if}

				<div class="grid gap-4 lg:grid-cols-2">
					<div class="space-y-2">
						<p class="text-sm font-medium">You</p>
						<div class="bg-slate-950 flex aspect-video items-center justify-center overflow-hidden rounded-xl">
							{#if isVideoMode}
								<video bind:this={localVideoEl} autoplay muted playsinline class="h-full w-full object-cover"></video>
							{:else}
								<div class="text-center text-sm text-slate-300">
									Microphone only
								</div>
							{/if}
						</div>
					</div>

					<div class="space-y-2">
						<p class="text-sm font-medium">
							{data.currentUser.role === 'therapist'
								? data.session.patient?.name ?? 'Patient'
								: data.session.therapist?.name ?? 'Therapist'}
						</p>
						<div class="bg-slate-950 flex aspect-video items-center justify-center overflow-hidden rounded-xl">
							{#if isVideoMode}
								<video bind:this={remoteVideoEl} autoplay playsinline class="h-full w-full object-cover"></video>
								<audio
									bind:this={remoteAudioEl}
									autoplay
									playsinline
									class="sr-only"
								></audio>
							{:else}
								<div class="text-center text-sm text-slate-300">
									Waiting for remote audio
									<audio bind:this={remoteAudioEl} autoplay controls class="mt-3 w-full max-w-xs"></audio>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						class="bg-blue-600 text-white hover:bg-blue-700"
						disabled={callState === 'requesting' || joined}
						onclick={startCall}
					>
						{#if callState === 'requesting'}
							<LoaderCircleIcon class="size-4 animate-spin" />
							Joining...
						{:else}
							<VideoIcon class="size-4" />
							Join session
						{/if}
					</Button>
					<Button
						type="button"
						variant="outline"
						class="border-red-200 text-red-700 hover:bg-red-50"
						disabled={!joined}
						onclick={endCall}
					>
						<PhoneOffIcon class="size-4" />
						End call
					</Button>
					<Badge variant="outline">{callState}</Badge>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Session details</Card.Title>
				<Card.Description>Keep the session context close while you call.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4 text-sm">
				<div class="rounded-lg bg-blue-50 px-4 py-3">
					<p class="font-medium">Scheduled</p>
					<p class="text-muted-foreground">{formatDate(data.session.scheduledStartAt)}</p>
				</div>
				<div class="rounded-lg bg-blue-50 px-4 py-3">
					<p class="font-medium">Therapist</p>
					<p class="text-muted-foreground">{data.session.therapist?.name ?? 'Care team'}</p>
				</div>
				<div class="rounded-lg bg-blue-50 px-4 py-3">
					<p class="font-medium">Patient</p>
					<p class="text-muted-foreground">{data.session.patient?.name ?? 'Assigned patient'}</p>
				</div>
				<p class="text-muted-foreground text-xs">
					This room uses WebRTC with database-backed signaling. If one side joins first, the other participant can still connect when ready.
				</p>
			</Card.Content>
		</Card.Root>
	</section>
</div>
