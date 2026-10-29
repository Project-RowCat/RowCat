import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	isInRollout,
	parseInstallationId,
	ROLLOUT_BUCKETS,
	rolloutBucket,
} from "./rollout.ts";
import { selectRelease } from "./selection.ts";

/** Deterministic rollout: an installation keeps its bucket, and raising the percentage never drops anyone who already has it. */

const installations = Array.from({ length: 4000 }, () => randomUUID());
const RELEASE = "6f9a1f43-3a5f-4f62-8b5f-3a0a4f0e2c11";

describe("buckets", () => {
	it("the same install and release always land in the same bucket", () => {
		for (const id of installations.slice(0, 50))
			expect(rolloutBucket(RELEASE, id)).toBe(rolloutBucket(RELEASE, id));
	});

	it("buckets spread evenly across [0, 10000)", () => {
		const buckets = installations.map((id) => rolloutBucket(RELEASE, id));
		expect(Math.min(...buckets)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...buckets)).toBeLessThan(ROLLOUT_BUCKETS);
		const share =
			buckets.filter((bucket) => bucket < 1000).length / buckets.length;
		expect(share).toBeGreaterThan(0.07);
		expect(share).toBeLessThan(0.13);
	});

	it("10% → 25% keeps the first 10% as is", () => {
		const at10 = installations.filter((id) => isInRollout(RELEASE, id, 10));
		const at25 = new Set(
			installations.filter((id) => isInRollout(RELEASE, id, 25)),
		);
		expect(at10.length).toBeGreaterThan(0);
		for (const id of at10) expect(at25.has(id)).toBe(true);
		expect(at25.size).toBeGreaterThan(at10.length);
	});

	it("0% is nobody and 100% is everybody — even without an identifier", () => {
		for (const id of installations.slice(0, 200)) {
			expect(isInRollout(RELEASE, id, 0)).toBe(false);
			expect(isInRollout(RELEASE, id, 100)).toBe(true);
		}
		expect(isInRollout(RELEASE, null, 100)).toBe(true);
		expect(isInRollout(RELEASE, null, 0)).toBe(false);
	});

	it("an install without an identifier isn't part of a partial rollout", () => {
		expect(isInRollout(RELEASE, null, 99)).toBe(false);
	});

	it("different releases mean different populations", () => {
		const other = "0b1c8d2e-7f6a-4c3b-9e8d-1a2b3c4d5e6f";
		const inA = installations.filter((id) => isInRollout(RELEASE, id, 10));
		const inB = new Set(
			installations.filter((id) => isInRollout(other, id, 10)),
		);
		const overlap = inA.filter((id) => inB.has(id)).length / inA.length;
		// Independent populations overlap by about 10%; reusing the same bucket would give 100%.
		expect(overlap).toBeLessThan(0.3);
	});
});

describe("install identifier", () => {
	it("accepts only UUIDs and folds case", () => {
		const id = randomUUID();
		expect(parseInstallationId(id.toUpperCase())).toBe(id);
		expect(parseInstallationId(` ${id} `)).toBe(id);
		expect(parseInstallationId("")).toBeNull();
		expect(parseInstallationId("member-123")).toBeNull();
		expect(parseInstallationId(undefined)).toBeNull();
	});
});

describe("selection", () => {
	const at = (minutes: number) => new Date(Date.UTC(2026, 9, 3, 0, minutes));
	const release = (
		id: string,
		minutes: number,
		status: "draft" | "active" | "paused" | "rolled_back",
		rolloutPercentage: number,
	) => ({
		id,
		kind: "update" as const,
		status,
		rolloutPercentage,
		createdAt: at(minutes),
	});

	it("gives the newest active one", () => {
		const chosen = selectRelease(
			[release("a", 1, "active", 100), release("b", 2, "active", 100)],
			installations[0] ?? null,
		);
		expect(chosen?.id).toBe("b");
	});

	it("even arriving out of order, time decides", () => {
		const chosen = selectRelease(
			[
				release("b", 2, "active", 100),
				release("a", 1, "active", 100),
			].reverse(),
			null,
		);
		expect(chosen?.id).toBe("b");
	});

	it.each([
		"draft",
		"paused",
		"rolled_back",
	] as const)("a %s release isn't chosen, and the one below it is the answer", (status) => {
		const chosen = selectRelease(
			[release("a", 1, "active", 100), release("b", 2, status, 100)],
			null,
		);
		expect(chosen?.id).toBe("a");
	});

	it("an install outside the rollout gets the older 100% release", () => {
		const b = release("b-partial", 2, "active", 10);
		const outside = installations.find(
			(id) => !isInRollout(b.id, id, 10),
		) as string;
		const inside = installations.find((id) =>
			isInRollout(b.id, id, 10),
		) as string;
		const candidates = [release("a", 1, "active", 100), b];
		expect(selectRelease(candidates, outside)?.id).toBe("a");
		expect(selectRelease(candidates, inside)?.id).toBe("b-partial");
	});

	it("null when there is nothing", () => {
		expect(selectRelease([], null)).toBeNull();
		expect(selectRelease([release("a", 1, "paused", 100)], null)).toBeNull();
	});
});
