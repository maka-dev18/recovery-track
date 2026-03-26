<script lang="ts">
	type Point = {
		label: string;
		value: number;
	};

	let {
		data = [],
		height = 88,
		stroke = '#2563eb',
		fill = 'rgba(37, 99, 235, 0.12)',
		className = ''
	}: {
		data?: Point[];
		height?: number;
		stroke?: string;
		fill?: string;
		className?: string;
	} = $props();

	const width = 320;

	function normalize(values: Point[]) {
		if (values.length === 0) {
			return {
				polyline: '',
				area: '',
				min: 0,
				max: 0
			};
		}

		const min = Math.min(...values.map((value) => value.value));
		const max = Math.max(...values.map((value) => value.value));
		const range = Math.max(1, max - min);
		const stepX = values.length === 1 ? width / 2 : width / (values.length - 1);
		const points = values.map((entry, index) => {
			const x = values.length === 1 ? width / 2 : index * stepX;
			const y = height - ((entry.value - min) / range) * (height - 12) - 6;
			return `${x},${y}`;
		});

		return {
			polyline: points.join(' '),
			area: `0,${height} ${points.join(' ')} ${width},${height}`,
			min,
			max
		};
	}

	const chart = $derived(normalize(data));
</script>

<div class={`space-y-2 ${className}`}>
	<div class="text-muted-foreground flex items-center justify-between text-xs">
		<span>{data[0]?.label ?? 'No data'}</span>
		<span>{data.at(-1)?.label ?? ''}</span>
	</div>
	<svg viewBox={`0 0 ${width} ${height}`} class="h-[88px] w-full overflow-visible">
		{#if data.length > 1}
			<polygon points={chart.area} fill={fill} />
			<polyline
				points={chart.polyline}
				fill="none"
				stroke={stroke}
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{:else if data.length === 1}
			<circle cx={width / 2} cy={height / 2} r="5" fill={stroke} />
		{:else}
			<text x="50%" y="50%" text-anchor="middle" class="fill-slate-400 text-xs">No data</text>
		{/if}
	</svg>
	<div class="text-muted-foreground flex items-center justify-between text-xs">
		<span>Min {Math.round(chart.min)}</span>
		<span>Max {Math.round(chart.max)}</span>
	</div>
</div>
