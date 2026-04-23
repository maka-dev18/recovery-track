type KeepLatestOptions = {
	threshold?: number;
};

const DEFAULT_THRESHOLD = 96;

export function keepLatestMessagePinned(node: HTMLElement, options: KeepLatestOptions = {}) {
	let threshold = options.threshold ?? DEFAULT_THRESHOLD;
	let stickyToLatest = true;
	let firstFrame: number | null = null;
	let secondFrame: number | null = null;

	function distanceFromLatest() {
		return node.scrollHeight - node.scrollTop - node.clientHeight;
	}

	function isNearLatest() {
		return distanceFromLatest() <= threshold;
	}

	function cancelPendingScroll() {
		if (firstFrame !== null) {
			cancelAnimationFrame(firstFrame);
			firstFrame = null;
		}
		if (secondFrame !== null) {
			cancelAnimationFrame(secondFrame);
			secondFrame = null;
		}
	}

	function scrollToLatest() {
		node.scrollTop = node.scrollHeight;
	}

	function scheduleScrollToLatest(force = false) {
		cancelPendingScroll();

		firstFrame = requestAnimationFrame(() => {
			firstFrame = null;
			if (!force && !stickyToLatest) {
				return;
			}

			scrollToLatest();

			secondFrame = requestAnimationFrame(() => {
				secondFrame = null;
				if (force || stickyToLatest || isNearLatest()) {
					scrollToLatest();
				}
			});
		});
	}

	function handleScroll() {
		stickyToLatest = isNearLatest();
	}

	const mutationObserver = new MutationObserver(() => {
		scheduleScrollToLatest();
	});
	mutationObserver.observe(node, {
		childList: true,
		subtree: true,
		characterData: true
	});

	const resizeObserver = new ResizeObserver(() => {
		scheduleScrollToLatest();
	});
	resizeObserver.observe(node);

	node.addEventListener('scroll', handleScroll, { passive: true });
	scheduleScrollToLatest(true);

	return {
		update(nextOptions: KeepLatestOptions = {}) {
			threshold = nextOptions.threshold ?? DEFAULT_THRESHOLD;
			stickyToLatest = stickyToLatest || isNearLatest();
			scheduleScrollToLatest();
		},
		destroy() {
			cancelPendingScroll();
			mutationObserver.disconnect();
			resizeObserver.disconnect();
			node.removeEventListener('scroll', handleScroll);
		}
	};
}
