import { describe, expect, it, vi } from "vitest";
import { readIdentityReturn, runIdentityHandoff } from "./handoff.ts";

/**
 * Identity handoff: which branch each outcome falls into.
 *
 * When this judgment is wrong, the symptoms are all silent:
 * - navigating treated as completed: an error flashes on a screen that is leaving, then vanishes.
 * - cancelled treated as failed: a person who closed the window themselves starts doubting their
 *   device.
 * - unsupported treated as passed: an arbitrary window opens instead of the verifier the
 *   deployment changed to.
 * - reading the value from the return URL: opens a path that attaches someone else's verification
 *   attempt to one's own request.
 *
 * The SDK and location are both injected. Calling the real PortOne would leave real verification
 * records on the account, and the response could not be controlled, so these branches could not be
 * checked.
 */

const PORTONE = {
	kind: "portone-v2",
	storeId: "store-1",
	channelKey: "channel-1",
	identityVerificationId: "rowcat-req-1-nonce-1",
	redirectUrl: "https://web.test/guardian/tok",
} as const;

const ORIGIN = "https://web.test";

/** Feeds one address into the judgment. No DOM is needed, matching this app's test setup. */
const read = (path: string) => readIdentityReturn(`${ORIGIN}${path}`);
const paramsOf = (href: string) => [...new URL(href).searchParams.keys()];

describe("did it return: reads the marker and clears it", () => {
	it("no marker means it did not return", () => {
		const result = read("/guardian/tok");
		expect(result.returned).toBe(false);
		expect(result.cleanedHref).toBe(`${ORIGIN}/guardian/tok`);
	});

	/**
	 * Does not return a value. If the caller could use it, it would eventually be sent to the server,
	 * and a path would open that attaches another person's verification to one's own request.
	 */
	it("clears every trace of the PortOne redirect", () => {
		const result = read(
			"/guardian/tok?identityVerificationId=iv-1&identityVerificationTxId=tx-1&transactionType=IDENTITY_VERIFICATION",
		);
		expect(result.returned).toBe(true);
		expect(paramsOf(result.cleanedHref)).toEqual([]);
		expect(new URL(result.cleanedHref).pathname).toBe("/guardian/tok");
	});

	it("clears the traces even with a failure code", () => {
		const result = read(
			"/guardian/tok?code=FAILURE&message=%EC%B7%A8%EC%86%8C",
		);
		expect(result.returned).toBe(true);
		expect(paramsOf(result.cleanedHref)).toEqual([]);
	});

	it("the same rule clears a redirect verifier's marker", () => {
		const result = read("/guardian/tok?verification=done");
		expect(result.returned).toBe(true);
		expect(paramsOf(result.cleanedHref)).toEqual([]);
	});

	/**
	 * Returning the erased address would be false: a refresh or re-render must not repeat the same
	 * request.
	 */
	it("a cleared address is not consumed again", () => {
		const first = read("/guardian/tok?identityVerificationId=iv-1");
		expect(first.returned).toBe(true);
		expect(readIdentityReturn(first.cleanedHref).returned).toBe(false);
	});

	/**
	 * Parameters that are not ours are kept. Another party's address must not be altered arbitrarily.
	 */
	it("unrelated parameters are untouched", () => {
		const result = read("/guardian/tok?identityVerificationId=iv-1&utm=x");
		expect(result.returned).toBe(true);
		expect(new URL(result.cleanedHref).searchParams.get("utm")).toBe("x");
	});
});

describe("handoff: branches", () => {
	it("the redirect kind leaves for that address", async () => {
		const navigate = vi.fn();
		const outcome = await runIdentityHandoff(
			{ kind: "redirect", redirectUrl: "https://web.test/guardian/tok?x=1" },
			{ navigate },
		);
		expect(navigate).toHaveBeenCalledExactlyOnceWith(
			"https://web.test/guardian/tok?x=1",
		);
		expect(outcome).toEqual({ status: "navigating" });
	});

	it("hands PortOne exactly what the server gave", async () => {
		const requestIdentityVerification = vi.fn(async () => ({}));
		await runIdentityHandoff(PORTONE, {
			loadPortOne: async () => ({ requestIdentityVerification }),
		});
		expect(requestIdentityVerification).toHaveBeenCalledExactlyOnceWith({
			storeId: "store-1",
			channelKey: "channel-1",
			identityVerificationId: "rowcat-req-1-nonce-1",
			redirectUrl: "https://web.test/guardian/tok",
		});
	});

	/**
	 * No error code means completed. The code does not mean 'verified': the server verifies by asking
	 * the provider back, using its own secret.
	 */
	it("returning without a code is completed", async () => {
		const outcome = await runIdentityHandoff(PORTONE, {
			loadPortOne: async () => ({
				requestIdentityVerification: async () => ({}),
			}),
		});
		expect(outcome).toEqual({ status: "completed" });
	});

	/**
	 * On mobile no response comes back, because the page leaves. Drawing an error then would flash on
	 * a screen that is disappearing. Issuing a verification request would waste work during the
	 * departure.
	 */
	it("no response is navigating", async () => {
		const outcome = await runIdentityHandoff(PORTONE, {
			loadPortOne: async () => ({
				requestIdentityVerification: async () => undefined,
			}),
		});
		expect(outcome).toEqual({ status: "navigating" });
	});

	it("an error code is failed and comes with copy", async () => {
		const outcome = await runIdentityHandoff(PORTONE, {
			loadPortOne: async () => ({
				requestIdentityVerification: async () => ({
					code: "FAILURE_TYPE_PG",
					message: "The user cancelled",
				}),
			}),
		});
		expect(outcome).toEqual({
			status: "failed",
			message: "The user cancelled",
		});
	});

	/**
	 * Does not proceed on an unknown kind. If the deployment selects a verifier this screen does not
	 * know, nothing is opened. The client is fail-closed too.
	 */
	it("an unknown kind is unsupported and does nothing", async () => {
		const navigate = vi.fn();
		const loadPortOne = vi.fn();
		const outcome = await runIdentityHandoff(
			{ kind: "some-new-agency" } as never,
			{ navigate, loadPortOne },
		);
		expect(outcome).toEqual({ status: "unsupported" });
		expect(navigate).not.toHaveBeenCalled();
		expect(loadPortOne).not.toHaveBeenCalled();
	});
});
