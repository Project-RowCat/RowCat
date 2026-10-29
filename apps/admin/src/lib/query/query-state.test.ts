import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	type AdminQueryStatus,
	adminQueryView,
	unreachableFailure,
} from "./query-state.ts";

/**
 * Every defect caught here is silent — the screen renders and the operator misreads it: a pause
 * drawn as loading spins forever, an unreachable failure makes them suspect the server, a stale
 * value drawn plainly gets acted on, and erasing a stale value loses a server-confirmed one.
 */

const status = (patch: Partial<AdminQueryStatus> = {}): AdminQueryStatus => ({
	hasData: false,
	isEmpty: false,
	isPaused: false,
	isError: false,
	isPending: false,
	unreachable: false,
	...patch,
});

describe("when no value is held", () => {
	it("loading while in progress", () => {
		expect(adminQueryView(status({ isPending: true }))).toEqual({
			state: "loading",
			staleness: "fresh",
		});
	});

	/** A paused query is still `isPending`; checked after loading it would spin forever. */
	it("paused is a connection failure, not loading", () => {
		expect(adminQueryView(status({ isPaused: true, isPending: true }))).toEqual(
			{ state: "offline", staleness: "fresh" },
		);
	});

	it("a failure that never reached the server is a connection failure", () => {
		expect(
			adminQueryView(status({ isError: true, unreachable: true })),
		).toEqual({ state: "offline", staleness: "fresh" });
	});

	it("a failure the server answered is a failure", () => {
		expect(adminQueryView(status({ isError: true }))).toEqual({
			state: "error",
			staleness: "fresh",
		});
	});

	/** The most expensive misreading in this app. */
	it("failure does not fold into the empty state", () => {
		expect(adminQueryView(status({ isError: true, isEmpty: true })).state).toBe(
			"error",
		);
	});
});

describe("when a value is held", () => {
	it("draws it as is when healthy", () => {
		expect(adminQueryView(status({ hasData: true }))).toEqual({
			state: "ready",
			staleness: "fresh",
		});
	});

	it("empty only when really empty", () => {
		expect(adminQueryView(status({ hasData: true, isEmpty: true })).state).toBe(
			"empty",
		);
	});

	it("draws the value even when a background refresh fails, and says it is stale", () => {
		expect(adminQueryView(status({ hasData: true, isError: true }))).toEqual({
			state: "ready",
			staleness: "failed",
		});
	});

	it("a disconnected refresh failure gets a different sentence", () => {
		expect(
			adminQueryView(
				status({ hasData: true, isError: true, unreachable: true }),
			),
		).toEqual({ state: "ready", staleness: "offline" });
	});

	it("a paused refresh does not erase the value either", () => {
		expect(adminQueryView(status({ hasData: true, isPaused: true }))).toEqual({
			state: "ready",
			staleness: "offline",
		});
	});

	/** An empty list can be stale too — "none" must say whether it is current. */
	it("staleness attaches to the empty state too", () => {
		expect(
			adminQueryView(status({ hasData: true, isEmpty: true, isError: true })),
		).toEqual({ state: "empty", staleness: "failed" });
	});
});

describe("properties of failures", () => {
	it("API errors are not connection failures", () => {
		const error = new RowCatApiError({
			status: 500,
			code: "internal",
			message: "server error",
		});
		expect(unreachableFailure(error)).toBe(false);
	});

	it("a failure fetch threw is a connection failure", () => {
		expect(unreachableFailure(new TypeError("Failed to fetch"))).toBe(true);
	});

	/** No error, no classification — a past failure must not speak for current freshness. */
	it("false without an error", () => {
		expect(unreachableFailure(null)).toBe(false);
		expect(unreachableFailure(undefined)).toBe(false);
	});
});
