import { useEffect, useState } from "react";

/**
 * Whether the page background is dark, including the effect of the account theme. The reason
 * `useTheme().scheme` is not used: that value is the device preference (light, dark, or system).
 * When the account theme overrides the background, it diverges from the page's real background.
 * With a light device and a black preset, the editor alone would draw white and the middle of the
 * screen would visibly mismatch.
 *
 * The owner of the effective value already exists: `documentElement.style.colorScheme`
 * (`lib/theme/chrome-scheme.ts`). This hook reads that value instead of deciding again; a second
 * judgment would update on one side only on the day the account palette changes.
 *
 * Observation is needed because that property changes outside React (the theme provider and the
 * account bridge write it directly). A `MutationObserver` wakes only when it changes, unlike
 * polling.
 */
export function useEffectiveDarkScheme(): boolean {
	const [dark, setDark] = useState(false);

	useEffect(() => {
		const root = document.documentElement;
		/**
		 * `colorScheme` is sometimes empty, before the provider has run. Then the class is checked
		 * instead: a pre-hydration script has already set it, so the first frame is also correct.
		 */
		const read = () =>
			setDark(
				root.style.colorScheme === "dark" ||
					(root.style.colorScheme === "" && root.classList.contains("dark")),
			);

		read();
		const observer = new MutationObserver(read);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ["style", "class"],
		});
		return () => observer.disconnect();
	}, []);

	return dark;
}
