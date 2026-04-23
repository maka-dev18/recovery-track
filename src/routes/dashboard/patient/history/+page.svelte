<script lang="ts">
	import PatientDashboard from '../+page.svelte';

	let { data, form }: { data: any; form: any } = $props();
</script>

<PatientDashboard {data} {form} initialView="history" />
