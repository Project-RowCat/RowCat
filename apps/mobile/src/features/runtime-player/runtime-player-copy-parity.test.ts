import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	RUNTIME_PLAYER_AI_COPY,
	RUNTIME_PLAYER_COPY,
} from "./runtime-player-copy.ts";

/**
 * Whether the playback screen's trusted copy has the same values in both apps.
 *
 * The copy is duplicated rather than shared because it is product policy, not vocabulary for a
 * shared pure package (`@rowcat/runtime-persistence` is the save domain), and Korean in a pure
 * package would tie the rules to a locale. This file enforces the equivalence instead, as the
 * repository already does for `compareRev`, which is copied across packages and compared by
 * `codec-order.test.ts`.
 *
 * Parity auditing belongs to this app (`lib/parity-boundaries.test.ts` covers the same axis). It
 * only reads the web source and never imports it, which is the point: if this bundle came to know
 * that module, the check would be a dependency, not a parity check.
 *
 * Divergence is silent. When the two apps draw different sentences for the same failure, one work
 * reads as a different product on each platform, and only a side-by-side check shows it. Types,
 * rendering and value tests all still pass.
 */

const WEB_COPY = fileURLToPath(
	new URL(
		"../../../../web/src/lib/i18n/messages/en/runtime-player.ts",
		import.meta.url,
	),
);

/**
 * Extracts every `key: "value"` pair after comments are stripped.
 *
 * Comments are stripped first because the headers of these two files describe their rules in the
 * same sentences (for example `Update the app`). If those characters entered the table, a commit that
 * only edits an explanation would be reported as a parity failure.
 */
function copyEntries(source: string): Map<string, string> {
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
	const entries = new Map<string, string>();
	for (const match of code.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"\s*,/g))
		entries.set(match[1] ?? "", match[2] ?? "");
	return entries;
}

const web = copyEntries(readFileSync(WEB_COPY, "utf8"));

/**
 * Copy that exists only in this app. **The length of this list is the parity value.**
 *
 * A commit adding an entry here claims that the sentence need not exist on the web, and that claim
 * has to be visible in review. There is one entry today because it states a fact that exists only
 * on native: the web has no bridge (its worker fills that role).
 */
const NATIVE_ONLY = new Set<string>(["bridgeUnavailable"]);

describe("playback copy in both apps", () => {
	/**
	 * If this table is empty, the extraction above failed silently and the checks below would pass
	 * forever.
	 */
	it("really reads the web's copy", () => {
		expect(web.size).toBeGreaterThan(10);
		expect(web.get("saveFailed")).toBeDefined();
	});

	/**
	 * Every key this app has also exists on the web, with the same value.
	 *
	 * The reverse direction (keys only on the web) is not checked. The web's state machine is broader
	 * (`transitionBlocked`, for example, is a failure only its lifecycle produces), so locking that
	 * direction would force every new web entry into this app even when no screen here draws it.
	 */
	it("every string in this app equals the web's", () => {
		for (const [key, value] of Object.entries(RUNTIME_PLAYER_COPY)) {
			if (NATIVE_ONLY.has(key)) continue;
			expect(web.has(key), `${key} — missing on the web`).toBe(true);
			expect(web.get(key), key).toBe(value);
		}
	});

	/**
	 * All four AI-notice sentences must match. What this copy guarantees is that a charge occurs; if
	 * only one side is reworded, the two apps explain the same decision differently.
	 */
	it("the AI notice sentences equal the web's", () => {
		for (const [key, value] of Object.entries(RUNTIME_PLAYER_AI_COPY))
			expect(web.get(key), key).toBe(value);
	});

	/**
	 * The semantic side of parity: the copy for the four states the two apps keep apart must exist in
	 * each.
	 *
	 * A version-mismatch failure must not recommend restarting, a failure of the creator's code must
	 * not clear the screen, and the sentence saying that a save failure does not stop play must appear
	 * **on both sides**.
	 */
	/**
	 * Does the exception list contain only keys that exist? If the name of a deleted copy remains, the
	 * list tells the next reader that the key is split on purpose while guarding nothing.
	 */
	it("the native-only list has no dead names", () => {
		for (const key of NATIVE_ONLY) {
			expect(key in RUNTIME_PLAYER_COPY, `${key} — missing in this app`).toBe(
				true,
			);
			expect(web.has(key), `${key} — also on the web`).toBe(false);
		}
	});

	it("copy for the four states exists in this app too", () => {
		expect(RUNTIME_PLAYER_COPY.incompatible).toContain("Update");
		expect(RUNTIME_PLAYER_COPY.creatorError.length).toBeGreaterThan(0);
		expect(RUNTIME_PLAYER_COPY.saveFailedBody).toContain("keep playing");
		expect(RUNTIME_PLAYER_COPY.syncing.length).toBeGreaterThan(0);
	});
});
