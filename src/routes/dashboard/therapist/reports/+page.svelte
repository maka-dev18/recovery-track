<script lang="ts">
	import TherapistDashboard from '../+page.svelte';

	let { data, form }: { data: any; form: any } = $props();
</script>

<TherapistDashboard {data} {form} initialView="reports" />
