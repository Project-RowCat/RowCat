import type { AnyRouter } from "@tanstack/react-router";
import {
	BUILD_MANIFEST_PATH,
	type BuildFreshness,
	createBuildFreshness,
	navigationLeavesScreen,
	parseBuildManifest,
} from "./freshness.ts";

/**
 * The browser half of build freshness: where the tab's own build id comes from, how the server's is
 * read, which signals ask, and how a stale tab's next screen change becomes a document load. The rules
 * are in `freshness.ts`.
 */

/**
 * The id the build baked in (vite.config.ts `define`). Development has none — the dev server swaps
 * modules itself, and asking would only ever answer with its 404 page. `typeof` keeps an environment
 * without the define (vitest) from throwing on the bare name.
 */
const RUNNING_BUILD_ID: string | null = import.meta.env.DEV
	? null
	: typeof __ROWCAT_BUILD_ID__ === "string"
		? __ROWCAT_BUILD_ID__
		: null;

async function fetchServingBuildId(): Promise<string | null> {
	/**
	 * Same origin, and not the API: the build belongs to the server that served this document, which
	 * is the one a document load would reach. No credentials — the answer is the same for everyone.
	 */
	const response = await fetch(BUILD_MANIFEST_PATH, {
		cache: "no-store",
		credentials: "omit",
		/**
		 * A request a proxy holds open would otherwise stall every later check (they share the one in
		 * flight) and the route error screen's retry, which asks first. Timing out is a failed check.
		 */
		signal: AbortSignal.timeout(BUILD_CHECK_TIMEOUT_MS),
	});
	if (!response.ok) return null;
	return parseBuildManifest(await response.json().catch(() => null));
}

const BUILD_CHECK_TIMEOUT_MS = 3000;

let instance: BuildFreshness | null = null;
let holds = 0;

/**
 * Keeps this tab's navigations client renders while some work is in flight that only an unmount can
 * finish — a reply still streaming (its partial text is saved when the conversation hook unmounts),
 * the draft editor (its last edits are flushed on unmount, in a document that stays alive), runtime
 * playback (its final save is flushed on leaving). A document load would skip all of those: the page
 * is torn down with no unmount, and a write started during `pagehide` is not promised to commit.
 *
 * The switch is only deferred: once the hold is released, the next move to another path loads the
 * new build. Returns the release, idempotent.
 */
export function holdBuildSwitch(): () => void {
	holds += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holds -= 1;
	};
}

/** One per tab: the route error screen asks the same instance the router wiring does. */
export function buildFreshness(): BuildFreshness {
	instance ??= createBuildFreshness({
		runningBuildId: RUNNING_BUILD_ID,
		fetchServingBuildId,
		now: Date.now,
	});
	return instance;
}

/**
 * Wires a tab to its freshness. Returns the undo, for the effect that installed it.
 *
 * ```text
 * asks      before each navigation · tab visible again · window focus · back online   (throttled)
 * asks now  a lazy chunk failed to load (vite:preloadError) — the clearest sign of a new deployment
 * acts      a stale tab's navigation to another path goes through `reloadDocument`
 * ```
 *
 * **The navigation goes through the router's own `reloadDocument`, not `location.assign`**, because
 * that path runs the history blockers first: the draft editor's leave guard still stops a document
 * load while a save is failing, exactly as it stops a client navigation. Back and forward are left as
 * client navigations (they do not pass through `navigate`); the next link press switches.
 *
 * The chunk failure itself is not answered with a reload. It fires for hover preloads as well as for a
 * screen the person opened, and reloading under a hover would throw away whatever was being typed; the
 * route that actually failed has its own way back (`RouteError`'s retry, and the router's one-time
 * reload of a missing route component).
 */
export function installBuildFreshness(
	router: AnyRouter,
	freshness: BuildFreshness,
): () => void {
	const ask = () => void freshness.check();
	const askNow = () => void freshness.check({ force: true });
	const onVisibility = () => {
		if (document.visibilityState === "visible") ask();
	};
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("focus", ask);
	window.addEventListener("online", ask);
	window.addEventListener("vite:preloadError", askNow);
	const unsubscribe = router.subscribe("onBeforeNavigate", ask);

	const navigate = router.navigate;
	router.navigate = ((options) => {
		/**
		 * Left as client navigations: anything while a hold is active (above), and a navigation that
		 * carries history `state` — a document load cannot carry it, and the gallery's origin marker
		 * rides there (`story-return.tsx`); losing it sends 「돌아가기」 to an unfiltered gallery.
		 */
		if (
			!freshness.stale() ||
			options.reloadDocument ||
			holds > 0 ||
			options.state !== undefined
		)
			return navigate(options);
		const next =
			options.href !== undefined
				? new URL(options.href, window.location.href).pathname
				: // The same options `navigate` builds its location from; only the generics differ.
					router.buildLocation(
						options as Parameters<AnyRouter["buildLocation"]>[0],
					).pathname;
		if (!navigationLeavesScreen(router.latestLocation.pathname, next))
			return navigate(options);
		return navigate({ ...options, reloadDocument: true });
	}) as AnyRouter["navigate"];

	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("focus", ask);
		window.removeEventListener("online", ask);
		window.removeEventListener("vite:preloadError", askNow);
		unsubscribe();
		router.navigate = navigate;
	};
}
