import { describe, expect, it } from "vitest";
import { createAdultVerificationApi } from "./adult-verification.ts";
import type { ApiRequest, RowCatTransport } from "./client.ts";

/**
 * Contract boundary of the adult-verification resource, outbound side only.
 * - Neither request may carry a body. A body could attach a verification-case id to the caller's
 *   own attempt, a browser-reported result would open eligibility, and a return URL would be an
 *   open redirect.
 * - The types already reject these, but a type cannot show that an empty object was not sent. The
 *   test therefore inspects the actual outgoing request.
 * - Response validation is covered by the two schemas and by me.test.ts.
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

const START = {
	handoff: {
		kind: "portone-v2",
		storeId: "store-a",
		channelKey: "channel-a",
		identityVerificationId: "server-attempt-123",
		redirectUrl: "https://web.example/account",
	},
	expiresAt: "2026-08-29T10:00:00.000Z",
};

const VIEWER = {
	id: "member-1",
	nickname: "Cat",
	status: "approved",
	role: "user",
	verified: true,
	adult: true,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
};

describe("starting identity verification", () => {
	it("one POST without a body", async () => {
		const { transport, sent } = transportOf(() => START);
		await createAdultVerificationApi(transport).begin();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.method).toBe("POST");
		expect(sent[0]?.path).toBe("/me/adult-verification");
		/** The `body` key must be absent, not present as an empty object. */
		expect("body" in (sent[0] ?? {})).toBe(false);
	});
});

describe("completing verification", () => {
	/**
	 * This is the core of the file. Sending a verification-case id lets the server act on the
	 * client-named verification, and anyone can create such a verification.
	 */
	it("one POST without a body", async () => {
		const { transport, sent } = transportOf(() => VIEWER);
		await createAdultVerificationApi(transport).complete();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.method).toBe("POST");
		expect(sent[0]?.path).toBe("/me/adult-verification/verify");
		expect("body" in (sent[0] ?? {})).toBe(false);
	});

	/** The result is the viewer the server confirmed, not a boolean collapse of it. */
	it("returns the confirmed viewer as is", async () => {
		const { transport } = transportOf(() => VIEWER);
		const viewer = await createAdultVerificationApi(transport).complete();
		expect(viewer.verified).toBe(true);
		expect(viewer.adult).toBe(true);
		/**
		 * Verification does not switch on the adult display flag. The value is what the server returned.
		 */
		expect(viewer.showAdult).toBe(false);
	});

	/**
	 * Does not trust a 200 as-is. This value unlocks adult eligibility, so a mismatched shape that
	 * passed would show eligibility to someone who was never verified.
	 */
	it("does not pass a 200 that breaks the contract", async () => {
		const { transport } = transportOf(() => ({ verified: true, adult: true }));
		await expect(
			createAdultVerificationApi(transport).complete(),
		).rejects.toThrow();
	});
});
