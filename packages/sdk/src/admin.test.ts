import { describe, expect, it } from "vitest";
import { createAdminApi } from "./admin.ts";
import type { ApiRequest, RowCatTransport } from "./client.ts";

/**
 * Wire contract and transport for the operator console. This file differs from the route tests in
 * one way. The route tests skip without a real Postgres (describe.skipIf); this file always runs.
 * So the contract's guards must be here too. If a CI without a database lost this file, the net
 * would disappear entirely.
 */

function transportOf(response: unknown): {
	transport: RowCatTransport;
	sent: ApiRequest[];
} {
	const sent: ApiRequest[] = [];
	return {
		sent,
		transport: {
			requestJson: async (request) => {
				sent.push(request);
				return response;
			},
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: () => Promise.reject(new Error("does not write")),
		},
	};
}

describe("AdminApi.deleteStory", () => {
	it("POSTs one reason and returns the result", async () => {
		const { transport, sent } = transportOf({ outcome: "deleted" });
		const result = await createAdminApi(transport).deleteStory("s/1", {
			reason: "  Creator request  ",
		});
		expect(result).toEqual({ outcome: "deleted" });
		expect(sent[0]).toMatchObject({
			method: "POST",
			path: "/admin/stories/s%2F1/delete",
			/** Input trimming belongs to the contract, so the values sent are the ones the server reads. */
			body: { reason: "Creator request" },
		});
	});

	/**
	 * Fields outside the contract are rejected before sending. A field that selects the outcome cannot
	 * be expressed at all, because one that got sent would reach the network.
	 */
	it("refuses fields outside the contract before sending", async () => {
		const { transport, sent } = transportOf({ outcome: "deleted" });
		await expect(
			createAdminApi(transport).deleteStory("s1", {
				reason: "request",
				outcome: "deleted",
			} as never),
		).rejects.toThrow();
		expect(sent).toHaveLength(0);
	});

	it("does not pass an unknown outcome", async () => {
		const { transport } = transportOf({ outcome: "detached" });
		await expect(
			createAdminApi(transport).deleteStory("s1", { reason: "request" }),
		).rejects.toMatchObject({ code: "invalid_response" });
	});
});
