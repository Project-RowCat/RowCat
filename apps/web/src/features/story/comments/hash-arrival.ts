import { useEffect, useRef } from "react";

/**
 * Stays on the comments section when the page arrives via `#comments`, even if content above grows.
 *
 * - The router's hash scroll runs once, at navigation. Some content above the comments section
 *   (related works, which reserve no space on purpose so that an empty one leaves nothing behind)
 *   arrives late and pushes the section off-screen.
 * - So for a short window after arrival, the section is re-aligned to the top whenever the
 *   document height changes.
 * - The window closes at whichever comes first. A person scrolls on their own (wheel, touch, or
 *   key), after which pulling would take away the reading position; or `HASH_ARRIVAL_SETTLE_MS`
 *   elapses, so late content is not awaited forever.
 * - This function decides only when to align. The scroll itself is the browser's scrollIntoView
 *   and is instant regardless of reduced-motion settings, since there is no animation.
 */
export const HASH_ARRIVAL_SETTLE_MS = 2_500;

export const HASH_ARRIVAL_RELEASE_EVENTS = [
	"wheel",
	"touchstart",
	"keydown",
	"pointerdown",
] as const;

export const arrivedAtHash = (hash: string, anchor: string): boolean =>
	hash.replace(/^#/, "") === anchor;

export function useHashArrival<T extends HTMLElement>(
	anchor: string,
): React.RefObject<T | null> {
	const ref = useRef<T | null>(null);

	useEffect(() => {
		if (!arrivedAtHash(window.location.hash, anchor)) return;
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;

		let released = false;
		const pin = () => {
			if (!released) element.scrollIntoView({ block: "start" });
		};
		const release = () => {
			released = true;
			observer.disconnect();
			for (const type of HASH_ARRIVAL_RELEASE_EVENTS)
				window.removeEventListener(type, release, true);
			window.clearTimeout(timer);
		};

		const observer = new ResizeObserver(pin);
		observer.observe(document.body);
		for (const type of HASH_ARRIVAL_RELEASE_EVENTS)
			window.addEventListener(type, release, { capture: true, passive: true });
		const timer = window.setTimeout(release, HASH_ARRIVAL_SETTLE_MS);
		pin();
		return release;
	}, [anchor]);

	return ref;
}
