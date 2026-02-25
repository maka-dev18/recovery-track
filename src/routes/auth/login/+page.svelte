<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<div class="bg-muted/40 min-h-svh bg-gradient-to-b from-blue-50 via-white to-blue-100 p-6 md:p-10">
	<div class="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-2">
		<Card.Root class="border-blue-100/70 bg-white/90 shadow-lg backdrop-blur">
			<Card.Header class="space-y-3">
				<Badge class="w-fit bg-blue-600 text-white">Recovery Track</Badge>
				<Card.Title class="text-2xl">Sign in</Card.Title>
				<Card.Description>
					Use your assigned credentials to access your dashboard.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/signIn" class="space-y-4">
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							required
							value={form?.mode === 'sign-in' ? form?.email ?? '' : ''}
						/>
					</div>
					<div class="space-y-2">
						<Label for="password">Password</Label>
						<Input id="password" name="password" type="password" autocomplete="current-password" required />
					</div>
					<Button type="submit" class="w-full bg-blue-600 text-white hover:bg-blue-700">Sign in</Button>
				</form>

				{#if form?.message && form.mode === 'sign-in'}
					<p class="text-destructive mt-4 text-sm">{form.message}</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-blue-100/70 bg-white/85 shadow-lg backdrop-blur">
			<Card.Header class="space-y-2">
				<Card.Title class="text-2xl">Initial setup</Card.Title>
				<Card.Description>
					Create the very first administrator account, then manage all users from the admin dashboard.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if data.allowBootstrap}
					<form method="POST" action="?/bootstrapAdmin" class="space-y-4">
						<div class="space-y-2">
							<Label for="bootstrap-name">Admin name</Label>
							<Input
								id="bootstrap-name"
								name="name"
								autocomplete="name"
								required
								value={form?.mode === 'bootstrap' ? form?.name ?? '' : ''}
							/>
						</div>
						<div class="space-y-2">
							<Label for="bootstrap-email">Admin email</Label>
							<Input
								id="bootstrap-email"
								name="email"
								type="email"
								autocomplete="email"
								required
								value={form?.mode === 'bootstrap' ? form?.email ?? '' : ''}
							/>
						</div>
						<div class="space-y-2">
							<Label for="bootstrap-password">Admin password</Label>
							<Input
								id="bootstrap-password"
								name="password"
								type="password"
								autocomplete="new-password"
								required
							/>
						</div>
						<Button type="submit" variant="outline" class="w-full border-blue-200 text-blue-700 hover:bg-blue-50">
							Create initial admin
						</Button>
					</form>

					{#if form?.message && form.mode === 'bootstrap'}
						<p class="text-destructive mt-4 text-sm">{form.message}</p>
					{/if}
				{:else}
					<div class="space-y-3 text-sm text-slate-600">
						<p>Bootstrap is completed. New users are created by admins from the dashboard.</p>
						<p>If you need access, contact your rehabilitation administrator.</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
