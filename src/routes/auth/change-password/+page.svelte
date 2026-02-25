<script lang="ts">
	import { enhance } from '$app/forms';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as Card from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	let isSubmitting = $state(false);

	function pendingForm(node: HTMLFormElement) {
		return enhance(node, () => {
			isSubmitting = true;

			return async ({ update }) => {
				try {
					await update();
				} finally {
					isSubmitting = false;
				}
			};
		});
	}
</script>

<div class="bg-muted/40 min-h-svh bg-gradient-to-b from-blue-50 via-white to-blue-100 p-6 md:p-10">
	<div class="mx-auto w-full max-w-xl">
		<Card.Root class="border-blue-100 bg-white/90 shadow-lg backdrop-blur">
			<Card.Header class="space-y-3">
				{#if data.mustChangePassword}
					<Badge class="w-fit bg-blue-600 text-white">Password reset required</Badge>
				{/if}
				<Card.Title class="text-2xl">Update your password</Card.Title>
				<Card.Description>
					Use a secure password you have not used before.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/updatePassword" class="space-y-4" use:pendingForm>
					<div class="space-y-2">
						<Label for="currentPassword">Current password</Label>
						<Input
							id="currentPassword"
							name="currentPassword"
							type="password"
							autocomplete="current-password"
							required
						/>
					</div>
					<div class="space-y-2">
						<Label for="newPassword">New password</Label>
						<Input
							id="newPassword"
							name="newPassword"
							type="password"
							autocomplete="new-password"
							required
						/>
					</div>
					<div class="space-y-2">
						<Label for="confirmPassword">Confirm password</Label>
						<Input
							id="confirmPassword"
							name="confirmPassword"
							type="password"
							autocomplete="new-password"
							required
						/>
					</div>
					<Button
						type="submit"
						class="w-full bg-blue-600 text-white hover:bg-blue-700"
						disabled={isSubmitting}
					>
						{#if isSubmitting}
							<LoaderCircleIcon class="size-4 animate-spin" />
							Saving...
						{:else}
							Save new password
						{/if}
					</Button>
				</form>

				{#if form?.message}
					<p class="text-destructive mt-4 text-sm">{form.message}</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
