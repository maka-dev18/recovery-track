<script lang="ts">
	import AdminDashboard from '../+page.svelte';

	let { data, form }: { data: any; form: any } = $props();
</script>

<AdminDashboard {data} {form} initialView="history" />
