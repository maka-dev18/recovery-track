<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import * as Table from "$lib/components/ui/table";
	import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
	import type { ActionData, PageServerData } from "./$types";

	type AdminView = "overview" | "access" | "history" | "outreach" | "directory";
	let {
		data,
		form,
		initialView = "overview"
	}: { data: PageServerData; form: ActionData; initialView?: AdminView } = $props();
	let activeView = $derived(initialView);
	let activeAction = $state<string | null>(null);
	let historyPatientId = $state<string>("");
	let historyFile = $state<File | null>(null);
	let historyUploading = $state(false);
	let historyMessage = $state<string | null>(null);
	let historyError = $state<string | null>(null);
	let activeReprocessFileId = $state<string | null>(null);
	let historyFileInput = $state<HTMLInputElement | null>(null);
	let selectedHistoryFileId = $state<string | null>(null);
	let selectedHistoryFile = $derived(
		data.historyFiles.find((file) => file.id === selectedHistoryFileId) ?? data.historyFiles[0] ?? null
	);

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

	function formatDate(value: Date | string | null | undefined) {
		if (!value) return "—";
		const date = typeof value === "string" ? new Date(value) : value;
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit"
		}).format(date);
	}

	function formatBytes(size: number) {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}

	function parseJsonValue(raw: string | null | undefined) {
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	function formatJson(raw: string | null | undefined) {
		const parsed = parseJsonValue(raw);
		return parsed ? JSON.stringify(parsed, null, 2) : raw || "{}";
	}

	function summarizeSignal(raw: string) {
		const parsed = parseJsonValue(raw);
		if (!parsed || typeof parsed !== "object") {
			return raw;
		}

		if ("summary" in parsed && typeof parsed.summary === "string") {
			return parsed.summary;
		}

		if ("label" in parsed && typeof parsed.label === "string") {
			return parsed.label;
		}

		if ("row" in parsed) {
			return JSON.stringify(parsed.row);
		}

		return JSON.stringify(parsed);
	}

	function selectHistoryFile(fileId: string | null | undefined) {
		if (fileId) {
			selectedHistoryFileId = fileId;
		}
	}

	function historyRunActionLabel(status: string) {
		return status === "failed" || status === "retry" ? "Retry" : "Reprocess";
	}

	function resolveErrorMessage(error: unknown, fallback: string) {
		if (error instanceof Error) return error.message;
		return fallback;
	}

	function resetUploadFeedback() {
		historyMessage = null;
		historyError = null;
	}

	async function uploadHistoryFile() {
		resetUploadFeedback();
		if (!data.aiFeatures.historyIngestEnabled) {
			historyError = "Historical rehab ingestion is currently disabled.";
			return;
		}

		if (!historyPatientId) {
			historyError = "Select a patient before uploading.";
			return;
		}

		if (!historyFile) {
			historyError = "Choose a PDF or CSV file to upload.";
			return;
		}

		const mimeType = historyFile.type || "application/octet-stream";
		const isPdf = mimeType.includes("pdf") || historyFile.name.toLowerCase().endsWith(".pdf");
		const isCsv = mimeType.includes("csv") || historyFile.name.toLowerCase().endsWith(".csv");
		if (!isPdf && !isCsv) {
			historyError = "Only PDF and CSV files are supported.";
			return;
		}

		historyUploading = true;
		try {
			const uploadFormData = new FormData();
			uploadFormData.set("file", historyFile);
			uploadFormData.set("fileName", historyFile.name);
			uploadFormData.set("mimeType", mimeType);

			const uploadResponse = await fetch(`/api/admin/patients/${historyPatientId}/history/upload`, {
				method: "POST",
				body: uploadFormData
			});
			const uploadPayload = await uploadResponse.json();
			if (!uploadResponse.ok) {
				throw new Error(uploadPayload?.message ?? "Cloud upload failed before metadata registration.");
			}

			const completeResponse = await fetch(`/api/admin/patients/${historyPatientId}/history/complete`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					key: uploadPayload.key,
					fileName: uploadPayload.fileName ?? historyFile.name,
					mimeType: uploadPayload.mimeType ?? mimeType,
					byteSize: uploadPayload.byteSize ?? historyFile.size
				})
			});

			const completePayload = await completeResponse.json();
			if (!completeResponse.ok) {
				throw new Error(completePayload?.message ?? "Could not finalize upload metadata.");
			}

			historyMessage = completePayload?.message ?? "History file uploaded and queued.";
			historyFile = null;
			if (historyFileInput) {
				historyFileInput.value = "";
			}
			await invalidateAll();
		} catch (error) {
			historyError = resolveErrorMessage(error, "History upload failed.");
		} finally {
			historyUploading = false;
		}
	}

	async function reprocessHistoryFile(patientId: string, fileId: string) {
		resetUploadFeedback();
		if (!data.aiFeatures.historyIngestEnabled) {
			historyError = "Historical rehab ingestion is currently disabled.";
			return;
		}

		activeReprocessFileId = fileId;

		try {
			const response = await fetch(`/api/admin/patients/${patientId}/history/reprocess`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ fileId })
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.message ?? "Reprocess request failed.");
			}

			historyMessage = payload?.message ?? "Reprocess queued.";
			await invalidateAll();
		} catch (error) {
			historyError = resolveErrorMessage(error, "Unable to queue reprocess.");
		} finally {
			activeReprocessFileId = null;
		}
	}
