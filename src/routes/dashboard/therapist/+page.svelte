<script lang="ts">
	import { enhance } from '$app/forms';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';

	type TherapistPageData = {
		caseload: Array<{
			patientId: string;
			patientName: string;
			patientEmail: string;
			latestRisk:
				| {
						tier: string;
						score: number;
						createdAt: Date;
				  }
				| undefined;
			openAlertCount: number;
		}>;
		openAlerts: Array<{
			id: string;
			patientId: string;
			patientName: string;
			status: string;
			level: string;
			reason: string;
			riskScore: number | null;
			createdAt: Date;
		}>;
		recentCheckins: Array<{
			id: string;
			patientName: string;
			mood: number;
			craving: number;
			stress: number;
			sleepHours: number;
			note: string | null;
			createdAt: Date;
		}>;
		recentObservations: Array<{
			id: string;
			patientName: string;
			associateName: string;
			category: string;
			severity: number;
			note: string;
			createdAt: Date;
		}>;
	};

	type TherapistPageForm = {
		message?: string;
		success?: string;
		mode?: string;
	} | null;

	let { data, form }: { data: TherapistPageData; form: TherapistPageForm } = $props();
	let activeAction = $state<string | null>(null);

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

	<section class="grid gap-4 sm:grid-cols-3">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Description>Assigned patients</Card.Description>
				<Card.Title class="text-3xl">{data.caseload.length}</Card.Title>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Description>Open alerts</Card.Description>
				<Card.Title class="text-3xl">{data.openAlerts.length}</Card.Title>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Description>Recent activity</Card.Description>
				<Card.Title class="text-3xl">{data.recentCheckins.length + data.recentObservations.length}</Card.Title>
			</Card.Header>
		</Card.Root>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Badge class="w-fit bg-blue-100 text-blue-700 hover:bg-blue-100">Therapist</Badge>
				<Card.Title>Assigned caseload</Card.Title>
				<Card.Description>Patients currently assigned to your workspace.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Latest risk</Table.Head>
								<Table.Head>Open alerts</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.caseload.length === 0}
								<Table.Row>
									<Table.Cell colspan={3} class="text-muted-foreground py-6 text-center">
										No assigned patients yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.caseload as patient (patient.patientId)}
									<Table.Row>
										<Table.Cell>
											<div class="font-medium">{patient.patientName}</div>
											<div class="text-muted-foreground text-xs">{patient.patientEmail}</div>
										</Table.Cell>
										<Table.Cell>
											{#if patient.latestRisk}
												<Badge class={tierBadgeClass(patient.latestRisk.tier)}>
													{patient.latestRisk.tier} ({patient.latestRisk.score})
												</Badge>
											{:else}
												<Badge variant="secondary">No data</Badge>
											{/if}
										</Table.Cell>
										<Table.Cell>{patient.openAlertCount}</Table.Cell>
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
				<Card.Title>Alert queue</Card.Title>
				<Card.Description>Acknowledge and resolve active high-risk events.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.openAlerts.length === 0}
					<p class="text-muted-foreground text-sm">No open alerts right now.</p>
				{:else}
					{#each data.openAlerts as alert (alert.id)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/70 p-4">
							<div class="flex items-center justify-between gap-2">
								<div>
									<p class="font-medium">{alert.patientName}</p>
									<p class="text-muted-foreground text-xs">{formatDate(alert.createdAt)}</p>
								</div>
								<div class="flex items-center gap-2">
									<Badge class={tierBadgeClass(alert.level)}>{alert.level}</Badge>
									<Badge variant="outline">{alert.status}</Badge>
								</div>
							</div>
							<p class="text-sm">{alert.reason}</p>
							{#if alert.riskScore !== null}
								<p class="text-muted-foreground text-xs">Risk score at trigger: {alert.riskScore}</p>
							{/if}
							<div class="grid gap-2 md:grid-cols-[auto_1fr_auto]">
							<form
								method="POST"
								action="?/acknowledgeAlert"
								use:pendingForm={`acknowledge-alert-${alert.id}`}
							>
								<input type="hidden" name="alertId" value={alert.id} />
								<Button
									type="submit"
									variant="outline"
									class="border-blue-200 text-blue-700 hover:bg-blue-50"
									disabled={activeAction === `acknowledge-alert-${alert.id}`}
								>
									{#if activeAction === `acknowledge-alert-${alert.id}`}
										<LoaderCircleIcon class="size-4 animate-spin" />
									{:else}
										Acknowledge
									{/if}
								</Button>
							</form>
							<form
								method="POST"
								action="?/resolveAlert"
								class="contents"
								use:pendingForm={`resolve-alert-${alert.id}`}
							>
								<input type="hidden" name="alertId" value={alert.id} />
								<Input name="resolutionNote" placeholder="Intervention note" required />
								<Button
									type="submit"
									class="bg-blue-600 text-white hover:bg-blue-700"
									disabled={activeAction === `resolve-alert-${alert.id}`}
								>
									{#if activeAction === `resolve-alert-${alert.id}`}
										<LoaderCircleIcon class="size-4 animate-spin" />
									{:else}
										Resolve
									{/if}
								</Button>
							</form>
						</div>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Recent check-ins</Card.Title>
				<Card.Description>Latest self-reported updates from your caseload.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Mood</Table.Head>
								<Table.Head>Craving</Table.Head>
								<Table.Head>Stress</Table.Head>
								<Table.Head>Sleep</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.recentCheckins.length === 0}
								<Table.Row>
									<Table.Cell colspan={5} class="text-muted-foreground py-6 text-center">
										No recent check-ins.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.recentCheckins as checkin (checkin.id)}
									<Table.Row>
										<Table.Cell>
											<div class="font-medium">{checkin.patientName}</div>
											<div class="text-muted-foreground text-xs">{formatDate(checkin.createdAt)}</div>
										</Table.Cell>
										<Table.Cell>{checkin.mood}</Table.Cell>
										<Table.Cell>{checkin.craving}</Table.Cell>
										<Table.Cell>{checkin.stress}</Table.Cell>
										<Table.Cell>{checkin.sleepHours}h</Table.Cell>
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
				<Card.Title>Recent associate logs</Card.Title>
				<Card.Description>Family/support-network updates tied to your caseload.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Associate</Table.Head>
								<Table.Head>Category</Table.Head>
								<Table.Head>Severity</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.recentObservations.length === 0}
								<Table.Row>
									<Table.Cell colspan={4} class="text-muted-foreground py-6 text-center">
										No recent associate logs.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.recentObservations as observation (observation.id)}
									<Table.Row>
										<Table.Cell>
											<div class="font-medium">{observation.patientName}</div>
											<div class="text-muted-foreground text-xs">{formatDate(observation.createdAt)}</div>
										</Table.Cell>
										<Table.Cell>{observation.associateName}</Table.Cell>
										<Table.Cell>{observation.category.replaceAll('_', ' ')}</Table.Cell>
										<Table.Cell>{observation.severity}</Table.Cell>
									</Table.Row>
								{/each}
							{/if}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	</section>
</div>
