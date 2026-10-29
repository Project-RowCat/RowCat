import type { ConversationAuthoringMode } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import type { MobileAppPhase } from "../../lib/session-state.ts";
import {
	type PlaytestSourceStatus,
	resolvePlaytestScreenState,
} from "./playtest-state.ts";

/**
 * Screen-state decision. **A mistake here is always silent.**
 *
 * Drawing "this draft is not in this account" while the store is still opening makes the creator
 * read their manuscript as lost. Folding a session-check failure into guest pushes a sign-in onto
 * someone who never signed out. Neither raises an error.
 */

const kindOf = (
	phase: MobileAppPhase,
	source: PlaytestSourceStatus,
	/** Most branches do not depend on the execution model; an ordinary conversation draft is the default. */
	authoring: ConversationAuthoringMode = "editable",
) => resolvePlaytestScreenState({ phase, source, authoring }).kind;

describe("identity and storage come first", () => {
	/**
	 * **This holds even when a read result has already arrived.** There is a real render where the
	 * previous member's draft is still in state at the moment the account changes, and that render
	 * would draw someone else's manuscript.
	 */
	it("guest, unchecked and storage failure beat the read result", () => {
		for (const source of ["loading", "missing", "ready"] as const) {
			expect(kindOf("guest", source)).toBe("guest");
			expect(kindOf("unavailable", source)).toBe("unavailable");
			expect(kindOf("local-error", source)).toBe("storage-error");
		}
	});

	/**
	 * **Opening the store is not `missing`.** During that window bootstrap can answer `missing` (the
	 * same value as guest). If the screen drew it as-is, someone who opens the app via a deep link
	 * would see the "no such draft" screen every time.
	 */
	it("booting and storage opening are a neutral wait", () => {
		for (const source of ["loading", "missing", "ready"] as const) {
			expect(kindOf("booting", source)).toBe("booting");
			expect(kindOf("opening", source)).toBe("booting");
		}
	});
});

describe("after the storage opens", () => {
	it("reading is loading — different from missing", () => {
		expect(kindOf("ready", "loading")).toBe("loading");
	});

	it("missing on this account is missing", () => {
		expect(kindOf("ready", "missing")).toBe("missing");
	});

	it("read means ready", () => {
		expect(kindOf("ready", "ready")).toBe("ready");
	});
});

/**
 * **A draft with the runtime on has nothing to test through conversation.**
 *
 * Before this branch existed, that draft's test screen was an **empty conversation** with no
 * opening and no prompt. It was not a failure, just a screen with nothing to test, so no error and
 * no failing test surfaced.
 */
describe("execution model", () => {
	it("with the runtime on it draws that fact rather than a conversation", () => {
		expect(kindOf("ready", "ready", "locked")).toBe("runtime");
	});

	/** While still unknown, folding to conversation would show that empty conversation for a frame. */
	it("while still unknown it draws neither", () => {
		expect(kindOf("ready", "ready", "pending")).toBe("loading");
	});

	/**
	 * **A missing draft comes first.** Describing the execution model of a draft that could not be
	 * read explains a document that does not exist, and that screen has no way out.
	 */
	it("a missing draft comes before the execution model", () => {
		for (const authoring of ["pending", "locked"] as const)
			expect(kindOf("ready", "missing", authoring)).toBe("missing");
	});

	/**
	 * Identity and the store come first here too: there is a render where the previous member's
	 * project is still in state at the moment the account changes.
	 */
	it("guest, unchecked and storage failure beat the execution model", () => {
		expect(kindOf("guest", "ready", "locked")).toBe("guest");
		expect(kindOf("unavailable", "ready", "locked")).toBe("unavailable");
		expect(kindOf("local-error", "ready", "locked")).toBe("storage-error");
	});
});
