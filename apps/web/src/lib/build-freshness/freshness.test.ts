import { describe, expect, it, vi } from "vitest";
import {
	BUILD_CHECK_MIN_INTERVAL_MS,
	createBuildFreshness,
	navigationLeavesScreen,
	parseBuildManifest,
} from "./freshness.ts";

/** A tab loaded one interval ago, so its first question is due — unless `justLoaded`. */
function harness(
	serving: () => Promise<string | null>,
	runningBuildId: string | null = "a",
	{ justLoaded = false } = {},
) {
	let clock = 1_800_000_000_000;
	const fetchServingBuildId = vi.fn(serving);
	const freshness = createBuildFreshness({
		runningBuildId,
		fetchServingBuildId,
		now: () => clock,
	});
	if (!justLoaded) clock += BUILD_CHECK_MIN_INTERVAL_MS;
	return {
		freshness,
		fetchServingBuildId,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

describe("parseBuildManifest", () => {
	it("reads the id the build wrote", () => {
		expect(parseBuildManifest({ buildId: "0b7e-41c2" })).toBe("0b7e-41c2");
	});

	// A 404 page, a proxy's error document or a truncated body is not an answer.
	it("is nothing for anything else", () => {
		expect(parseBuildManifest(null)).toBeNull();
		expect(parseBuildManifest("0b7e")).toBeNull();
		expect(parseBuildManifest({})).toBeNull();
		expect(parseBuildManifest({ buildId: "" })).toBeNull();
		expect(parseBuildManifest({ buildId: "<html>" })).toBeNull();
		expect(parseBuildManifest({ buildId: "x".repeat(129) })).toBeNull();
	});
});

describe("createBuildFreshness", () => {
	it("is stale once the server serves another build, and stays stale", async () => {
		const { freshness, advance } = harness(async () => "b");
		expect(freshness.stale()).toBe(false);
		await expect(freshness.check()).resolves.toBe(true);
		expect(freshness.stale()).toBe(true);
		advance(BUILD_CHECK_MIN_INTERVAL_MS);
		await freshness.check();
		expect(freshness.stale()).toBe(true);
	});

	it("is not stale while the server serves this build", async () => {
		const { freshness } = harness(async () => "a");
		await expect(freshness.check()).resolves.toBe(false);
	});

	// Offline, an error page, a deployment mid-swap: nothing is learned, nothing changes.
	it("learns nothing from a failed or unreadable answer", async () => {
		const failing = harness(async () => {
			throw new TypeError("Failed to fetch");
		});
		await expect(failing.freshness.check()).resolves.toBe(false);
		const unreadable = harness(async () => null);
		await expect(unreadable.freshness.check()).resolves.toBe(false);
	});

	it("asks at most once per interval, unless a chunk just failed", async () => {
		const { freshness, fetchServingBuildId, advance } = harness(
			async () => "a",
		);
		await freshness.check();
		await freshness.check();
		expect(fetchServingBuildId).toHaveBeenCalledTimes(1);
		await freshness.check({ force: true });
		expect(fetchServingBuildId).toHaveBeenCalledTimes(2);
		advance(BUILD_CHECK_MIN_INTERVAL_MS - 1);
		await freshness.check();
		expect(fetchServingBuildId).toHaveBeenCalledTimes(2);
		advance(1);
		await freshness.check();
		expect(fetchServingBuildId).toHaveBeenCalledTimes(3);
	});

	it("asks again after the clock moved backwards", async () => {
		const { freshness, fetchServingBuildId, advance } = harness(
			async () => "a",
		);
		await freshness.check();
		advance(-60_000);
		await freshness.check();
		expect(fetchServingBuildId).toHaveBeenCalledTimes(2);
	});

	// The document was just served by the serving build; the hydration navigation must not ask.
	it("does not ask right after the page loaded, unless a chunk failed", async () => {
		const { freshness, fetchServingBuildId } = harness(async () => "b", "a", {
			justLoaded: true,
		});
		await expect(freshness.check()).resolves.toBe(false);
		expect(fetchServingBuildId).not.toHaveBeenCalled();
		await expect(freshness.check({ force: true })).resolves.toBe(true);
	});

	it("keeps one request in flight", async () => {
		let answer: (id: string) => void = () => {};
		const { freshness, fetchServingBuildId } = harness(
			() => new Promise((resolve) => (answer = resolve)),
		);
		const first = freshness.check();
		const second = freshness.check({ force: true });
		answer("b");
		await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
		expect(fetchServingBuildId).toHaveBeenCalledTimes(1);
	});

	// Development and tests run without a baked id; there is nothing to compare against.
	it("never asks without a build id of its own", async () => {
		const { freshness, fetchServingBuildId } = harness(async () => "b", null);
		await expect(freshness.check({ force: true })).resolves.toBe(false);
		expect(fetchServingBuildId).not.toHaveBeenCalled();
	});

	it("stops asking once it knows", async () => {
		const { freshness, fetchServingBuildId } = harness(async () => "b");
		await freshness.check();
		await freshness.check({ force: true });
		expect(fetchServingBuildId).toHaveBeenCalledTimes(1);
	});
});

describe("navigationLeavesScreen", () => {
	it("is a change of path", () => {
		expect(navigationLeavesScreen("/chats", "/chat/r1")).toBe(true);
		expect(navigationLeavesScreen("/settings", "/settings/ai")).toBe(true);
	});

	// A tab switch in the address, or password reset stripping its token, keeps the screen — and
	// the value that screen holds in memory.
	it("is not a change of search or hash on the same path", () => {
		expect(navigationLeavesScreen("/create", "/create")).toBe(false);
		expect(navigationLeavesScreen("/reset-password", "/reset-password")).toBe(
			false,
		);
	});
});
