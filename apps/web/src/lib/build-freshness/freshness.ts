/**
 * Whether this tab still runs the build the server serves — the pure half (no DOM, no router).
 *
 * A deployment replaces the server while open tabs keep running the JavaScript they loaded. That old
 * code keeps working until it asks for something the new deployment no longer has: a lazy chunk whose
 * hashed file is gone (a 404), or an API shape it does not know. The fix is the newest code, and the
 * newest code is one document load away — the question is only *when* that load costs nothing.
 *
 * ```text
 * this tab      BUILD_ID baked into the bundle at build time (vite.config.ts)
 * the server    /rowcat-build.json, written by the same build, never cached
 * different  →  the next move to another screen is a document load instead of a client render
 * ```
 *
 * **The switch rides a navigation the person already made**, because leaving a screen is the moment
 * its state is let go anyway. Nothing reloads under someone: not mid-generation, not mid-playback, not
 * with a composer half written. What is not done here, and why:
 *
 * - **No banner or toast.** An announcement that asks the person to reload makes them decide something
 *   that has a free answer, and the shell has no slot for it (`ShellUtility` is three items).
 * - **No reload on focus or on a timer.** A tab coming back to the front is exactly when its state
 *   matters; reloading it there is losing what was on screen.
 * - **A screen that stays (a search change, a token stripped from the address) stays.** Those are
 *   replace-navigations on the same path, and some hold the only copy of a value (password reset moves
 *   its token into state before stripping it) — a document load there would throw it away.
 *
 * The build id is not a version. It names one build output, it is never shown, and it is compared only
 * for equality: a rollback to an older image is just as much "another build".
 */

/** Where the build writes its id. Outside `/assets/` (immutable for a year) on purpose. */
export const BUILD_MANIFEST_PATH = "/rowcat-build.json";

/**
 * How often a tab asks, at most. Asking happens on navigation, focus, visibility and reconnect — never
 * on a timer — so a tab nobody touches makes no requests; this only folds bursts of those signals.
 */
export const BUILD_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;

const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** `{ "buildId": "…" }` or nothing. A 404 page, a proxy's error HTML or a truncated body are nothing. */
export function parseBuildManifest(value: unknown): string | null {
	if (typeof value !== "object" || value === null) return null;
	const buildId = (value as { buildId?: unknown }).buildId;
	return typeof buildId === "string" && BUILD_ID_PATTERN.test(buildId)
		? buildId
		: null;
}

export interface BuildFreshness {
	/** True once the server served a different build than this tab runs. It never turns back. */
	stale(): boolean;
	/**
	 * Asks the server, at most once per interval unless `force` (a chunk just failed to load). One
	 * request at a time; never throws — a failed check is not news, and leaves the tab as it was.
	 */
	check(options?: { force?: boolean }): Promise<boolean>;
}

interface BuildFreshnessOptions {
	/** This tab's build. `null` (development, tests) means there is nothing to compare. */
	runningBuildId: string | null;
	/** The server's build id, or `null` when it could not be read. */
	fetchServingBuildId: () => Promise<string | null>;
	now: () => number;
	minIntervalMs?: number;
}

export function createBuildFreshness({
	runningBuildId,
	fetchServingBuildId,
	now,
	minIntervalMs = BUILD_CHECK_MIN_INTERVAL_MS,
}: BuildFreshnessOptions): BuildFreshness {
	let stale = false;
	/**
	 * Creation counts as an answer: the document this tab runs was just served by the build that is
	 * serving, so asking at once (the router's first navigation fires at hydration) would spend a request
	 * on every page load to learn nothing. The first real question comes one interval later, or at once
	 * when a chunk fails.
	 */
	let lastAskedAt = now();
	let inFlight: Promise<boolean> | null = null;

	const ask = async () => {
		lastAskedAt = now();
		try {
			const serving = await fetchServingBuildId();
			if (serving !== null && serving !== runningBuildId) stale = true;
		} catch {
			// Offline, a proxy error, a deployment mid-swap: the next signal asks again.
		}
		return stale;
	};

	return {
		stale: () => stale,
		check: ({ force = false } = {}) => {
			if (runningBuildId === null || stale) return Promise.resolve(stale);
			if (inFlight) return inFlight;
			const at = now();
			const due =
				force || at < lastAskedAt || at - lastAskedAt >= minIntervalMs;
			if (!due) return Promise.resolve(stale);
			inFlight = ask().finally(() => {
				inFlight = null;
			});
			return inFlight;
		},
	};
}

/**
 * Whether a navigation leaves the current screen — the only kind a stale tab turns into a document
 * load. Same path means the same screen with another search or hash, and it stays a client render.
 */
export function navigationLeavesScreen(
	currentPathname: string,
	nextPathname: string,
): boolean {
	return currentPathname !== nextPathname;
}
