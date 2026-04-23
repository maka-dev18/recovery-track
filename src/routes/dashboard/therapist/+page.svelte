<script lang="ts">
	import { enhance } from '$app/forms';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import TrendChart from '$lib/components/recovery/trend-chart.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';

	type RelapsePredictionDriver = {
		source: 'selfReport' | 'associate' | 'careTeam' | 'history' | 'engagementSignals';
		label: string;
		points: number;
		evidence: string;
		occurredAt: Date | null;
	};

	type RelapsePredictionView = {
		patientId: string;
		patientName: string;
		patientEmail: string;
		likelihoodPercent: number;
		tier: string;
		flagged: boolean;
		trend: 'rising' | 'falling' | 'steady';
		confidence: number;
		topDrivers: RelapsePredictionDriver[];
		drivers: Record<RelapsePredictionDriver['source'], RelapsePredictionDriver[]>;
		sourceCoverage: {
			riskScores: number;
			checkins: number;
			associateObservations: number;
			aiRiskSignals: number;
			clinicalSignals: number;
			historySignals: number;
			therapySessions: number;
			noShowSessions: number;
			openAlerts: number;
		};
		latestRiskScore: number | null;
		latestRiskTier: string | null;
		generatedAt: Date;
	};

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
			relapsePrediction: RelapsePredictionView | null;
		}>;
		openAlerts: Array<{
			id: string;
			patientId: string;
			patientName: string;
			status: string;
			level: string;
			reason: string;
			riskScore: number | null;
			riskFactors: Array<{
				label: string;
				points: number;
			}>;
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
		chatConversations: Array<{
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
		therapySessions: Array<{
			id: string;
			patientId: string;
			patientName: string;
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
		associateConversations: Array<{
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
		patientReports: Array<{
			patientId: string;
			patientName: string;
			patientEmail: string;
			riskTier: string | null;
			riskScore: number | null;
			riskTrend: 'rising' | 'falling' | 'steady';
			riskSeries: Array<{ label: string; value: number }>;
			moodSeries: Array<{ label: string; value: number }>;
			cravingSeries: Array<{ label: string; value: number }>;
			stressSeries: Array<{ label: string; value: number }>;
			observationSeries: Array<{ label: string; value: number }>;
			sessionCompletionRate: number;
			recentSignalCount: number;
			warningPatterns: string[];
			narrative: string;
			recoveryStage: string | null;
			goals: string[];
			relapsePrediction: RelapsePredictionView | null;
		}>;
		relapsePredictions: RelapsePredictionView[];
		relapseWatchlist: RelapsePredictionView[];
		recentSignals: Array<{
			id: string;
			patientId: string;
			patientName: string;
			source: string;
			signalType: string;
			status: string;
			severity: number;
			confidence: number;
			summary: string;
			occurredAt: Date;
			detectedBy: string;
		}>;
		therapySessionModeValues: string[];
		therapySessionStatusValues: string[];
		therapySessionRiskLevelValues: string[];
	};

	type TherapistPageForm = {
		message?: string;
		success?: string;
		mode?: string;
	} | null;

	type TherapistView = 'overview' | 'reports' | 'followups' | 'caseload' | 'care';
	let {
		data,
		form,
		initialView = 'overview'
	}: { data: TherapistPageData; form: TherapistPageForm; initialView?: TherapistView } = $props();
	let activeView = $derived(initialView);
	let activeAction = $state<string | null>(null);
	let selectedReportPatientId = $state<string | null>(null);
	let predictionExplanation = $state<{
		patientId: string;
		summary: string;
		keyEvidence: string[];
		recommendedActions: string[];
		limitations: string;
		generatedBy: string;
	} | null>(null);
	let predictionExplanationError = $state<string | null>(null);
	let explainingPredictionPatientId = $state<string | null>(null);

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

	function predictionBarClass(tier: string | null | undefined) {
		if (tier === 'critical') return 'bg-red-600';
		if (tier === 'high') return 'bg-orange-500';
		if (tier === 'moderate') return 'bg-amber-400';
		return 'bg-blue-500';
	}

	function formatDateTimeInput(value: Date | string | null) {
		if (!value) return '';
		const date = typeof value === 'string' ? new Date(value) : value;
		const pad = (input: number) => `${input}`.padStart(2, '0');

		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function formatList(values: string[]) {
		return values.join(', ');
	}

	function modeLabel(value: string | null | undefined) {
		return value ? value.replaceAll('_', ' ') : 'session';
	}

	function formatPercent(value: number) {
		return `${Math.round(value * 100)}%`;
	}

	function selectedReport() {
		if (!selectedReportPatientId) {
			return data.patientReports[0] ?? null;
		}

		return data.patientReports.find((report) => report.patientId === selectedReportPatientId) ?? null;
	}

	function selectedPrediction() {
		return selectedReport()?.relapsePrediction ?? null;
	}

	function sourceLabel(source: RelapsePredictionDriver['source']) {
		if (source === 'selfReport') return 'Patient self-report';
		if (source === 'associate') return 'Associate reports';
		if (source === 'careTeam') return 'Therapist and care team';
		if (source === 'history') return 'Historical rehab records';
		return 'Risk alerts and signals';
	}

	function predictionDriverGroups(prediction: RelapsePredictionView | null) {
		if (!prediction) return [];
		const sources: Array<RelapsePredictionDriver['source']> = [
			'selfReport',
			'associate',
			'careTeam',
			'history',
			'engagementSignals'
		];

		return sources.map((source) => ({
			source,
			label: sourceLabel(source),
			drivers: prediction.drivers[source] ?? []
		}));
	}

	function highestPrediction() {
		return data.relapsePredictions.reduce<RelapsePredictionView | null>((highest, prediction) => {
			if (!highest || prediction.likelihoodPercent > highest.likelihoodPercent) {
				return prediction;
			}

			return highest;
		}, null);
	}

	async function generatePredictionExplanation(patientId: string) {
		predictionExplanationError = null;
		explainingPredictionPatientId = patientId;

		try {
			const response = await fetch(`/api/therapist/patients/${patientId}/relapse-prediction/explain`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' }
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.message ?? 'Unable to generate explanation.');
			}

			predictionExplanation = {
				patientId,
				...payload.explanation,
				generatedBy: payload.generatedBy ?? 'ai'
			};
		} catch (error) {
			predictionExplanationError =
				error instanceof Error ? error.message : 'Unable to generate explanation.';
		} finally {
			explainingPredictionPatientId = null;
		}
	}

	$effect(() => {
		if (!selectedReportPatientId && data.patientReports.length > 0) {
			selectedReportPatientId = data.patientReports[0].patientId;
		}
	});

	const flaggedPredictionCount = $derived(
		data.relapsePredictions.filter((prediction) => prediction.flagged).length
	);
	const risingPredictionCount = $derived(
		data.relapsePredictions.filter((prediction) => prediction.trend === 'rising').length
	);
	const highestRelapsePrediction = $derived(highestPrediction());
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
				<h1 class="text-2xl font-semibold">Care team dashboard</h1>
			</div>
			<div class="grid gap-2 sm:grid-cols-3 lg:min-w-[28rem]">
				<div class="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
					<p class="text-xs text-emerald-700">Patients</p>
					<p class="font-semibold text-emerald-950">{data.caseload.length}</p>
				</div>
				<div class="rounded-md border border-red-100 bg-red-50 px-3 py-2">
					<p class="text-xs text-red-700">Open alerts</p>
					<p class="font-semibold text-red-950">{data.openAlerts.length}</p>
				</div>
				<div class="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2">
					<p class="text-xs text-cyan-700">Upcoming</p>
					<p class="font-semibold text-cyan-950">{data.upcomingSessions.length}</p>
				</div>
			</div>
		</div>
	</section>

	{#if activeView === 'overview'}
	<section class="grid gap-4 sm:grid-cols-3">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Assigned patients</Card.Title>
				<p class="text-3xl font-semibold">{data.caseload.length}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Open alerts</Card.Title>
				<p class="text-3xl font-semibold">{data.openAlerts.length}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Recent activity</Card.Title>
				<p class="text-3xl font-semibold">{data.recentCheckins.length + data.recentObservations.length}</p>
			</Card.Header>
		</Card.Root>
	</section>

	<section class="grid gap-4 sm:grid-cols-3">
		<Card.Root class="border-amber-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Flagged 7-day relapse predictions</Card.Title>
				<p class="text-3xl font-semibold">{flaggedPredictionCount}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-amber-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Highest likelihood</Card.Title>
				<p class="text-3xl font-semibold">
					{highestRelapsePrediction ? `${highestRelapsePrediction.likelihoodPercent}%` : '—'}
				</p>
				{#if highestRelapsePrediction}
					<p class="text-muted-foreground text-xs">{highestRelapsePrediction.patientName}</p>
				{/if}
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-amber-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Rising predictions</Card.Title>
				<p class="text-3xl font-semibold">{risingPredictionCount}</p>
			</Card.Header>
		</Card.Root>
	</section>

	<section>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>7-day relapse watchlist</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if data.relapseWatchlist.length === 0}
					<p class="text-muted-foreground text-sm">No patients are currently flagged above the 40% threshold.</p>
				{:else}
					{#each data.relapseWatchlist as prediction (prediction.patientId)}
						<div class="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
								<div>
									<div class="flex flex-wrap items-center gap-2">
										<p class="font-medium">{prediction.patientName}</p>
										<Badge class={tierBadgeClass(prediction.tier)}>{prediction.tier}</Badge>
										<Badge variant="outline">{prediction.trend}</Badge>
										{#if prediction.sourceCoverage.openAlerts > 0}
											<Badge class="bg-red-50 text-red-700 hover:bg-red-50">Open alert</Badge>
										{/if}
									</div>
									<p class="text-muted-foreground mt-1 text-xs">
										Confidence {prediction.confidence}% · Generated {formatDate(prediction.generatedAt)}
									</p>
								</div>
								<div class="min-w-32 text-right">
									<p class="text-2xl font-semibold">{prediction.likelihoodPercent}%</p>
									<p class="text-muted-foreground text-xs">7-day likelihood</p>
								</div>
							</div>
							<div class="mt-3 h-2 rounded-full bg-white">
								<div
									class={`h-2 rounded-full ${predictionBarClass(prediction.tier)}`}
									style={`width: ${prediction.likelihoodPercent}%`}
								></div>
							</div>
							<div class="mt-3 flex flex-wrap gap-2">
								{#each prediction.topDrivers.slice(0, 2) as driver (driver.source + driver.label)}
									<Badge variant="outline" class="bg-white">
										{driver.label} +{driver.points}
									</Badge>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === 'reports'}
	<section>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Therapist reports</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-6">
				{#if data.patientReports.length === 0}
					<p class="text-muted-foreground text-sm">
						No patient reports are available until your caseload has check-ins, signals, or session history.
					</p>
				{:else}
					<div class="grid gap-2 md:max-w-sm">
						<Label for="report-patient">Patient report</Label>
						<select
							id="report-patient"
							bind:value={selectedReportPatientId}
							class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
						>
							{#each data.patientReports as report (report.patientId)}
								<option value={report.patientId}>{report.patientName}</option>
							{/each}
						</select>
					</div>

					{#if selectedReport()}
						{#if selectedPrediction()}
							<div class="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
								<div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
									<div>
										<div class="flex flex-wrap items-center gap-2">
											<p class="text-sm font-medium">7-day relapse prediction</p>
											<Badge class={tierBadgeClass(selectedPrediction()!.tier)}>
												{selectedPrediction()!.tier}
											</Badge>
											<Badge variant="outline">{selectedPrediction()!.trend}</Badge>
										</div>
										<p class="text-muted-foreground mt-2 text-sm">
											Confidence {selectedPrediction()!.confidence}% · Based on current risk data, check-ins, care-team signals, and history.
										</p>
									</div>
									<div class="text-right">
										<p class="text-4xl font-semibold">{selectedPrediction()!.likelihoodPercent}%</p>
										<p class="text-muted-foreground text-xs">likelihood in the next 7 days</p>
									</div>
								</div>
								<div class="mt-4 h-2 rounded-full bg-white">
									<div
										class={`h-2 rounded-full ${predictionBarClass(selectedPrediction()!.tier)}`}
										style={`width: ${selectedPrediction()!.likelihoodPercent}%`}
									></div>
								</div>
								<div class="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
									<div class="flex flex-wrap gap-2">
										{#if selectedPrediction()!.topDrivers.length === 0}
											<Badge variant="secondary">No major drivers identified</Badge>
										{:else}
											{#each selectedPrediction()!.topDrivers.slice(0, 4) as driver (driver.source + driver.label)}
												<Badge variant="outline" class="bg-white">
													{driver.label} +{driver.points}
												</Badge>
											{/each}
										{/if}
									</div>
									<Button
										type="button"
										variant="outline"
										class="border-blue-200 text-blue-700 hover:bg-blue-50"
										disabled={explainingPredictionPatientId === selectedPrediction()!.patientId}
										onclick={() => generatePredictionExplanation(selectedPrediction()!.patientId)}
									>
										{#if explainingPredictionPatientId === selectedPrediction()!.patientId}
											<LoaderCircleIcon class="size-4 animate-spin" />
										{:else}
											Generate AI explanation
										{/if}
									</Button>
								</div>
								{#if predictionExplanationError}
									<p class="text-destructive mt-3 text-sm">{predictionExplanationError}</p>
								{/if}
								{#if predictionExplanation?.patientId === selectedPrediction()!.patientId}
									<div class="mt-4 grid gap-3 rounded-md border border-blue-100 bg-white p-3 text-sm">
										<p>{predictionExplanation.summary}</p>
										<div>
											<p class="font-medium">Key evidence</p>
											<ul class="mt-1 list-disc space-y-1 pl-5">
												{#each predictionExplanation.keyEvidence as item (item)}
													<li>{item}</li>
												{/each}
											</ul>
										</div>
										<div>
											<p class="font-medium">Recommended actions</p>
											<ul class="mt-1 list-disc space-y-1 pl-5">
												{#each predictionExplanation.recommendedActions as item (item)}
													<li>{item}</li>
												{/each}
											</ul>
										</div>
										<p class="text-muted-foreground text-xs">{predictionExplanation.limitations}</p>
										{#if predictionExplanation.generatedBy !== 'ai'}
											<Badge variant="outline" class="w-fit bg-amber-50 text-amber-800">
												Generated from deterministic prediction data
											</Badge>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
						<div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
							<div class="space-y-4">
								<div class="grid gap-4 md:grid-cols-4">
									<div class="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
										<p class="text-muted-foreground text-xs">Risk tier</p>
										<p class="mt-1 font-semibold">{selectedReport()!.riskTier ?? 'No data'}</p>
									</div>
									<div class="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
										<p class="text-muted-foreground text-xs">Risk score</p>
										<p class="mt-1 font-semibold">{selectedReport()!.riskScore ?? '—'}</p>
									</div>
									<div class="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
										<p class="text-muted-foreground text-xs">Trend</p>
										<p class="mt-1 font-semibold">{selectedReport()!.riskTrend}</p>
									</div>
									<div class="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
										<p class="text-muted-foreground text-xs">Session completion</p>
										<p class="mt-1 font-semibold">{formatPercent(selectedReport()!.sessionCompletionRate)}</p>
									</div>
								</div>

								<div class="grid gap-4 md:grid-cols-2">
									<div class="rounded-lg border border-blue-100 bg-white p-4">
										<p class="mb-3 text-sm font-medium">Risk trend</p>
										<TrendChart data={selectedReport()!.riskSeries} />
									</div>
									<div class="rounded-lg border border-blue-100 bg-white p-4">
										<p class="mb-3 text-sm font-medium">Craving trend</p>
										<TrendChart
											data={selectedReport()!.cravingSeries}
											stroke="#ea580c"
											fill="rgba(234, 88, 12, 0.12)"
										/>
									</div>
									<div class="rounded-lg border border-blue-100 bg-white p-4">
										<p class="mb-3 text-sm font-medium">Stress trend</p>
										<TrendChart
											data={selectedReport()!.stressSeries}
											stroke="#dc2626"
											fill="rgba(220, 38, 38, 0.12)"
										/>
									</div>
									<div class="rounded-lg border border-blue-100 bg-white p-4">
										<p class="mb-3 text-sm font-medium">Observation severity</p>
										<TrendChart
											data={selectedReport()!.observationSeries}
											stroke="#0f766e"
											fill="rgba(15, 118, 110, 0.12)"
										/>
									</div>
								</div>
							</div>

							<div class="space-y-4">
								<div class="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
									<p class="text-sm font-medium">Generated narrative</p>
									<p class="mt-2 text-sm leading-6">{selectedReport()!.narrative}</p>
								</div>

								<div class="rounded-lg border border-blue-100 bg-white p-4">
									<p class="text-sm font-medium">Warning patterns</p>
									<div class="mt-3 space-y-2">
										{#each selectedReport()!.warningPatterns as pattern (pattern)}
											<div class="rounded-md bg-blue-50 px-3 py-2 text-sm">{pattern}</div>
										{/each}
									</div>
								</div>

								{#if selectedPrediction()}
									<div class="rounded-lg border border-blue-100 bg-white p-4">
										<p class="text-sm font-medium">Prediction evidence by source</p>
										<div class="mt-3 space-y-3">
											{#each predictionDriverGroups(selectedPrediction()) as group (group.source)}
												<div class="rounded-md bg-blue-50 px-3 py-2">
													<div class="flex items-center justify-between gap-2">
														<p class="text-sm font-medium">{group.label}</p>
														<Badge variant="outline" class="bg-white">{group.drivers.length}</Badge>
													</div>
													{#if group.drivers.length === 0}
														<p class="text-muted-foreground mt-1 text-xs">No current driver from this source.</p>
													{:else}
														<div class="mt-2 space-y-2">
															{#each group.drivers as driver (driver.label + driver.evidence)}
																<div class="rounded bg-white px-2 py-2 text-xs">
																	<p class="font-medium">{driver.label} +{driver.points}</p>
																	<p class="text-muted-foreground mt-1">{driver.evidence}</p>
																</div>
															{/each}
														</div>
													{/if}
												</div>
											{/each}
										</div>
									</div>
								{/if}

								<div class="rounded-lg border border-blue-100 bg-white p-4">
									<p class="text-sm font-medium">Recovery stage and goals</p>
									<p class="text-muted-foreground mt-2 text-xs">
										Stage: {selectedReport()!.recoveryStage ?? 'active recovery'}
									</p>
									<div class="mt-3 flex flex-wrap gap-2">
										{#if selectedReport()!.goals.length === 0}
											<Badge variant="secondary">No explicit goals yet</Badge>
										{:else}
											{#each selectedReport()!.goals as goal (goal)}
												<Badge variant="outline">{goal}</Badge>
											{/each}
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === 'followups'}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Calendar and follow-ups</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.upcomingSessions.length === 0}
					<p class="text-muted-foreground text-sm">No upcoming sessions are on your calendar.</p>
				{:else}
					{#each data.upcomingSessions as session (session.id)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-medium">{session.patientName}</p>
									<p class="text-muted-foreground text-xs">
										{session.sessionAt ? formatDate(session.sessionAt) : 'Time pending'} · {modeLabel(session.mode)}
									</p>
								</div>
								<div class="flex items-center gap-2">
									<Badge variant="outline">{session.status}</Badge>
									{#if session.requiresConfirmation}
										<Badge class="bg-amber-100 text-amber-900 hover:bg-amber-100">Needs confirmation</Badge>
									{/if}
								</div>
							</div>
							<p class="text-sm">{session.summary}</p>
							{#if session.automationReason}
								<p class="text-muted-foreground text-xs">{session.automationReason}</p>
							{/if}
							<div class="grid gap-2 md:grid-cols-[1fr_auto_auto]">
								<form
									method="POST"
									action="?/rescheduleSession"
									class="contents"
									use:pendingForm={`reschedule-session-${session.id}`}
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
										disabled={activeAction === `reschedule-session-${session.id}`}
									>
										{#if activeAction === `reschedule-session-${session.id}`}
											<LoaderCircleIcon class="size-4 animate-spin" />
										{:else}
											Reschedule
										{/if}
									</Button>
								</form>
								{#if session.requiresConfirmation}
									<form
										method="POST"
										action="?/confirmSuggestedSession"
										use:pendingForm={`confirm-suggested-session-${session.id}`}
									>
										<input type="hidden" name="sessionId" value={session.id} />
										<input type="hidden" name="sessionAt" value={formatDateTimeInput(session.sessionAt)} />
										<Button
											type="submit"
											class="bg-blue-600 text-white hover:bg-blue-700"
											disabled={activeAction === `confirm-suggested-session-${session.id}`}
										>
											{#if activeAction === `confirm-suggested-session-${session.id}`}
												<LoaderCircleIcon class="size-4 animate-spin" />
											{:else}
												Confirm
											{/if}
										</Button>
									</form>
								{:else if session.meetingUrl}
									{#if session.mode === 'video' || session.mode === 'phone'}
										<Button
											type="button"
											class="bg-blue-600 text-white hover:bg-blue-700"
											onclick={() => (window.location.href = session.meetingUrl!)}
										>
											Join call
										</Button>
									{/if}
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Clinical signal feed</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if data.recentSignals.length === 0}
					<p class="text-muted-foreground text-sm">No recent clinical signals were captured.</p>
				{:else}
					{#each data.recentSignals.slice(0, 8) as signal (signal.id)}
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
								{signal.patientName} · Severity {signal.severity} · Confidence {signal.confidence} · Detected by {signal.detectedBy}
							</p>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === 'caseload'}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Badge class="w-fit bg-blue-100 text-blue-700 hover:bg-blue-100">Therapist</Badge>
				<Card.Title>Assigned caseload</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>7-day likelihood</Table.Head>
								<Table.Head>Latest risk</Table.Head>
								<Table.Head>Open alerts</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.caseload.length === 0}
								<Table.Row>
									<Table.Cell colspan={4} class="text-muted-foreground py-6 text-center">
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
											{#if patient.relapsePrediction}
												<div class="flex flex-col gap-1">
													<Badge class={tierBadgeClass(patient.relapsePrediction.tier)}>
														{patient.relapsePrediction.likelihoodPercent}%
													</Badge>
													<span class="text-muted-foreground text-xs">
														{patient.relapsePrediction.trend} · confidence {patient.relapsePrediction.confidence}%
													</span>
												</div>
											{:else}
												<Badge variant="secondary">No data</Badge>
											{/if}
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
							{#if alert.riskFactors.length > 0}
								<div class="flex flex-wrap gap-2">
									{#each alert.riskFactors as factor (factor.label)}
										<Badge variant="outline" class="bg-white">
											{factor.label} +{factor.points}
										</Badge>
									{/each}
								</div>
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

	{:else if activeView === 'care'}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Therapist-patient messaging</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.chatConversations.length === 0}
					<p class="text-muted-foreground text-sm">
						No assigned patients are available for direct messaging yet.
					</p>
				{:else}
					{#each data.chatConversations as conversation (conversation.patientId)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-medium">{conversation.patientName}</p>
									<p class="text-muted-foreground text-xs">{conversation.patientEmail}</p>
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
										Start the first outreach message for this patient.
									</p>
								{:else}
									{#each conversation.messages as message (message.id)}
										<div
											class={`rounded-md px-3 py-2 text-sm ${message.role === 'therapist' ? 'ml-auto max-w-[90%] bg-blue-600 text-white' : 'max-w-[90%] bg-slate-100 text-slate-900'}`}
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
								action="?/sendMessage"
								class="space-y-3"
								use:pendingForm={`send-message-${conversation.patientId}`}
							>
								<input type="hidden" name="patientId" value={conversation.patientId} />
								<div class="grid gap-2">
									<Label for={`message-${conversation.patientId}`}>Reply</Label>
									<Textarea
										id={`message-${conversation.patientId}`}
										name="content"
										required
										placeholder="Share a quick follow-up or care instruction."
									/>
								</div>
								<Button
									type="submit"
									class="bg-blue-600 text-white hover:bg-blue-700"
									disabled={activeAction === `send-message-${conversation.patientId}`}
								>
									{#if activeAction === `send-message-${conversation.patientId}`}
										<LoaderCircleIcon class="size-4 animate-spin" />
										Sending...
									{:else}
										Send message
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
				<Card.Title>Create session note</Card.Title>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/saveSessionNote"
					class="grid gap-4"
					use:pendingForm={'save-session-note-new'}
				>
					<div class="grid gap-4 md:grid-cols-2">
						<div class="grid gap-2">
							<Label for="session-patient-id">Patient</Label>
							<select
								id="session-patient-id"
								name="patientId"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Select patient</option>
								{#each data.caseload as patient (patient.patientId)}
									<option value={patient.patientId}>{patient.patientName}</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="session-at">Session time</Label>
							<Input id="session-at" name="sessionAt" type="datetime-local" />
						</div>
					</div>
					<div class="grid gap-4 md:grid-cols-2">
						<div class="grid gap-2">
							<Label for="session-mode">Mode</Label>
							<select
								id="session-mode"
								name="sessionMode"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								{#each data.therapySessionModeValues as mode (mode)}
									<option value={mode}>{mode.replaceAll('_', ' ')}</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="session-status">Status</Label>
							<select
								id="session-status"
								name="sessionStatus"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								{#each data.therapySessionStatusValues as status (status)}
									<option value={status} selected={status === 'completed'}>
										{status.replaceAll('_', ' ')}
									</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="session-summary">Summary</Label>
						<Textarea
							id="session-summary"
							name="summary"
							required
							placeholder="High-level summary of what happened in the session."
						/>
					</div>
					<div class="grid gap-2">
						<Label for="presentation">Presentation</Label>
						<Textarea
							id="presentation"
							name="presentation"
							placeholder="Symptoms, mood, attendance, and notable presentation."
						/>
					</div>
					<div class="grid gap-4 md:grid-cols-2">
						<div class="grid gap-2">
							<Label for="interventions">Interventions</Label>
							<Input
								id="interventions"
								name="interventions"
								placeholder="CBT reframing, relapse planning, grounding"
							/>
						</div>
						<div class="grid gap-2">
							<Label for="homework">Homework</Label>
							<Input
								id="homework"
								name="homework"
								placeholder="Daily check-in, support meeting, journal"
							/>
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="response">Patient response</Label>
						<Textarea
							id="response"
							name="response"
							placeholder="How the patient engaged and responded to interventions."
						/>
					</div>
					<div class="grid gap-4 md:grid-cols-[1fr_2fr]">
						<div class="grid gap-2">
							<Label for="risk-level">Risk level</Label>
							<select
								id="risk-level"
								name="riskLevel"
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Not set</option>
								{#each data.therapySessionRiskLevelValues as riskLevel (riskLevel)}
									<option value={riskLevel}>{riskLevel}</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="next-steps">Next steps</Label>
							<Textarea
								id="next-steps"
								name="nextSteps"
								placeholder="Follow-up plan, referrals, or outreach steps."
							/>
						</div>
					</div>
					<Button
						type="submit"
						class="bg-blue-600 text-white hover:bg-blue-700"
						disabled={activeAction === 'save-session-note-new'}
					>
						{#if activeAction === 'save-session-note-new'}
							<LoaderCircleIcon class="size-4 animate-spin" />
							Saving...
						{:else}
							Save session note
						{/if}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</section>

	<section>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Therapist-associate messaging</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.associateConversations.length === 0}
					<p class="text-muted-foreground text-sm">
						No associate threads are available for your current caseload.
					</p>
				{:else}
					{#each data.associateConversations as conversation (conversation.patientId + conversation.associateId)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-medium">{conversation.patientName}</p>
									<p class="text-muted-foreground text-xs">
										Associate: {conversation.associateName} · {conversation.associateEmail}
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
										Start the first coordination note for this patient.
									</p>
								{:else}
									{#each conversation.messages as message (message.id)}
										<div
											class={`rounded-md px-3 py-2 text-sm ${message.role === 'therapist' ? 'ml-auto max-w-[90%] bg-blue-600 text-white' : 'max-w-[90%] bg-slate-100 text-slate-900'}`}
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
								action="?/sendAssociateMessage"
								class="space-y-3"
								use:pendingForm={`send-associate-message-${conversation.patientId}-${conversation.associateId}`}
							>
								<input type="hidden" name="patientId" value={conversation.patientId} />
								<input type="hidden" name="associateId" value={conversation.associateId} />
								<div class="grid gap-2">
									<Label for={`associate-message-${conversation.patientId}-${conversation.associateId}`}>
										Message
									</Label>
									<Textarea
										id={`associate-message-${conversation.patientId}-${conversation.associateId}`}
										name="content"
										required
										placeholder="Ask for a quick update on sleep, diet, mood, routine, attendance, or relapse warning signs."
									/>
								</div>
								<Button
									type="submit"
									class="bg-blue-600 text-white hover:bg-blue-700"
									disabled={activeAction === `send-associate-message-${conversation.patientId}-${conversation.associateId}`}
								>
									{#if activeAction === `send-associate-message-${conversation.patientId}-${conversation.associateId}`}
										<LoaderCircleIcon class="size-4 animate-spin" />
										Sending...
									{:else}
										Send to associate
									{/if}
								</Button>
							</form>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	<section>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Recent therapy notes</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.therapySessions.length === 0}
					<p class="text-muted-foreground text-sm">
						No therapy session notes recorded yet.
					</p>
				{:else}
					{#each data.therapySessions as session (session.id)}
						<form
							method="POST"
							action="?/saveSessionNote"
							class="space-y-4 rounded-lg border border-blue-100 bg-blue-50/40 p-4"
							use:pendingForm={`save-session-note-${session.id}`}
						>
							<input type="hidden" name="sessionId" value={session.id} />
							<input type="hidden" name="patientId" value={session.patientId} />
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div>
									<p class="font-medium">{session.patientName}</p>
									<p class="text-muted-foreground text-xs">
										Updated {formatDate(session.updatedAt)}
									</p>
								</div>
								<div class="flex items-center gap-2">
									<Badge variant="outline">{session.status.replaceAll('_', ' ')}</Badge>
									<Badge variant="outline">{session.mode.replaceAll('_', ' ')}</Badge>
									{#if session.notes.riskLevel}
										<Badge class={tierBadgeClass(session.notes.riskLevel)}>
											{session.notes.riskLevel}
										</Badge>
									{/if}
								</div>
							</div>
							<div class="grid gap-4 md:grid-cols-3">
								<div class="grid gap-2">
									<Label for={`session-at-${session.id}`}>Session time</Label>
									<Input
										id={`session-at-${session.id}`}
										name="sessionAt"
										type="datetime-local"
										value={formatDateTimeInput(session.sessionAt)}
									/>
								</div>
								<div class="grid gap-2">
									<Label for={`session-mode-${session.id}`}>Mode</Label>
									<select
										id={`session-mode-${session.id}`}
										name="sessionMode"
										class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
									>
										{#each data.therapySessionModeValues as mode (mode)}
											<option value={mode} selected={mode === session.mode}>
												{mode.replaceAll('_', ' ')}
											</option>
										{/each}
									</select>
								</div>
								<div class="grid gap-2">
									<Label for={`session-status-${session.id}`}>Status</Label>
									<select
										id={`session-status-${session.id}`}
										name="sessionStatus"
										class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
									>
										{#each data.therapySessionStatusValues as status (status)}
											<option value={status} selected={status === session.status}>
												{status.replaceAll('_', ' ')}
											</option>
										{/each}
									</select>
								</div>
							</div>
							<div class="grid gap-2">
								<Label for={`summary-${session.id}`}>Summary</Label>
								<Textarea
									id={`summary-${session.id}`}
									name="summary"
									required
									value={session.summary}
								/>
							</div>
							<div class="grid gap-2">
								<Label for={`presentation-${session.id}`}>Presentation</Label>
								<Textarea
									id={`presentation-${session.id}`}
									name="presentation"
									value={session.notes.presentation}
								/>
							</div>
							<div class="grid gap-4 md:grid-cols-2">
								<div class="grid gap-2">
									<Label for={`interventions-${session.id}`}>Interventions</Label>
									<Input
										id={`interventions-${session.id}`}
										name="interventions"
										value={formatList(session.notes.interventions)}
									/>
								</div>
								<div class="grid gap-2">
									<Label for={`homework-${session.id}`}>Homework</Label>
									<Input
										id={`homework-${session.id}`}
										name="homework"
										value={formatList(session.notes.homework)}
									/>
								</div>
							</div>
							<div class="grid gap-2">
								<Label for={`response-${session.id}`}>Patient response</Label>
								<Textarea
									id={`response-${session.id}`}
									name="response"
									value={session.notes.response}
								/>
							</div>
							<div class="grid gap-4 md:grid-cols-[1fr_2fr]">
								<div class="grid gap-2">
									<Label for={`risk-level-${session.id}`}>Risk level</Label>
									<select
										id={`risk-level-${session.id}`}
										name="riskLevel"
										class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
									>
										<option value="">Not set</option>
										{#each data.therapySessionRiskLevelValues as riskLevel (riskLevel)}
											<option value={riskLevel} selected={riskLevel === session.notes.riskLevel}>
												{riskLevel}
											</option>
										{/each}
									</select>
								</div>
								<div class="grid gap-2">
									<Label for={`next-steps-${session.id}`}>Next steps</Label>
									<Textarea
										id={`next-steps-${session.id}`}
										name="nextSteps"
										value={session.notes.nextSteps}
									/>
								</div>
							</div>
							<Button
								type="submit"
								class="bg-blue-600 text-white hover:bg-blue-700"
								disabled={activeAction === `save-session-note-${session.id}`}
							>
								{#if activeAction === `save-session-note-${session.id}`}
									<LoaderCircleIcon class="size-4 animate-spin" />
									Updating...
								{:else}
									Update note
								{/if}
							</Button>
						</form>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Recent check-ins</Card.Title>
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
	{/if}
</div>
