<script lang="ts">
	import AssociateDashboard from '../+page.svelte';

	let { data, form }: { data: any; form: any } = $props();
</script>

<AssociateDashboard {data} {form} initialView="patients" />