</script>

<div class="space-y-6">
	{#if form?.message}
		<div
			class="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm"
		>
			{form.message}
		</div>
	{:else if form?.success}
		<div
			class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700"
		>
			{form.success}
		</div>
	{/if}

	<section class="rounded-lg border bg-white p-4 shadow-sm md:p-5">
		<div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold">Platform operations</h1>
			</div>
			<div class="grid gap-2 sm:grid-cols-3 lg:min-w-[28rem]">
				<div class="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
					<p class="text-xs text-emerald-700">Users</p>
					<p class="font-semibold text-emerald-950">{data.stats.totalUsers}</p>
				</div>
				<div class="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2">
					<p class="text-xs text-cyan-700">Patients</p>
					<p class="font-semibold text-cyan-950">{data.stats.patients}</p>
				</div>
				<div class="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
					<p class="text-xs text-amber-700">Outreach</p>
					<p class="font-semibold text-amber-950">{data.inactivePatients.length}</p>
				</div>
			</div>
		</div>
	</section>

	{#if activeView === "overview"}
	<section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Total users</Card.Title>
				<p class="text-3xl font-semibold">{data.stats.totalUsers}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Therapists</Card.Title>
				<p class="text-3xl font-semibold">{data.stats.therapists}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Patients</Card.Title>
				<p class="text-3xl font-semibold">{data.stats.patients}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Associates</Card.Title>
				<p class="text-3xl font-semibold">{data.stats.associates}</p>
			</Card.Header>
		</Card.Root>
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header class="space-y-1">
				<Card.Title class="text-sm font-medium">Forced resets</Card.Title>
				<p class="text-3xl font-semibold">{data.stats.forcedPasswordResets}</p>
			</Card.Header>
		</Card.Root>
	</section>

	{:else if activeView === "access"}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Create platform user</Card.Title>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/createUser"
					class="grid gap-4"
					use:pendingForm={"create-user"}
				>
					<div class="grid gap-2">
						<Label for="new-name">Full name</Label>
						<Input
							id="new-name"
							name="name"
							autocomplete="name"
							required
						/>
					</div>
					<div class="grid gap-2">
						<Label for="new-email">Email</Label>
						<Input
							id="new-email"
							name="email"
							type="email"
							autocomplete="email"
							required
						/>
					</div>
					<div class="grid gap-2">
						<Label for="new-password">Default password</Label>
						<Input
							id="new-password"
							name="password"
							type="password"
							autocomplete="new-password"
							required
						/>
					</div>
					<div class="grid gap-2">
						<Label for="new-role">Role</Label>
						<select
							id="new-role"
							name="role"
							class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
						>
							{#each data.roles as role (role)}
								<option value={role}>{role}</option>
							{/each}
						</select>
					</div>
					<label class="flex items-center gap-2 text-sm font-medium">
						<input
							type="checkbox"
							name="forcePasswordChange"
							class="border-input text-primary focus-visible:ring-ring size-4 rounded border"
							checked
						/>
						Force password change on first login
					</label>
					<Button
						type="submit"
						class="w-full bg-blue-600 text-white hover:bg-blue-700"
						disabled={activeAction === "create-user"}
					>
						{#if activeAction === "create-user"}
							<LoaderCircleIcon class="size-4 animate-spin" />
							Creating user...
						{:else}
							Create user
						{/if}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<div class="grid gap-6">
			<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
				<Card.Header>
					<Card.Title>Assign therapist to patient</Card.Title>
				</Card.Header>
				<Card.Content>
					<form
						method="POST"
						action="?/assignTherapist"
						class="grid gap-4"
						use:pendingForm={"assign-therapist"}
					>
						<div class="grid gap-2">
							<Label for="therapistId">Therapist</Label>
							<select
								id="therapistId"
								name="therapistId"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Select therapist</option>
								{#each data.therapists as therapist (therapist.id)}
									<option value={therapist.id}>{therapist.name} ({therapist.email})</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="therapist-patientId">Patient</Label>
							<select
								id="therapist-patientId"
								name="patientId"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Select patient</option>
								{#each data.patients as patient (patient.id)}
									<option value={patient.id}>{patient.name} ({patient.email})</option>
								{/each}
							</select>
						</div>
						<Button
							type="submit"
							variant="outline"
							class="border-blue-200 text-blue-700 hover:bg-blue-50"
							disabled={activeAction === "assign-therapist"}
						>
							{#if activeAction === "assign-therapist"}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Assigning...
							{:else}
								Assign therapist
							{/if}
						</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
				<Card.Header>
					<Card.Title>Link associate to patient</Card.Title>
				</Card.Header>
				<Card.Content>
					<form
						method="POST"
						action="?/assignAssociate"
						class="grid gap-4"
						use:pendingForm={"assign-associate"}
					>
						<div class="grid gap-2">
							<Label for="associateId">Associate</Label>
							<select
								id="associateId"
								name="associateId"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Select associate</option>
								{#each data.associates as associate (associate.id)}
									<option value={associate.id}>{associate.name} ({associate.email})</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="associate-patientId">Patient</Label>
							<select
								id="associate-patientId"
								name="patientId"
								required
								class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
							>
								<option value="">Select patient</option>
								{#each data.patients as patient (patient.id)}
									<option value={patient.id}>{patient.name} ({patient.email})</option>
								{/each}
							</select>
						</div>
						<div class="grid gap-2">
							<Label for="relationshipLabel">Relationship label</Label>
							<Input
								id="relationshipLabel"
								name="relationshipLabel"
								placeholder="family, sibling, sponsor"
							/>
						</div>
						<Button
							type="submit"
							variant="outline"
							class="border-blue-200 text-blue-700 hover:bg-blue-50"
							disabled={activeAction === "assign-associate"}
						>
							{#if activeAction === "assign-associate"}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Linking...
							{:else}
								Link associate
							{/if}
						</Button>
					</form>
				</Card.Content>
			</Card.Root>
		</div>
	</section>

	{:else if activeView === "history"}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Historical rehab uploads</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if !data.aiFeatures.historyIngestEnabled}
					<div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
						Historical rehab ingestion is disabled. Upload and reprocess actions are unavailable.
					</div>
				{/if}
				{#if historyError}
					<div class="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
						{historyError}
					</div>
				{:else if historyMessage}
					<div class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
						{historyMessage}
					</div>
				{/if}
				<div class="grid gap-2">
					<Label for="history-patient">Patient</Label>
					<select
						id="history-patient"
						bind:value={historyPatientId}
						disabled={!data.aiFeatures.historyIngestEnabled || historyUploading}
						class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
					>
						<option value="">Select patient</option>
						{#each data.patients as patient (patient.id)}
							<option value={patient.id}>{patient.name} ({patient.email})</option>
						{/each}
					</select>
				</div>
				<div class="grid gap-2">
					<Label for="history-file">Rehab file (PDF/CSV)</Label>
					<Input
						id="history-file"
						type="file"
						accept=".pdf,.csv,text/csv,application/pdf"
						bind:ref={historyFileInput}
						disabled={!data.aiFeatures.historyIngestEnabled || historyUploading}
						onchange={(event) => {
							const target = event.currentTarget as HTMLInputElement;
							historyFile = target.files?.[0] ?? null;
						}}
					/>
				</div>
				<Button
					type="button"
					class="w-full bg-blue-600 text-white hover:bg-blue-700"
					disabled={!data.aiFeatures.historyIngestEnabled || historyUploading || !historyPatientId || !historyFile}
					onclick={uploadHistoryFile}
				>
					{#if historyUploading}
						<LoaderCircleIcon class="size-4 animate-spin" />
						Uploading and queuing parse...
					{:else}
						Upload historical file
					{/if}
				</Button>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Parser queue</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Type</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Attempts</Table.Head>
								<Table.Head>Run after</Table.Head>
								<Table.Head>Last error</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.queueJobs.length === 0}
								<Table.Row>
									<Table.Cell colspan={5} class="text-muted-foreground py-6 text-center">
										No jobs in queue yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.queueJobs as job (job.id)}
									<Table.Row>
										<Table.Cell>
											<button
												type="button"
												class="text-left font-medium text-blue-700 hover:underline disabled:text-foreground disabled:no-underline"
												disabled={!job.fileId}
												onclick={() => selectHistoryFile(job.fileId)}
											>
												{job.type}
											</button>
										</Table.Cell>
										<Table.Cell>
											<Badge variant="outline">{job.status}</Badge>
										</Table.Cell>
										<Table.Cell>{job.attempts}</Table.Cell>
										<Table.Cell>{formatDate(job.runAfter)}</Table.Cell>
										<Table.Cell>
											{#if job.lastError}
												<p class="text-destructive max-w-[320px] text-xs">{job.lastError}</p>
											{:else}
												<span class="text-muted-foreground text-xs">—</span>
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
	</section>

	<section class="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>History extraction runs</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>File</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Action</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.historyFiles.length === 0}
								<Table.Row>
									<Table.Cell colspan={4} class="text-muted-foreground py-6 text-center">
										No rehab files uploaded yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.historyFiles as file (file.id)}
									<Table.Row class={selectedHistoryFile?.id === file.id ? "bg-blue-50/70" : ""}>
										<Table.Cell>
											<div class="font-medium">{file.patientName}</div>
											<div class="text-muted-foreground text-xs">{file.patientEmail}</div>
										</Table.Cell>
										<Table.Cell>
											<button
												type="button"
												class="text-left font-medium text-blue-700 hover:underline"
												onclick={() => selectHistoryFile(file.id)}
											>
												{file.fileName}
											</button>
											<div class="text-muted-foreground text-xs">{formatBytes(file.byteSize)} · {file.mimeType}</div>
										</Table.Cell>
										<Table.Cell>
											<div class="flex flex-col gap-1">
												<Badge variant="outline">{file.parseStatus}</Badge>
												{#if file.parseError}
													<p class="text-destructive max-w-[260px] text-xs">{file.parseError}</p>
												{/if}
											</div>
										</Table.Cell>
										<Table.Cell class="text-right">
											<div class="flex justify-end gap-2">
												<Button
													type="button"
													variant="outline"
													size="sm"
													class="border-blue-200 text-blue-700 hover:bg-blue-50"
													onclick={() => selectHistoryFile(file.id)}
												>
													View
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													class="border-blue-200 text-blue-700 hover:bg-blue-50"
													disabled={!data.aiFeatures.historyIngestEnabled || activeReprocessFileId === file.id}
													onclick={() => reprocessHistoryFile(file.patientId, file.id)}
												>
													{#if activeReprocessFileId === file.id}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														{historyRunActionLabel(file.parseStatus)}
													{/if}
												</Button>
											</div>
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
				<Card.Title>Extracted data</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if !selectedHistoryFile}
					<p class="text-muted-foreground text-sm">Select a history run to inspect its extracted data.</p>
				{:else}
					<div class="grid gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm">
						<div>
							<p class="font-medium">{selectedHistoryFile.fileName}</p>
							<p class="text-muted-foreground text-xs">
								{selectedHistoryFile.patientName} · uploaded {formatDate(selectedHistoryFile.createdAt)}
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<Badge variant="outline">{selectedHistoryFile.parseStatus}</Badge>
							{#if selectedHistoryFile.extractionModel}
								<Badge class="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
									{selectedHistoryFile.extractionModel}
								</Badge>
							{/if}
							{#if selectedHistoryFile.extractedAt}
								<Badge variant="secondary">Extracted {formatDate(selectedHistoryFile.extractedAt)}</Badge>
							{/if}
						</div>
						{#if selectedHistoryFile.geminiFileName || selectedHistoryFile.geminiFileUri}
							<div class="text-muted-foreground text-xs">
								<div>Gemini file: {selectedHistoryFile.geminiFileName ?? "—"}</div>
								<div class="break-all">URI: {selectedHistoryFile.geminiFileUri ?? "—"}</div>
							</div>
						{/if}
					</div>

					<div class="space-y-2">
						<p class="text-sm font-medium">Structured extraction JSON</p>
						<pre class="max-h-[280px] overflow-auto rounded-md border bg-slate-950 p-3 text-xs text-slate-50">{formatJson(selectedHistoryFile.extractionJson)}</pre>
					</div>

					<div class="space-y-2">
						<p class="text-sm font-medium">Stored clinical signals</p>
						{#if selectedHistoryFile.signals.length === 0}
							<p class="text-muted-foreground text-sm">No extracted signals are stored for this run yet.</p>
						{:else}
							<div class="max-h-[320px] space-y-2 overflow-y-auto">
								{#each selectedHistoryFile.signals as signal (signal.id)}
									<div class="rounded-md border border-blue-100 bg-white p-3 text-sm">
										<div class="flex items-center justify-between gap-3">
											<Badge variant="outline">{signal.signalType.replaceAll("_", " ")}</Badge>
											<span class="text-muted-foreground text-xs">Confidence {signal.confidence}</span>
										</div>
										<p class="mt-2 text-sm">{summarizeSignal(signal.signalValueJson)}</p>
										<p class="text-muted-foreground mt-1 text-xs">
											Occurred: {formatDate(signal.occurredAt)} · Stored: {formatDate(signal.createdAt)}
										</p>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === "outreach"}
	<section class="grid gap-6 xl:grid-cols-2">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Inactive patients</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if data.inactivePatients.length === 0}
					<p class="text-muted-foreground text-sm">No patient inactivity alerts are active right now.</p>
				{:else}
					{#each data.inactivePatients as patient (patient.patientId)}
						<div class="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-medium">{patient.patientName}</p>
									<p class="text-muted-foreground text-xs">{patient.patientEmail}</p>
								</div>
								<Badge class="bg-amber-100 text-amber-900 hover:bg-amber-100">
									{patient.inactiveDays ?? "Unknown"} days inactive
								</Badge>
							</div>
							<p class="text-muted-foreground text-xs">
								Last seen: {formatDate(patient.lastActiveAt)} {patient.lastPath ? `· ${patient.lastPath}` : ""}
							</p>
							{#if patient.therapistName}
								<p class="text-muted-foreground text-xs">
									Therapist: {patient.therapistName} {patient.therapistEmail ? `· ${patient.therapistEmail}` : ""}
								</p>
							{/if}
							<div class="grid gap-2 md:grid-cols-2">
								<form method="POST" action="?/logOutreach" use:pendingForm={`call-patient-${patient.patientId}`}>
									<input type="hidden" name="patientId" value={patient.patientId} />
									<input type="hidden" name="targetUserId" value={patient.patientId} />
									<input type="hidden" name="channel" value="call_patient" />
									<Button
										type="submit"
										variant="outline"
										class="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
										disabled={activeAction === `call-patient-${patient.patientId}`}
									>
										{#if activeAction === `call-patient-${patient.patientId}`}
											<LoaderCircleIcon class="size-4 animate-spin" />
										{:else}
											Log call to patient
										{/if}
									</Button>
								</form>
								<form method="POST" action="?/logOutreach" use:pendingForm={`email-patient-${patient.patientId}`}>
									<input type="hidden" name="patientId" value={patient.patientId} />
									<input type="hidden" name="targetUserId" value={patient.patientId} />
									<input type="hidden" name="channel" value="email_patient" />
									<Button
										type="submit"
										variant="outline"
										class="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
										disabled={activeAction === `email-patient-${patient.patientId}`}
									>
										{#if activeAction === `email-patient-${patient.patientId}`}
											<LoaderCircleIcon class="size-4 animate-spin" />
										{:else}
											Log email to patient
										{/if}
									</Button>
								</form>
							</div>
							{#if patient.associates.length > 0}
								<div class="space-y-2 rounded-lg border border-blue-100 bg-white p-3">
									<p class="text-sm font-medium">Associate outreach</p>
									{#each patient.associates as associate (associate.id)}
										<div class="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-center">
											<div>
												<p class="text-sm">{associate.name}</p>
												<p class="text-muted-foreground text-xs">{associate.email}</p>
											</div>
											<form method="POST" action="?/logOutreach" use:pendingForm={`call-associate-${patient.patientId}-${associate.id}`}>
												<input type="hidden" name="patientId" value={patient.patientId} />
												<input type="hidden" name="associateId" value={associate.id} />
												<input type="hidden" name="targetUserId" value={associate.id} />
												<input type="hidden" name="channel" value="call_associate" />
												<Button
													type="submit"
													variant="outline"
													class="border-blue-200 text-blue-700 hover:bg-blue-50"
													disabled={activeAction === `call-associate-${patient.patientId}-${associate.id}`}
												>
													{#if activeAction === `call-associate-${patient.patientId}-${associate.id}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Log call
													{/if}
												</Button>
											</form>
											<form method="POST" action="?/logOutreach" use:pendingForm={`email-associate-${patient.patientId}-${associate.id}`}>
												<input type="hidden" name="patientId" value={patient.patientId} />
												<input type="hidden" name="associateId" value={associate.id} />
												<input type="hidden" name="targetUserId" value={associate.id} />
												<input type="hidden" name="channel" value="email_associate" />
												<Button
													type="submit"
													variant="outline"
													class="border-blue-200 text-blue-700 hover:bg-blue-50"
													disabled={activeAction === `email-associate-${patient.patientId}-${associate.id}`}
												>
													{#if activeAction === `email-associate-${patient.patientId}-${associate.id}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Log email
													{/if}
												</Button>
											</form>
										</div>
									{/each}
								</div>
							{/if}
							{#if patient.latestOutreach}
								<p class="text-muted-foreground text-xs">
									Last outreach: {patient.latestOutreach.channel.replaceAll("_", " ")} on {formatDate(patient.latestOutreach.createdAt)}
								</p>
							{/if}
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Outreach history</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>When</Table.Head>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Action</Table.Head>
								<Table.Head>Target</Table.Head>
								<Table.Head>Admin</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.outreachLogs.length === 0}
								<Table.Row>
									<Table.Cell colspan={5} class="text-muted-foreground py-6 text-center">
										No outreach has been logged yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.outreachLogs as log (log.id)}
									<Table.Row>
										<Table.Cell>{formatDate(log.createdAt)}</Table.Cell>
										<Table.Cell>{log.patientName}</Table.Cell>
										<Table.Cell>{log.channel.replaceAll("_", " ")}</Table.Cell>
										<Table.Cell>{log.targetName}</Table.Cell>
										<Table.Cell>{log.adminName}</Table.Cell>
									</Table.Row>
								{/each}
							{/if}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	{:else if activeView === "directory"}
	<section class="grid gap-6">
		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>User directory</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head>Email</Table.Head>
								<Table.Head>Role</Table.Head>
								<Table.Head>Credentials</Table.Head>
								<Table.Head>Manage</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.users as managedUser (managedUser.id)}
								<Table.Row>
									<Table.Cell class="font-medium">{managedUser.name}</Table.Cell>
									<Table.Cell>{managedUser.email}</Table.Cell>
									<Table.Cell>
										<Badge class="bg-blue-100 text-blue-700 hover:bg-blue-100">{managedUser.role}</Badge>
									</Table.Cell>
									<Table.Cell>
										{#if managedUser.mustChangePassword}
											<Badge variant="outline" class="border-blue-300 text-blue-700">Change required</Badge>
										{:else}
											<Badge variant="secondary">Up to date</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell>
										<div class="grid gap-2">
											<form
												method="POST"
												action="?/updateUser"
												class="grid gap-2 md:grid-cols-[1fr_170px_auto]"
												use:pendingForm={`update-user-${managedUser.id}`}
											>
												<input type="hidden" name="userId" value={managedUser.id} />
												<Input name="name" value={managedUser.name} required />
												<select
													name="role"
													value={managedUser.role}
													class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
												>
													{#each data.roles as role (role)}
														<option value={role}>{role}</option>
													{/each}
												</select>
												<Button
													type="submit"
													variant="outline"
													disabled={activeAction === `update-user-${managedUser.id}`}
												>
													{#if activeAction === `update-user-${managedUser.id}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Save
													{/if}
												</Button>
												<label class="text-muted-foreground flex items-center gap-2 text-xs md:col-span-3">
													<input
														type="checkbox"
														name="forcePasswordChange"
														checked={managedUser.mustChangePassword}
														class="border-input text-primary focus-visible:ring-ring size-4 rounded border"
													/>
													Force password change
												</label>
											</form>
											<form
												method="POST"
												action="?/resetUserPassword"
												class="grid gap-2 md:grid-cols-[1fr_auto]"
												use:pendingForm={`reset-password-${managedUser.id}`}
											>
												<input type="hidden" name="userId" value={managedUser.id} />
												<Input
													name="newPassword"
													type="password"
													autocomplete="new-password"
													placeholder="New default password"
													required
												/>
												<Button
													type="submit"
													variant="outline"
													class="border-blue-200 text-blue-700 hover:bg-blue-50"
													disabled={activeAction === `reset-password-${managedUser.id}`}
												>
													{#if activeAction === `reset-password-${managedUser.id}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Reset
													{/if}
												</Button>
												<label class="text-muted-foreground flex items-center gap-2 text-xs md:col-span-2">
													<input
														type="checkbox"
														name="forcePasswordChange"
														checked
														class="border-input text-primary focus-visible:ring-ring size-4 rounded border"
													/>
													Force change at next login
												</label>
											</form>
											<form
												method="POST"
												action="?/removeUser"
												use:pendingForm={`remove-user-${managedUser.id}`}
											>
												<input type="hidden" name="userId" value={managedUser.id} />
												<Button
													type="submit"
													variant="ghost"
													class="text-destructive hover:text-destructive"
													disabled={activeAction === `remove-user-${managedUser.id}`}
												>
													{#if activeAction === `remove-user-${managedUser.id}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
														Removing...
													{:else}
														Remove user
													{/if}
												</Button>
											</form>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Therapist assignments</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Therapist</Table.Head>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Assigned by</Table.Head>
								<Table.Head class="text-right">Action</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.therapistAssignments.length === 0}
								<Table.Row>
									<Table.Cell colspan={4} class="text-muted-foreground py-8 text-center">
										No therapist assignments yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.therapistAssignments as assignment (assignment.therapistId + assignment.patientId)}
									<Table.Row>
										<Table.Cell>{assignment.therapistName}</Table.Cell>
										<Table.Cell>{assignment.patientName}</Table.Cell>
										<Table.Cell>{assignment.assignedBy}</Table.Cell>
										<Table.Cell class="text-right">
											<form
												method="POST"
												action="?/removeTherapistAssignment"
												use:pendingForm={`remove-therapist-${assignment.therapistId}-${assignment.patientId}`}
											>
												<input type="hidden" name="therapistId" value={assignment.therapistId} />
												<input type="hidden" name="patientId" value={assignment.patientId} />
												<Button
													type="submit"
													variant="ghost"
													class="text-destructive hover:text-destructive"
													disabled={activeAction === `remove-therapist-${assignment.therapistId}-${assignment.patientId}`}
												>
													{#if activeAction === `remove-therapist-${assignment.therapistId}-${assignment.patientId}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Remove
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

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Associate links</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Associate</Table.Head>
								<Table.Head>Patient</Table.Head>
								<Table.Head>Relationship</Table.Head>
								<Table.Head>Assigned by</Table.Head>
								<Table.Head class="text-right">Action</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.associateAssignments.length === 0}
								<Table.Row>
									<Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">
										No associate links yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.associateAssignments as assignment (assignment.associateId + assignment.patientId)}
									<Table.Row>
										<Table.Cell>{assignment.associateName}</Table.Cell>
										<Table.Cell>{assignment.patientName}</Table.Cell>
										<Table.Cell>
											<form
												method="POST"
												action="?/updateAssociateAssignment"
												class="flex items-center gap-2"
												use:pendingForm={`update-associate-${assignment.associateId}-${assignment.patientId}`}
											>
												<input type="hidden" name="associateId" value={assignment.associateId} />
												<input type="hidden" name="patientId" value={assignment.patientId} />
												<Input
													name="relationshipLabel"
													value={assignment.relationshipLabel}
													class="h-8"
													required
												/>
												<Button
													type="submit"
													variant="outline"
													size="sm"
													disabled={activeAction === `update-associate-${assignment.associateId}-${assignment.patientId}`}
												>
													{#if activeAction === `update-associate-${assignment.associateId}-${assignment.patientId}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Save
													{/if}
												</Button>
											</form>
										</Table.Cell>
										<Table.Cell>{assignment.assignedBy}</Table.Cell>
										<Table.Cell class="text-right">
											<form
												method="POST"
												action="?/removeAssociateAssignment"
												use:pendingForm={`remove-associate-${assignment.associateId}-${assignment.patientId}`}
											>
												<input type="hidden" name="associateId" value={assignment.associateId} />
												<input type="hidden" name="patientId" value={assignment.patientId} />
												<Button
													type="submit"
													variant="ghost"
													class="text-destructive hover:text-destructive"
													disabled={activeAction === `remove-associate-${assignment.associateId}-${assignment.patientId}`}
												>
													{#if activeAction === `remove-associate-${assignment.associateId}-${assignment.patientId}`}
														<LoaderCircleIcon class="size-4 animate-spin" />
													{:else}
														Remove
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

		<Card.Root class="border-blue-100 bg-white/90 shadow-sm">
			<Card.Header>
				<Card.Title>Historical rehab files</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Patient</Table.Head>
								<Table.Head>File</Table.Head>
								<Table.Head>Size</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Uploaded</Table.Head>
								<Table.Head class="text-right">Action</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if data.historyFiles.length === 0}
								<Table.Row>
									<Table.Cell colspan={6} class="text-muted-foreground py-6 text-center">
										No rehab files uploaded yet.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each data.historyFiles as file (file.id)}
									<Table.Row>
										<Table.Cell>
											<div class="font-medium">{file.patientName}</div>
											<div class="text-muted-foreground text-xs">{file.patientEmail}</div>
										</Table.Cell>
										<Table.Cell>
											<div class="font-medium">{file.fileName}</div>
											<div class="text-muted-foreground text-xs">{file.mimeType}</div>
										</Table.Cell>
										<Table.Cell>{formatBytes(file.byteSize)}</Table.Cell>
										<Table.Cell>
											<div class="flex flex-col gap-1">
												<Badge variant="outline">{file.parseStatus}</Badge>
												{#if file.parseError}
													<p class="text-destructive max-w-[280px] text-xs">{file.parseError}</p>
												{/if}
											</div>
										</Table.Cell>
										<Table.Cell>
											<div>{formatDate(file.createdAt)}</div>
											<div class="text-muted-foreground text-xs">Parsed: {formatDate(file.parsedAt)}</div>
										</Table.Cell>
										<Table.Cell class="text-right">
											<Button
												type="button"
												variant="outline"
												size="sm"
												class="border-blue-200 text-blue-700 hover:bg-blue-50"
												disabled={!data.aiFeatures.historyIngestEnabled || activeReprocessFileId === file.id}
												onclick={() => reprocessHistoryFile(file.patientId, file.id)}
											>
												{#if activeReprocessFileId === file.id}
													<LoaderCircleIcon class="size-4 animate-spin" />
												{:else}
													{historyRunActionLabel(file.parseStatus)}
												{/if}
											</Button>
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
	{/if}
</div>
