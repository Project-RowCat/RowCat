import { dekForViewer, type McpConfig } from "./config.ts";

/**
 * What `setup` should do next, decided by one pure function.
 *
 * ```text
 * logged in?
 *   no  -> login
 *   yes -> does this account's envelope key exist?
 *            yes -> ready
 *            no  -> pair
 * ```
 *
 * `setup` chains several commands, which makes it easy to re-write the auth and ownership rules
 * there; such a copy errs toward looser, and what opens then is someone else's drafts. The decision
 * therefore lives here and rests on the same predicate `serve` and `doctor` use (`dekForViewer`).
 *
 * A locked state answers `pair`, not `unlock`: asking someone with a connected device to approve a
 * code there is shorter than fetching the recovery code. People with no trusted device still have
 * `unlock`, and that fork is theirs to choose.
 */

export type SetupStep =
	| "login"
	| "pair"
	/** Nothing to do; `setup` does not start pairing. */
	| "ready";

/**
 * A `null` viewer means both "not logged in" and "session died"; the next step is the same. A key
 * with a different owner, or no recorded owner, counts as locked (`dekForViewer`).
 */
export function planSetup(
	config: McpConfig,
	viewer: { readonly id: string } | null,
): SetupStep {
	if (viewer === null) return "login";
	return dekForViewer(config, viewer.id).ok ? "ready" : "pair";
}
