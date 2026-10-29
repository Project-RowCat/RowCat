import { describe, expect, it } from "vitest";
import type { ApiRequest, RowCatTransport } from "./client.ts";
import { createModerationApi } from "./moderation.ts";
import { createNotificationsApi } from "./notifications.ts";

/**
 * Contract boundary for `My reports`: what can go out to the reporter.
 * - Outgoing: there must be no slot for naming a member. If `reporterId` or `memberId` could be
 *   sent, 'show Bob's reports' would become expressible, and blocking it would rest on one server
 *   branch.
 * - Incoming: operator-axis fields must not mix into the reporter projection. The test counts the
 *   full key set instead of asserting each field with toBeUndefined(), because a field added later
 *   would pass a per-field check while leaking.
 * - The file runs without Postgres, unlike the API route tests (`describe.skipIf`), so changes
 *   that widen the contract are caught everywhere.
 */

function transportOf(reply: (request: ApiRequest) => unknown): {
	transport: RowCatTransport;
	sent: ApiRequest[];
} {
	const sent: ApiRequest[] = [];
	return {
		sent,
		transport: {
			requestJson: async (request) => {
				sent.push(request);
				return reply(request);
			},
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: () => Promise.reject(new Error("does not write")),
		},
	};
}

const REPORT_ROW = {
	id: "r-1",
	targetType: "story",
	reason: "spam",
	state: "reviewing",
	createdAt: "2026-08-20T00:00:00.000Z",
	reviewedAt: null,
};

const pageOf = (items: unknown[]) => ({ items, nextCursor: null });

/**
 * Axes the public projection must never carry. The client cuts them off even if the server sends
 * them.
 */
const OPERATOR_FIELDS = {
	caseId: "case-1",
	caseReportCount: 17,
	reporterId: "m-alice",
	resolver: "m-operator",
	resolverId: "m-operator",
	resolutionNote: "INTERNAL-NOTE-DO-NOT-LEAK",
	status: "dismissed",
	targetId: "s-1",
	evidence: { type: "story", title: "The Night Library" },
	details: "Description by the reporter",
	actions: [{ id: "a-1", kind: "hide_story" }],
};

describe("My reports: outgoing requests", () => {
	it("the path is `/me/moderation/reports` and defaults are omitted", async () => {
		const { transport, sent } = transportOf(() => pageOf([]));
		await createModerationApi(transport).myReports();

		expect(sent[0]).toMatchObject({
			method: "GET",
			path: "/me/moderation/reports",
		});
		/**
		 * The first page carries neither a cursor nor a count, so the same query does not have two URLs.
		 */
		expect(sent[0]?.search?.toString()).toBe("");
	});

	it("the next page passes the server's cursor as is", async () => {
		const { transport, sent } = transportOf(() => pageOf([]));
		await createModerationApi(transport).myReports({ cursor: "abc" });
		expect(sent[0]?.search?.get("cursor")).toBe("abc");
	});

	/**
	 * No argument can name a member. The type blocks it first (`@ts-expect-error`), and the assertion
	 * below checks the value, so a value passed by mistake cannot silently end up in the query string.
	 */
	it("no parameter can name a reporter", async () => {
		const { transport, sent } = transportOf(() => pageOf([]));
		await createModerationApi(transport).myReports({
			// @ts-expect-error the key is not part of the contract.
			reporterId: "m-bob",
		});
		expect(sent[0]?.search?.has("reporterId")).toBe(false);
		expect(sent[0]?.search?.toString()).toBe("");
	});
});

describe("My reports: incoming responses", () => {
	/** The allowlist has six fields. This array is the exposure boundary for this slice. */
	it("a row has exactly six keys", async () => {
		const { transport } = transportOf(() => pageOf([REPORT_ROW]));
		const page = await createModerationApi(transport).myReports();

		expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
			["createdAt", "id", "reason", "reviewedAt", "state", "targetType"].sort(),
		);
	});

	/**
	 * Operator-axis fields do not enter the model even when attached. Case id, the same target's
	 * report count, handling notes, operator identity, internal dispositions, evidence, and target id
	 * all fail to pass. The test counts keys rather than asserting each one, because a field added
	 * later would leak while per-field assertions still passed.
	 */
	it("operator fields attached are all dropped", async () => {
		const { transport } = transportOf(() =>
			pageOf([{ ...REPORT_ROW, ...OPERATOR_FIELDS }]),
		);
		const page = await createModerationApi(transport).myReports();
		const row = page.items[0];

		expect(Object.keys(row ?? {}).sort()).toEqual(
			["createdAt", "id", "reason", "reviewedAt", "state", "targetType"].sort(),
		);
		/** Checks the serialized string as well, which also covers nested values attached anywhere. */
		const serialized = JSON.stringify(row);
		for (const secret of [
			"INTERNAL-NOTE-DO-NOT-LEAK",
			"case-1",
			"m-operator",
			"m-alice",
			"dismissed",
			"17",
		])
			expect(serialized).not.toContain(secret);
	});

	/**
	 * The vocabulary has only two values. If the server sends internal dispositions as-is (an old
	 * deployment or a wrong projection), this boundary drops the response. Rendering it quietly would
	 * show `dismissed` on screen the moment it arrived.
	 */
	it.each([
		"open",
		"resolved",
		"dismissed",
		"pending",
	])("a response carrying an internal disposition as status does not pass — %s", async (state) => {
		const { transport } = transportOf(() => pageOf([{ ...REPORT_ROW, state }]));
		await expect(createModerationApi(transport).myReports()).rejects.toThrow();
	});

	it("reviewed carries its completion time", async () => {
		const { transport } = transportOf(() =>
			pageOf([
				{
					...REPORT_ROW,
					state: "reviewed",
					reviewedAt: "2026-08-21T00:00:00.000Z",
				},
			]),
		);
		const page = await createModerationApi(transport).myReports();
		expect(page.items[0]?.state).toBe("reviewed");
		expect(page.items[0]?.reviewedAt).toBe("2026-08-21T00:00:00.000Z");
	});
});

describe("notification contract: report_reviewed", () => {
	const ROW = {
		id: "n-report",
		createdAt: "2026-08-20T00:00:00.000Z",
		readAt: null,
		kind: "report_reviewed",
	};

	it("passes with only the four common axes", async () => {
		const { transport } = transportOf(() => pageOf([ROW]));
		const page = await createNotificationsApi(transport).list();
		expect(page.items[0]?.kind).toBe("report_reviewed");
		expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
			["createdAt", "id", "kind", "readAt"].sort(),
		);
	});

	/**
	 * Neither references nor dispositions can attach. Even if the server sends the report id, case id,
	 * target, disposition, or operator, this boundary cuts them. `reportId` matters most: letting it
	 * through would require a new column (a migration), and notifications would start to become
	 * abbreviated copies of the report list.
	 */
	it("report references, dispositions and operators attached are all dropped", async () => {
		const { transport } = transportOf(() =>
			pageOf([
				{
					...ROW,
					reportId: "r-1",
					caseId: "case-1",
					status: "dismissed",
					actor: { id: "m-operator", displayName: "Operator", avatarUrl: null },
					action: {
						id: "a-1",
						kind: "hide_story",
						publicReason: "Policy violation",
					},
				},
			]),
		);
		const page = await createNotificationsApi(transport).list();
		const serialized = JSON.stringify(page.items[0]);
		for (const secret of ["r-1", "case-1", "dismissed", "m-operator", "a-1"])
			expect(serialized).not.toContain(secret);
	});
});
