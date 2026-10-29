import { describe, expect, test, vi } from "vitest";
import { createPortOneVerifier } from "./portone.ts";

/**
 * PortOne adapter: what it discards, and channel binding. Both fail silently when wrong. If CI, DI
 * or birth date crossed the port they would become a column and eventually be filled; the type
 * blocks that but cannot say whether the value was read and dropped, so this checks by value. If
 * the reference/request pairing loosened, one verification could open several requests.
 *
 * No network: calling the real PortOne would leave a real verification record on that account (a
 * paid request) and the response could not be controlled, which the two rules above need. That is
 * why the adapter has a `fetch` injection seam.
 */

const CONFIG = {
	storeId: "store-1",
	channelKey: "channel-1",
	apiSecret: "secret-1",
	origin: "https://portone.test",
};

/**
 * The shape the authority really returns, including fields we do not use. With only the used fields
 * the test could not show that the rest never crosses the port.
 */
const VERIFIED_BODY = {
	id: "iv-1",
	status: "VERIFIED",
	verifiedAt: "2026-08-20T01:02:03.000Z",
	verifiedCustomer: {
		id: "customer-1",
		name: "Jordan Kim",
		phoneNumber: "01012345678",
		birthDate: "1985-03-02",
		gender: "MALE",
		ci: "CI-this-value-must-never-cross",
		di: "DI-this-value-neither",
		isForeigner: false,
		operator: "SKT",
	},
};

const verifierWith = (
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
	nonce = "nonce-1",
) =>
	createPortOneVerifier(
		{
			...CONFIG,
			fetchImpl: ((input: unknown, init?: RequestInit) =>
				Promise.resolve(handler(String(input), init))) as typeof fetch,
		},
		() => nonce,
	);

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("begin — builds the handoff", () => {
	// V2 verification starts when the browser SDK opens its window, so there is nothing to create
	// server-side; we only decide the values handed to that window (nothing here can fail).
	test("doesn't call PortOne", async () => {
		const call = vi.fn(() => json({}));
		const verifier = verifierWith(call);
		await verifier.begin({
			requestId: "req-1",
			returnUrl: "https://web.test/guardian/tok",
		});
		expect(call).not.toHaveBeenCalled();
	});

	test("only public values go to the screen, and the secret doesn't", async () => {
		const verifier = verifierWith(() => json({}));
		const { handoff } = await verifier.begin({
			requestId: "req-1",
			returnUrl: "https://web.test/guardian/tok",
		});
		expect(handoff).toEqual({
			kind: "portone-v2",
			storeId: "store-1",
			channelKey: "channel-1",
			identityVerificationId: "rowcat-req-1-nonce-1",
			redirectUrl: "https://web.test/guardian/tok",
		});
		expect(JSON.stringify(handoff)).not.toContain(CONFIG.apiSecret);
	});

	// Starting twice on one request must work (closing the window and retrying is common), and reusing
	// an id would collide with one already finished at PortOne.
	test("starting again gives a different identifier", async () => {
		const first = await verifierWith(() => json({}), "n1").begin({
			requestId: "req-1",
			returnUrl: "https://web.test/x",
		});
		const second = await verifierWith(() => json({}), "n2").begin({
			requestId: "req-1",
			returnUrl: "https://web.test/x",
		});
		expect(first.reference).not.toBe(second.reference);
	});
});

