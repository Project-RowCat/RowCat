import { describe, expect, it } from "vitest";
import {
	MAX_RESTARTS,
	nextRestartDelay,
	RESTART_DELAYS_MS,
	WINDOW_MS,
} from "./restart-policy.ts";
import { LAUNCH_STAGES, stageScript, statusPageHtml } from "./status-page.ts";
import { restoreBounds } from "./window-state.ts";

const screen = { x: 0, y: 0, width: 1440, height: 875 };
const minimum = { width: 900, height: 600 };

describe("restoreBounds", () => {
	it("keeps a window that sits on a display", () => {
		const saved = {
			bounds: { x: 100, y: 50, width: 1200, height: 800 },
			maximized: false,
		};
		expect(restoreBounds(saved, [screen], minimum)).toEqual(saved);
	});

	// The external monitor it was on is unplugged: those coordinates show nothing.
	it("drops a window on a display that is gone", () => {
		const saved = {
			bounds: { x: 2000, y: 100, width: 1200, height: 800 },
			maximized: false,
		};
		expect(restoreBounds(saved, [screen], minimum)).toBeNull();
	});

	it("drops a window with only a sliver left on screen", () => {
		const saved = {
			bounds: { x: 1400, y: 100, width: 1200, height: 800 },
			maximized: true,
		};
		expect(restoreBounds(saved, [screen], minimum)).toBeNull();
	});

	it("drops a record that is smaller than the window allows, or not a record", () => {
		expect(
			restoreBounds(
				{ bounds: { x: 0, y: 0, width: 300, height: 200 }, maximized: false },
				[screen],
				minimum,
			),
		).toBeNull();
		expect(restoreBounds({ bounds: { x: "0" } }, [screen], minimum)).toBeNull();
		expect(restoreBounds(null, [screen], minimum)).toBeNull();
	});
});

describe("nextRestartDelay", () => {
	it("grows the delay with each restart in the window", () => {
		const now = 1_000_000;
		expect(nextRestartDelay([], now)).toBe(RESTART_DELAYS_MS[0]);
		expect(nextRestartDelay([now - 10], now)).toBe(RESTART_DELAYS_MS[1]);
		expect(nextRestartDelay([now - 20, now - 10], now)).toBe(
			RESTART_DELAYS_MS[2],
		);
	});

	// A server that dies on every start must not restart forever.
	it("gives up after the last allowed restart", () => {
		const now = 1_000_000;
		const recent = Array.from({ length: MAX_RESTARTS }, (_, i) => now - i);
		expect(nextRestartDelay(recent, now)).toBeNull();
	});

	it("forgets restarts older than the window", () => {
		const now = 10 * WINDOW_MS;
		const old = Array.from({ length: MAX_RESTARTS }, () => now - WINDOW_MS);
		expect(nextRestartDelay(old, now)).toBe(RESTART_DELAYS_MS[0]);
	});
});

describe("status page", () => {
	it("lists every launch stage, the first one current", () => {
		const html = statusPageHtml({ kind: "launch" });
		expect(html.match(/<li /g)).toHaveLength(LAUNCH_STAGES.length);
		expect(html).toContain('<li data-state="current">');
	});

	it("moves to a stage by its index", () => {
		expect(stageScript("api")).toContain("setStage(1)");
	});

	it("escapes the message it is given", () => {
		expect(
			statusPageHtml({ kind: "message", title: "<b>", detail: "a & b" }),
		).toContain("&lt;b&gt;");
	});
});
