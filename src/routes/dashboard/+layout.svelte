<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import StethoscopeIcon from '@lucide/svelte/icons/stethoscope';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { ROLE_LABEL, type AppRole } from '$lib/roles';
	import type { LayoutData } from './$types';

	type DashboardLayoutData = LayoutData & {
		user: {
			id: string;
			name: string;
			email: string;
			role: AppRole;
		};
	};

	let {
		data,
		children
	}: {
		data: DashboardLayoutData;
		children: Snippet;
	} = $props();

	const navigationByRole = {
		admin: [{ title: 'Administration', href: '/dashboard/admin', icon: ShieldIcon }],
		therapist: [{ title: 'Therapist Dashboard', href: '/dashboard/therapist', icon: StethoscopeIcon }],
		patient: [{ title: 'Patient Dashboard', href: '/dashboard/patient', icon: HeartPulseIcon }],
		associate: [{ title: 'Associate Dashboard', href: '/dashboard/associate', icon: UsersIcon }]
	} satisfies Record<AppRole, Array<{ title: string; href: string; icon: typeof ShieldIcon }>>;
</script>

<Sidebar.Provider>
	<Sidebar.Root variant="inset" collapsible="icon">
		<Sidebar.Header class="border-sidebar-border border-b">
			<div class="flex items-center gap-3 rounded-lg bg-blue-600 px-3 py-2 text-white">
				<div class="bg-white/20 rounded-md p-1.5">
					<ShieldCheckIcon class="size-4" />
				</div>
				<div class="min-w-0 group-data-[collapsible=icon]:hidden">
					<p class="truncate text-sm font-semibold">Recovery Track</p>
					<p class="truncate text-xs text-blue-100">Rehabilitation Dashboard</p>
				</div>
			</div>
		</Sidebar.Header>

		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>Navigation</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each navigationByRole[data.user.role] as item (item.href)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton isActive={page.url.pathname.startsWith(item.href)} tooltipContent={item.title}>
									{#snippet child({ props })}
										<a {...props} href={item.href}>
											<item.icon />
											<span>{item.title}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</Sidebar.Content>

		<Sidebar.Footer class="border-sidebar-border border-t">
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Sidebar.MenuButton
									{...props}
									size="lg"
									class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
								>
									<Avatar.Root class="size-8 rounded-lg border border-blue-200">
										<Avatar.Fallback class="bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold">
											{data.user.name
												.split(' ')
												.map((part) => part[0])
												.join('')
												.slice(0, 2)
												.toUpperCase()}
										</Avatar.Fallback>
									</Avatar.Root>
									<div class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
										<span class="truncate font-medium">{data.user.name}</span>
										<span class="truncate text-xs">{ROLE_LABEL[data.user.role]}</span>
									</div>
									<ChevronsUpDownIcon class="ms-auto size-4 group-data-[collapsible=icon]:hidden" />
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content side="top" align="end" class="w-(--bits-dropdown-menu-anchor-width)">
							<DropdownMenu.Label>
								<div class="grid gap-0.5">
									<p class="text-sm font-medium">{data.user.name}</p>
									<p class="text-muted-foreground text-xs">{data.user.email}</p>
								</div>
							</DropdownMenu.Label>
							<DropdownMenu.Separator />
							<DropdownMenu.Item>
								{#snippet child({ props })}
									<a {...props} href="/auth/change-password" class="flex w-full items-center gap-2">
										<KeyRoundIcon class="size-4" />
										<span>Change password</span>
									</a>
								{/snippet}
							</DropdownMenu.Item>
							<DropdownMenu.Item>
								{#snippet child({ props })}
									<a {...props} href="/auth/logout" class="flex w-full items-center gap-2">
										<LogOutIcon class="size-4" />
										<span>Sign out</span>
									</a>
								{/snippet}
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>
		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset class="bg-gradient-to-b from-blue-50/40 via-background to-blue-100/30">
		<header class="border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
			<div class="flex h-16 items-center justify-between px-4 md:px-6">
				<div class="flex items-center gap-3">
					<Sidebar.Trigger />
					<Separator orientation="vertical" class="h-6" />
					<div class="space-y-0.5">
						<p class="text-sm font-semibold">{ROLE_LABEL[data.user.role]} Workspace</p>
						<p class="text-muted-foreground text-xs">{page.url.pathname}</p>
					</div>
				</div>
				<Badge class="bg-blue-100 text-blue-700 hover:bg-blue-100">Secure session</Badge>
			</div>
		</header>

		<div class="p-4 md:p-6 lg:p-8">
			{@render children()}
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
