import { describe, expect, it } from "vitest";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";
import {
	resolveDraftEditorState,
	resolveDraftListState,
} from "./create-home-state.ts";

/**
 * State ordering for the drafts tab and the editor. Mistakes are silent: someone with a pile of
 * manuscripts sees "No stories yet", a read failure draws as zero rows, or a person who never signed
 * out sees the sign-in screen.
 */

const list = (
	phase: MobileAppPhase,
	status: LocalLiveStatus = "ready",
	total = 0,
) => resolveDraftListState({ phase, drafts: { status, total } });

describe("Drafts", () => {
	// Identity and storage come first: renders where the previous member's list is still in state
	// really happen.
	it("a guest gets the sign-in notice", () => {
		expect(list("guest", "ready", 5).kind).toBe("guest");
	});

	// Not a sign-out: the stored session is intact; we just could not ask.
	it("a failed check isn't a guest", () => {
		expect(list("unavailable").kind).toBe("unavailable");
	});

	it("a storage failure offers a scope retry", () => {
		expect(list("local-error").kind).toBe("storage-error");
	});

	// Opening and zero rows are different facts; merging shows a blank screen to someone with
	// manuscripts.
	it("opening isn't an empty list", () => {
		expect(list("opening").kind).toBe("booting");
		expect(list("ready", "loading").kind).toBe("loading");
	});

	it("a read failure isn't an empty list", () => {
		expect(list("ready", "error", 0).kind).toBe("read-error");
	});

	/**
	 * Held values are not cleared: emptying the received list on a background refresh failure makes
	 * the user see their manuscripts vanish while storage is fine.
	 */
	it("with held values it draws the list even on failure", () => {
		expect(list("ready", "error", 3).kind).toBe("list");
	});

	it("only a genuine zero is the empty state", () => {
		expect(list("ready", "ready", 0).kind).toBe("empty");
		expect(list("ready", "ready", 1).kind).toBe("list");
	});
});

const editor = (
	phase: MobileAppPhase,
	status: LocalLiveStatus = "ready",
	found = false,
) => resolveDraftEditorState({ phase, draft: { status, found } });

describe("editor", () => {
	it("identity and storage come first", () => {
		expect(editor("guest", "ready", true).kind).toBe("guest");
		expect(editor("unavailable").kind).toBe("unavailable");
		expect(editor("local-error").kind).toBe("storage-error");
		expect(editor("opening").kind).toBe("booting");
	});

	/**
	 * A missing draft is not a failure (deleted, another device's not arrived yet, or a hand-edited
	 * deep link). It must stay separate from `read-error` so the screen draws different actions (retry
	 * vs go create).
	 */
	it("a missing draft and a read failure differ", () => {
		expect(editor("ready", "ready", false).kind).toBe("missing");
		expect(editor("ready", "error", false).kind).toBe("read-error");
	});

	it("reading isn't missing", () => {
		expect(editor("ready", "loading", false).kind).toBe("loading");
	});

	// With a held draft, a background refresh failure does not empty the editor.
	it("with a held draft it's the editor even on failure", () => {
		expect(editor("ready", "error", true).kind).toBe("ready");
		expect(editor("ready", "loading", true).kind).toBe("ready");
	});
});