describe("verify — looks up, then discards", () => {
	test("looks up that case with the secret", async () => {
		const seen: { url: string; auth: string | null }[] = [];
		const verifier = verifierWith((url, init) => {
			const headers = new Headers(init?.headers);
			seen.push({ url, auth: headers.get("Authorization") });
			return json(VERIFIED_BODY);
		});

		await verifier.verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(seen[0]?.url).toBe(
			"https://portone.test/identity-verifications/rowcat-req-1-nonce-1",
		);
		expect(seen[0]?.auth).toBe("PortOne secret-1");
	});

	// The most important check here. The response has CI, DI, birth date, gender and carrier; only
	// name, contact, reference, time and adult flag may cross the port. The type cannot say whether
	// the object was spread wholesale.
	test("CI, DI, date of birth, gender and carrier don't cross the port", async () => {
		const verifier = verifierWith(() => json(VERIFIED_BODY));
		const outcome = await verifier.verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});

		expect(Object.keys(outcome).sort()).toEqual([
			"adult",
			"contact",
			"name",
			"reference",
			"verified",
			"verifiedAt",
		]);
		const serialized = JSON.stringify(outcome);
		for (const leaked of [
			"CI-this-value",
			"DI-this-value",
			"1985-03-02",
			"SKT",
			"MALE",
		])
			expect(serialized, `${leaked} leaked out`).not.toContain(leaked);
	});

	test("minimal information (name, contact) and their timestamps carry over as is", async () => {
		const verifier = verifierWith(() => json(VERIFIED_BODY));
		const outcome = await verifier.verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(outcome).toMatchObject({
			verified: true,
			adult: true,
			name: "Jordan Kim",
			contact: "01012345678",
		});
		if (!outcome.verified) throw new Error("was not verified");
		// The authority's clock, not ours: this value must be reconcilable in a dispute.
		expect(outcome.verifiedAt.toISOString()).toBe("2026-08-20T01:02:03.000Z");
	});

	// Adulthood uses the product-timezone calendar and only the boolean remains. "Therefore cannot be
	// a legal guardian" is the consumer's judgment, not the adapter's.
	test("a minor has adult false", async () => {
		const child = {
			...VERIFIED_BODY,
			verifiedCustomer: {
				...VERIFIED_BODY.verifiedCustomer,
				birthDate: "2015-01-01",
			},
		};
		const outcome = await verifierWith(() => json(child)).verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(outcome).toMatchObject({ verified: true, adult: false });
	});

	// A missing birth date is not adult: passing would turn an unverified fact true, and that fact
	// separates "the child verified in their own name" from not.
	test("no date of birth is not treated as an adult", async () => {
		const missing = {
			...VERIFIED_BODY,
			verifiedCustomer: { name: "name only" },
		};
		const outcome = await verifierWith(() => json(missing)).verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(outcome).toMatchObject({ verified: true, adult: false });
	});
});

describe("verify — channel binding and failure", () => {
	// A reference from another request is not even looked up. Always true on the normal path (only
	// stored values arrive), but without this a later caller taking the reference as an argument would
	// silently open that path.
	test("refuses another request's reference without touching the network", async () => {
		const call = vi.fn(() => json(VERIFIED_BODY));
		const outcome = await verifierWith(call).verify({
			requestId: "req-1",
			reference: "rowcat-req-2-nonce-1",
		});
		expect(outcome).toEqual({ verified: false, reason: "failed" });
		expect(call).not.toHaveBeenCalled();
	});

	// Unfinished and failed differ: "not completed" vs "try again". Folded into one, someone who
	// closed the window themselves would be told it failed.
	test("READY and 404 are incomplete (declined)", async () => {
		const ready = await verifierWith(() =>
			json({ ...VERIFIED_BODY, status: "READY" }),
		).verify({ requestId: "req-1", reference: "rowcat-req-1-nonce-1" });
		expect(ready).toEqual({ verified: false, reason: "declined" });

		const missing = await verifierWith(() => json({}, 404)).verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(missing).toEqual({ verified: false, reason: "declined" });
	});

	test("FAILED, 5xx and a dropped connection are failures", async () => {
		const failed = await verifierWith(() => json({ status: "FAILED" })).verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(failed).toEqual({ verified: false, reason: "failed" });

		const server = await verifierWith(() => json({}, 500)).verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(server).toEqual({ verified: false, reason: "failed" });

		const broken = await verifierWith(() => {
			throw new Error("network");
		}).verify({ requestId: "req-1", reference: "rowcat-req-1-nonce-1" });
		expect(broken).toEqual({ verified: false, reason: "failed" });
	});

	// A 401 must not pass either: if a deployment with a wrong secret folded it into success,
	// unverified consent would be recorded as verified.
	test("doesn't let 401 through", async () => {
		const outcome = await verifierWith(() => json({}, 401)).verify({
			requestId: "req-1",
			reference: "rowcat-req-1-nonce-1",
		});
		expect(outcome).toEqual({ verified: false, reason: "failed" });
	});
});
