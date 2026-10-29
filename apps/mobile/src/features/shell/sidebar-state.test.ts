import { describe, expect, it } from "vitest";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";
import { resolveSidebarRecentState } from "./sidebar-state.ts";

const at = (
	phase: MobileAppPhase,
	status: LocalLiveStatus = "ready",
	total = 3,
) => resolveSidebarRecentState({ phase, rooms: { status, total } }).kind;

describe("identity and storage come first", () => {
	/**
	 * A placeholder for a guest would **never finish**: there is no store to open. `unavailable` is
	 * the same cell for a different reason: the stored session is still there and we simply could not
	 * ask, so the list cannot be promised here.
	 */
	it.each(["guest", "unavailable"] as const)("%s has no section", (phase) => {
		expect(at(phase)).toBe("hidden");
	});

	it("a placeholder before session and storage are settled", () => {
		expect(at("booting")).toBe("loading");
		expect(at("opening")).toBe("loading");
	});

	/** Not opening the store and having no conversations are different facts. */
	it("states the failure when storage can't open", () => {
		expect(at("local-error")).toBe("error");
	});

	/**
	 * Right after an account change, the previous member's rooms can still be in state for one render.
	 * The order above exists so that render does not draw another person's conversation titles in the
	 * drawer.
	 */
	it("identity wins even with a held list", () => {
		expect(at("guest", "ready", 12)).toBe("hidden");
		expect(at("local-error", "ready", 12)).toBe("error");
	});
});

describe("list", () => {
	it("reading differs from zero", () => {
		expect(at("ready", "loading", 0)).toBe("loading");
	});

	/**
	 * **Keep the loaded value.** When a background refresh fails, emptying the list already fetched
	 * would make the user see their conversations vanish even though the store is fine.
	 */
	it("a background refresh failure doesn't erase the held list", () => {
		expect(at("ready", "error", 5)).toBe("rooms");
		expect(at("ready", "error", 0)).toBe("error");
	});

	it("genuinely none is the empty state", () => {
		expect(at("ready", "ready", 0)).toBe("empty");
	});

	it("draws rows when there are some", () => {
		expect(at("ready", "ready", 1)).toBe("rooms");
	});
});
