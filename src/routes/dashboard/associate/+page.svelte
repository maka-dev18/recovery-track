<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';

	type AssociatePageData = {
		observationCategories: string[];
		linkedPatients: Array<{
			patientId: string;
			patientName: string;
			patientEmail: string;
			relationshipLabel: string;
			latestRisk:
				| {
						tier: string;
						score: number;
						createdAt: Date;
				  }
				| undefined;
		}>;
		recentObservations: Array<{
			id: string;
			patientName: string;
			category: string;
			severity: number;
			note: string;
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
			associateId: string;
			associateName: string;
			associateEmail: string;
			lastMessageAt: Date | null;
			lastMessagePreview: string | null;
			messages: Array<{
				id: string;
				role: 'therapist' | 'associate';
				senderName: string;
				content: string;
				createdAt: Date;
			}>;
		}>;
		aiConversations: Array<{
			threadId: string | null;
			patientId: string;
			patientName: string;
			patientEmail: string;
			associateId: string;
			associateName: string;
			lastMessageAt: Date | null;
			lastMessagePreview: string | null;
			messages: Array<{
				id: string;
				role: 'associate' | 'assistant';
				senderName: string;
				content: string;
				createdAt: Date;
			}>;
		}>;
		aiFeatures: {
			chatEnabled: boolean;
		};
	};

	type AssociatePageForm = {
		message?: string;
		success?: string;
		mode?: string;
	} | null;

	let { data, form }: { data: AssociatePageData; form: AssociatePageForm } = $props();
	let activeAction = $state<string | null>(null);
	let aiDraftByPatientId = $state<Record<string, string>>({});
	let aiSendingPatientId = $state<string | null>(null);
	let aiError = $state<string | null>(null);
	let aiConversations = $state<AssociatePageData['aiConversations']>([]);

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

	function tierBadgeClass(tier: string | null | undefined) {
		if (tier === 'critical') return 'bg-red-600 text-white';
		if (tier === 'high') return 'bg-orange-500 text-white';
		if (tier === 'moderate') return 'bg-amber-400 text-amber-950';
		return 'bg-blue-100 text-blue-700';
	}

	function resolveErrorMessage(error: unknown, fallback: string) {
		if (error instanceof Error) return error.message;
		return fallback;
	}

	$effect(() => {
		if (aiConversations.length === 0) {
			aiConversations = data.aiConversations;
		}
	});

	async function streamAssociateAiResponse(response: Response, patientId: string, assistantMessageId: string) {
		const stream = response.body;
		if (!stream) {
			throw new Error('AI response stream is unavailable.');
		}

		const decoder = new TextDecoder();
		const reader = stream.getReader();
		let accumulated = '';

		aiConversations = aiConversations.map((conversation) =>
			conversation.patientId === patientId
				? {
						...conversation,
						messages: [
							...conversation.messages,
							{
								id: assistantMessageId,
								role: 'assistant',
								senderName: 'AI therapist',
								content: '',
								createdAt: new Date()
							}
						]
				  }
				: conversation
		);

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			accumulated += decoder.decode(value, { stream: true });
			aiConversations = aiConversations.map((conversation) =>
				conversation.patientId === patientId
					? {
							...conversation,
							messages: conversation.messages.map((message) =>
								message.id === assistantMessageId
									? { ...message, content: accumulated }
									: message
							)
					  }
					: conversation
			);
		}

		accumulated += decoder.decode();
		aiConversations = aiConversations.map((conversation) =>
			conversation.patientId === patientId
				? {
						...conversation,
						messages: conversation.messages.map((message) =>
							message.id === assistantMessageId ? { ...message, content: accumulated } : message
						)
				  }
				: conversation
		);
	}

	async function sendAssociateAiMessage(patientId: string) {
		if (!data.aiFeatures.chatEnabled) {
			aiError = 'Associate AI support chat is currently disabled.';
			return;
		}

		const text = aiDraftByPatientId[patientId]?.trim() ?? '';
		if (!text || aiSendingPatientId) return;

		aiSendingPatientId = patientId;
		aiError = null;

		const userMessage = {
			id: crypto.randomUUID(),
			role: 'associate' as const,
			senderName: 'You',
			content: text,
			createdAt: new Date()
		};

		aiConversations = aiConversations.map((conversation) =>
			conversation.patientId === patientId
				? {
						...conversation,
						messages: [...conversation.messages, userMessage]
				  }
				: conversation
		);
		aiDraftByPatientId = { ...aiDraftByPatientId, [patientId]: '' };

		try {
			const response = await fetch('/api/associate/ai-therapist/messages', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					patientId,
					text
				})
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.message ?? 'Associate AI message failed.');
			}

			await streamAssociateAiResponse(response, patientId, crypto.randomUUID());
			await invalidateAll();
		} catch (error) {
			aiError = resolveErrorMessage(error, 'Could not send the AI update right now.');
		} finally {
			aiSendingPatientId = null;
		}
	}
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

	<section class="grid gap-4 md:grid-cols-3">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm md:col-span-2">
			<Card.Header>
				<Badge class="w-fit bg-blue-100 text-blue-700 hover:bg-blue-100">Associate</Badge>
				<Card.Title>Submit observation</Card.Title>
				<Card.Description>
					Log what you are noticing so the therapist can intervene early.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/submitObservation"
					class="grid gap-4"
					use:pendingForm={'submit-observation'}
				>
					<div class="grid gap-2 md:grid-cols-2">
						<div class="grid gap-2">
							<Label for="patientId">Patient</Label>
							<select
								id="patientId"
								name="patientId"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Select patient</option>
								{#each data.linkedPatients as patient (patient.patientId)}
									<option value={patient.patientId}>{patient.patientName}</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="category">Category</Label>
							<select
								id="category"
								name="category"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								{#each data.observationCategories as category (category)}
									<option value={category}>{category.replaceAll('_', ' ')}</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="severity">Severity (1-5)</Label>
						<select
							id="severity"
							name="severity"
							required
							class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
						>
							<option value="1">1 - Low concern</option>
							<option value="2">2</option>
							<option value="3">3 - Medium concern</option>
							<option value="4">4</option>
							<option value="5">5 - Severe concern</option>
						</select>
					</div>
					<div class="grid gap-2">
						<Label for="note">Observation note</Label>
						<Textarea
							id="note"
							name="note"
							required
							placeholder="Describe the behavior or incident you observed."
						/>
					</div>
					<Button
						type="submit"
						class="bg-blue-600 text-white hover:bg-blue-700"
						disabled={activeAction === 'submit-observation'}
					>
						{#if activeAction === 'submit-observation'}
							<LoaderCircleIcon class="size-4 animate-spin" />
							Submitting...
						{:else}
							Submit observation
						{/if}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Overview</Card.Title>
				<Card.Description>Your current support network coverage.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 text-sm">
				<div class="flex items-center justify-between rounded-md bg-blue-50 px-3 py-2">
					<span>Linked patients</span>
					<span class="font-semibold">{data.linkedPatients.length}</span>
				</div>
				<div class="flex items-center justify-between rounded-md bg-blue-50 px-3 py-2">
					<span>Recent observations</span>
					<span class="font-semibold">{data.recentObservations.length}</span>
				</div>
				<div class="flex items-center justify-between rounded-md bg-blue-50 px-3 py-2">
					<span>Care-team threads</span>
					<span class="font-semibold">{data.therapistConversations.length + data.aiConversations.length}</span>
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Linked patients</Card.Title>
				<Card.Description>People you are currently authorized to report on.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Relationship</Table.Head>
								<Table.Head>Risk</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.linkedPatients.length === 0}
								<Table.Row>
									<Table.Cell colspan={3} class="text-muted-foreground py-6 text-center">
										No patient links yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.linkedPatients as patient (patient.patientId)}
									<Table.Row>
										<Table.Cell>
											<div class="font-medium">{patient.patientName}</div>
											<div class="text-muted-foreground text-xs">{patient.patientEmail}</div>
										</Table.Cell>
										<Table.Cell>{patient.relationshipLabel}</Table.Cell>
										<Table.Cell>
											{#if patient.latestRisk}
												<Badge class={tierBadgeClass(patient.latestRisk.tier)}>
													{patient.latestRisk.tier} ({patient.latestRisk.score})
												</Badge>
											{:else}
												<Badge variant="secondary">No data</Badge>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
							{/if}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Your observation history</Card.Title>
				<Card.Description>Most recent logs from your account.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>When</Table.Head>
							<Table.Head>Patient</Table.Head>
							<Table.Head>Category</Table.Head>
							<Table.Head>Severity</Table.Head>
							<Table.Head>Manage</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if data.recentObservations.length === 0}
							<Table.Row>
								<Table.Cell colspan={5} class="text-muted-foreground py-6 text-center">
									No observations logged yet.
								</Table.Cell>
							</Table.Row>
						{:else}
							{#each data.recentObservations as observation (observation.id)}
								<Table.Row>
									<Table.Cell>{formatDate(observation.createdAt)}</Table.Cell>
									<Table.Cell>{observation.patientName}</Table.Cell>
									<Table.Cell>{observation.category.replaceAll('_', ' ')}</Table.Cell>
									<Table.Cell>{observation.severity}</Table.Cell>
									<Table.Cell>
										<form
											method="POST"
											action="?/deleteObservation"
											use:pendingForm={`delete-observation-${observation.id}`}
										>
											<input type="hidden" name="observationId" value={observation.id} />
											<Button
												type="submit"
												variant="ghost"
												class="text-destructive hover:text-destructive"
												disabled={activeAction === `delete-observation-${observation.id}`}
											>
												{#if activeAction === `delete-observation-${observation.id}`}
													<LoaderCircleIcon class="size-4 animate-spin" />
												{:else}
													Delete
												{/if}
											</Button>
										</form>
									</Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell colspan={5} class="text-muted-foreground bg-blue-50/60 text-xs">
										<form
											method="POST"
											action="?/updateObservation"
											class="grid gap-2 md:grid-cols-[180px_90px_1fr_auto]"
											use:pendingForm={`update-observation-${observation.id}`}
										>
											<input type="hidden" name="observationId" value={observation.id} />
											<select
												name="category"
												value={observation.category}
												class="border-input bg-background ring-offset-background focus-visible:ring-ring h-8 rounded-md border px-3 text-xs shadow-xs outline-none focus-visible:ring-2"
											>
												{#each data.observationCategories as category (category)}
													<option value={category}>{category.replaceAll('_', ' ')}</option>
												{/each}
											</select>
											<select
												name="severity"
												value={String(observation.severity)}
												class="border-input bg-background ring-offset-background focus-visible:ring-ring h-8 rounded-md border px-3 text-xs shadow-xs outline-none focus-visible:ring-2"
											>
												<option value="1">1</option>
												<option value="2">2</option>
												<option value="3">3</option>
												<option value="4">4</option>
												<option value="5">5</option>
											</select>
											<Input name="note" value={observation.note} class="h-8 text-xs" required />
											<Button
												type="submit"
												variant="outline"
												size="sm"
												disabled={activeAction === `update-observation-${observation.id}`}
											>
												{#if activeAction === `update-observation-${observation.id}`}
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
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Therapist conversations</Card.Title>
				<Card.Description>Coordinate directly with the human therapist about each patient.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.therapistConversations.length === 0}
					<p class="text-muted-foreground text-sm">
						No therapist threads are available yet for your linked patients.
					</p>
				{:else}
					{#each data.therapistConversations as conversation (conversation.patientId + conversation.therapistId)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-medium">{conversation.patientName}</p>
									<p class="text-muted-foreground text-xs">
										With {conversation.therapistName} · {conversation.therapistEmail}
									</p>
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
										Start the first therapist update for this patient.
									</p>
								{:else}
									{#each conversation.messages as message (message.id)}
										<div
											class={`rounded-md px-3 py-2 text-sm ${message.role === 'associate' ? 'ml-auto max-w-[90%] bg-blue-600 text-white' : 'max-w-[90%] bg-slate-100 text-slate-900'}`}
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
								use:pendingForm={`send-therapist-message-${conversation.patientId}-${conversation.therapistId}`}
							>
								<input type="hidden" name="patientId" value={conversation.patientId} />
								<input type="hidden" name="therapistId" value={conversation.therapistId} />
								<div class="grid gap-2">
									<Label for={`therapist-message-${conversation.patientId}-${conversation.therapistId}`}>
										Message
									</Label>
									<Textarea
										id={`therapist-message-${conversation.patientId}-${conversation.therapistId}`}
										name="content"
										required
										placeholder="Share a concise update about sleep, daily habits, diet, mood, or any warning signs."
									/>
								</div>
								<Button
									type="submit"
									class="bg-blue-600 text-white hover:bg-blue-700"
									disabled={activeAction === `send-therapist-message-${conversation.patientId}-${conversation.therapistId}`}
								>
									{#if activeAction === `send-therapist-message-${conversation.patientId}-${conversation.therapistId}`}
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

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Badge class="w-fit bg-blue-100 text-blue-700 hover:bg-blue-100">AI therapist</Badge>
				<Card.Title>AI reporting assistant</Card.Title>
				<Card.Description>
					Turn daily habit updates into structured recovery notes before escalation is needed.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if aiError}
					<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{aiError}
					</div>
				{/if}
				{#if !data.aiFeatures.chatEnabled}
					<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
						Associate AI support chat is disabled right now.
					</div>
				{/if}
				{#each aiConversations as conversation (conversation.patientId)}
					<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
						<div class="flex items-start justify-between gap-3">
							<div>
								<p class="font-medium">{conversation.patientName}</p>
								<p class="text-muted-foreground text-xs">{conversation.patientEmail}</p>
							</div>
							{#if conversation.lastMessageAt}
								<Badge variant="outline">{formatDate(conversation.lastMessageAt)}</Badge>
							{:else}
								<Badge variant="secondary">No AI updates yet</Badge>
							{/if}
						</div>

						<div class="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-white p-3">
							{#if conversation.messages.length === 0}
								<p class="text-muted-foreground text-sm">
									Start by describing the patient’s sleep, diet, activity, behavior, or relapse concerns.
								</p>
							{:else}
								{#each conversation.messages as message (message.id)}
									<div
										class={`rounded-md px-3 py-2 text-sm ${message.role === 'associate' ? 'ml-auto max-w-[90%] bg-blue-600 text-white' : 'max-w-[90%] bg-slate-100 text-slate-900'}`}
									>
										<p class="text-xs opacity-70">
											{message.role === 'associate' ? 'You' : 'AI therapist'} · {formatDate(message.createdAt)}
										</p>
										<p class="whitespace-pre-wrap">{message.content}</p>
									</div>
								{/each}
							{/if}
						</div>

						<div class="grid gap-2">
							<Label for={`ai-note-${conversation.patientId}`}>Daily update</Label>
							<Textarea
								id={`ai-note-${conversation.patientId}`}
								bind:value={aiDraftByPatientId[conversation.patientId]}
								placeholder="Example: appetite dropped, slept 4 hours, skipped group meeting, became isolated after work."
							/>
						</div>
						<Button
							type="button"
							class="bg-blue-600 text-white hover:bg-blue-700"
							disabled={aiSendingPatientId === conversation.patientId || !data.aiFeatures.chatEnabled}
							onclick={() => sendAssociateAiMessage(conversation.patientId)}
						>
							{#if aiSendingPatientId === conversation.patientId}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Sending to AI...
							{:else}
								Send to AI therapist
							{/if}
						</Button>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	</section>
</div>
