<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import StethoscopeIcon from '@lucide/svelte/icons/stethoscope';
	import UsersIcon from '@lucide/svelte/icons/users';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import HeartHandshakeIcon from '@lucide/svelte/icons/heart-handshake';
	import HistoryIcon from '@lucide/svelte/icons/history';
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
		notifications: Array<{
			id: string;
			type: string;
			title: string;
			body: string;
			href: string | null;
			status: string;
			createdAt: Date | string;
		}>;
		unreadNotificationCount: number;
	};

	let {
		data,
		children
	}: {
		data: DashboardLayoutData;
		children: Snippet;
	} = $props();

	let markingNotificationsRead = $state(false);

	const roleRoots = {
		admin: '/dashboard/admin',
		therapist: '/dashboard/therapist',
		patient: '/dashboard/patient',
		associate: '/dashboard/associate'
	} satisfies Record<AppRole, string>;

	const navigationByRole = {
		admin: [
			{ title: 'Overview', href: '/dashboard/admin', icon: LayoutDashboardIcon },
			{ title: 'Access', href: '/dashboard/admin/access', icon: UserPlusIcon },
			{ title: 'History ingest', href: '/dashboard/admin/history', icon: CloudUploadIcon },
			{ title: 'Outreach', href: '/dashboard/admin/outreach', icon: BellRingIcon },
			{ title: 'Directory', href: '/dashboard/admin/directory', icon: DatabaseIcon }
		],
		therapist: [
			{ title: 'Overview', href: '/dashboard/therapist', icon: StethoscopeIcon },
			{ title: 'Reports', href: '/dashboard/therapist/reports', icon: ChartColumnIcon },
			{ title: 'Follow-ups', href: '/dashboard/therapist/followups', icon: CalendarClockIcon },
			{ title: 'Caseload', href: '/dashboard/therapist/caseload', icon: UsersIcon },
			{ title: 'Care work', href: '/dashboard/therapist/care', icon: MessageSquareTextIcon }
		],
		patient: [
			{ title: 'Today', href: '/dashboard/patient', icon: ClipboardCheckIcon },
			{ title: 'Care plan', href: '/dashboard/patient/care', icon: HeartHandshakeIcon },
			{ title: 'Messages', href: '/dashboard/patient/messages', icon: MessageSquareTextIcon },
			{ title: 'History', href: '/dashboard/patient/history', icon: HistoryIcon }
		],
		associate: [
			{ title: 'Report', href: '/dashboard/associate', icon: ClipboardListIcon },
			{ title: 'Patients', href: '/dashboard/associate/patients', icon: UsersIcon },
			{ title: 'Messages', href: '/dashboard/associate/messages', icon: MessageSquareTextIcon }
		]
	} satisfies Record<AppRole, Array<{ title: string; href: string; icon: typeof ShieldIcon }>>;

	function isNavigationActive(href: string) {
		const root = roleRoots[data.user.role];
		if (href === root) {
			return page.url.pathname === href;
		}

		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	function currentNavigationTitle() {
		return (
			navigationByRole[data.user.role].find((item) => isNavigationActive(item.href))?.title ??
			ROLE_LABEL[data.user.role]
		);
	}

	function formatNotificationTime(value: Date | string) {
		const date = new Date(value);
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}

	async function markNotificationsRead() {
		if (markingNotificationsRead || data.unreadNotificationCount === 0) {
			return;
		}

		markingNotificationsRead = true;
		try {
			const response = await fetch('/api/notifications/read', { method: 'POST' });
			if (response.ok) {
				await invalidateAll();
			}
		} finally {
			markingNotificationsRead = false;
		}
	}
</script>

<Sidebar.Provider>
	<Sidebar.Root variant="sidebar" collapsible="icon">
		<Sidebar.Header class="border-sidebar-border border-b">
			<div class="flex items-center gap-3 rounded-lg border border-emerald-100 bg-white px-3 py-2">
				<div class="rounded-md bg-emerald-600 p-1.5 text-white">
					<ShieldCheckIcon class="size-4" />
				</div>
				<div class="min-w-0 group-data-[collapsible=icon]:hidden">
					<p class="truncate text-sm font-semibold">Recovery Track</p>
					<p class="text-muted-foreground truncate text-xs">Care coordination</p>
				</div>
			</div>
		</Sidebar.Header>

		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>{ROLE_LABEL[data.user.role]}</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each navigationByRole[data.user.role] as item (item.href)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={isNavigationActive(item.href)}
									tooltipContent={item.title}
									class="h-9"
								>
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
									<Avatar.Root class="size-8 rounded-lg border border-emerald-200">
										<Avatar.Fallback class="rounded-lg bg-emerald-50 text-xs font-semibold text-emerald-700">
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

	<Sidebar.Inset class="min-h-svh bg-stone-50">
		<header class="sticky top-0 z-20 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
			<div class="flex h-16 items-center justify-between px-4 md:px-6">
				<div class="flex items-center gap-3">
					<Sidebar.Trigger />
					<Separator orientation="vertical" class="h-6" />
					<div class="space-y-0.5">
						<p class="text-sm font-semibold">{currentNavigationTitle()}</p>
						<p class="text-muted-foreground text-xs">{ROLE_LABEL[data.user.role]} workspace</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="relative inline-flex size-9 items-center justify-center rounded-md border bg-white text-stone-700 shadow-xs transition hover:bg-stone-50"
									aria-label="Notifications"
								>
									<BellRingIcon class="size-4" />
									{#if data.unreadNotificationCount > 0}
										<span
											class="absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-4 text-white"
										>
											{Math.min(data.unreadNotificationCount, 9)}
										</span>
									{/if}
								</button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-88 max-w-[calc(100vw-2rem)]">
							<DropdownMenu.Label>
								<div class="flex items-center justify-between gap-3">
									<div>
										<p class="text-sm font-semibold">Reminders</p>
										<p class="text-muted-foreground text-xs">
											Scheduled calls and in-person sessions
										</p>
									</div>
									{#if data.unreadNotificationCount > 0}
										<button
											type="button"
											class="text-xs font-medium text-emerald-700 hover:text-emerald-800"
											onclick={markNotificationsRead}
											disabled={markingNotificationsRead}
										>
											Mark read
										</button>
									{/if}
								</div>
							</DropdownMenu.Label>
							<DropdownMenu.Separator />
							{#if data.notifications.length === 0}
								<div class="px-2 py-6 text-center text-sm text-muted-foreground">
									No reminders yet
								</div>
							{:else}
								{#each data.notifications as notification (notification.id)}
									<DropdownMenu.Item>
										{#snippet child({ props })}
											<a
												{...props}
												href={notification.href ?? '#'}
												class="flex w-full items-start gap-3 rounded-md px-2 py-2.5"
											>
												<span
													class={`mt-1 size-2 rounded-full ${notification.status === 'unread' ? 'bg-emerald-600' : 'bg-stone-300'}`}
												></span>
												<span class="min-w-0 flex-1">
													<span class="block text-sm font-medium leading-5">{notification.title}</span>
													<span class="text-muted-foreground block text-xs leading-5">
														{notification.body}
													</span>
													<span class="text-muted-foreground mt-1 block text-[11px]">
														{formatNotificationTime(notification.createdAt)}
													</span>
												</span>
											</a>
										{/snippet}
									</DropdownMenu.Item>
								{/each}
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<Badge class="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Secure session</Badge>
				</div>
			</div>
		</header>

		<div class="mx-auto w-full max-w-7xl p-4 md:p-6 lg:p-8">
			{@render children()}
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
