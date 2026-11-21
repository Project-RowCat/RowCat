import { describe, expect, it } from "vitest";
import { decideInbound } from "./merge.ts";

const local = (dirty: 0 | 1, serverVersion: number) => ({
	id: "r1",
	rev: { t: 2000, c: 0, d: "a" },
	dirty,
	serverVersion,
	deletedAt: null,
	updatedAt: "2026-01-01T00:00:00Z",
});
const older = { t: 1000, c: 0, d: "b" };

describe("decideInbound", () => {
	it("an older revision is a replay by default", () => {
		expect(
			decideInbound(local(1, 3), { deleted: false, rev: older, version: 4 }),
		).toEqual({ action: "replay" });
	});

	it("an older but unseen copy against an unsent edit is concurrent for kinds that merge it", () => {
		expect(
			decideInbound(local(1, 3), {
				deleted: false,
				rev: older,
				version: 4,
				mergeConcurrent: true,
			}),
		).toEqual({ action: "merge" });
	});

	it("a copy already seen, or no local edit pending, stays a replay", () => {
		expect(
			decideInbound(local(1, 4), {
				deleted: false,
				rev: older,
				version: 4,
				mergeConcurrent: true,
			}),
		).toEqual({ action: "replay" });
		expect(
			decideInbound(local(0, 3), {
				deleted: false,
				rev: older,
				version: 4,
				mergeConcurrent: true,
			}),
		).toEqual({ action: "replay" });
		expect(
			decideInbound(local(1, 3), {
				deleted: false,
				rev: older,
				mergeConcurrent: true,
			}),
		).toEqual({
			action: "replay",
		});
	});

	it("tombstones and deleted locals are unaffected", () => {
		expect(
			decideInbound(local(1, 3), {
				deleted: true,
				rev: null,
				mergeConcurrent: true,
			}),
		).toEqual({
			action: "delete",
		});
		expect(
			decideInbound(
				{ ...local(1, 3), deletedAt: "x" },
				{ deleted: false, rev: older, version: 9, mergeConcurrent: true },
			),
		).toEqual({ action: "keep-deleted" });
	});
});
