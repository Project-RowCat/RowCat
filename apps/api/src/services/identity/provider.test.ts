import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * Fail-closed behaviour of the verification provider, three rules:
 * - no verifier, or an unknown name, means no verification means, so every consumer is blocked;
 * - a half configuration (any PortOne value missing) also means none;
 * - the dev verifier never stands in production.
 *
 * Breaking these shows up not as an error but as guardian consent being recorded that was never
 * received, which cannot be undone later. Same axis as not paying out when payment-verification
 * credentials are missing, but heavier: that wrongly pays money, this removes the legal basis for
 * processing a child's personal data.
 *
 * Modules are swapped wholesale because `env.ts` reads the process environment once at boot (by
 * design) and this is the only way to vary it; what is under test is the judgment of the code that
 * reads that constant.
 */

const load = async (env: {
	provider: string | null;
	production: boolean;
	portOne?: { storeId: string; channelKey: string; apiSecret: string } | null;
}) => {
	vi.resetModules();
	vi.doMock("../../env.ts", () => ({
		identityVerificationProvider: env.provider,
		isProduction: env.production,
		// PortOne config is not this file's subject; `portone.test.ts` covers that branch.
		portOneIdentityConfig: env.portOne ?? null,
	}));
	return import("./provider.ts");
};

afterEach(() => {
	vi.doUnmock("../../env.ts");
	vi.resetModules();
});

describe("resolveIdentityVerifier", () => {
	test("no config means no verifier", async () => {
		const { resolveIdentityVerifier } = await load({
			provider: null,
			production: false,
		});
		expect(resolveIdentityVerifier()).toBeNull();
	});

	// A typo must not become a path to consent without verification: a configured name with no adapter
	// does not pass. Adding a real authority adds the branch and adapter in one commit.
	test("doesn't let an unknown name through", async () => {
		const { resolveIdentityVerifier } = await load({
			provider: "some-agency-typo",
			production: false,
		});
		expect(resolveIdentityVerifier()).toBeNull();
	});

	test("in development the dev verifier stands", async () => {
		const { resolveIdentityVerifier } = await load({
			provider: "dev",
			production: false,
		});
		expect(resolveIdentityVerifier()?.name).toBe("dev");
	});

	// `env.ts` already blocks boot on production + `dev`; this checks once more. The cost of the
	// mistake is asymmetric: wrongly blocked fails the deploy visibly, wrongly open silently records
	// consent never given.
	test("in production the dev verifier doesn't stand", async () => {
		const { resolveIdentityVerifier } = await load({
			provider: "dev",
			production: true,
		});
		expect(resolveIdentityVerifier()).toBeNull();
	});

	test("once the PortOne config is complete, that verifier stands", async () => {
		const { resolveIdentityVerifier } = await load({
			provider: "portone",
			production: true,
			portOne: { storeId: "s", channelKey: "c", apiSecret: "k" },
		});
		expect(resolveIdentityVerifier()?.name).toBe("portone");
	});

	// A half configuration means no verifier. A missing secret opens the window but fails lookup; a
	// missing channel key never opens the window. Both surface after the user is halfway through, so
	// answering 503 from the start is more honest.
	test("half a PortOne config means no verifier", async () => {
		const { resolveIdentityVerifier } = await load({
			provider: "portone",
			production: true,
			portOne: null,
		});
		expect(resolveIdentityVerifier()).toBeNull();
	});
});

describe("dev verifier — channel binding", () => {
	const devVerifier = async () => {
		const { resolveIdentityVerifier } = await load({
			provider: "dev",
			production: false,
		});
		const verifier = resolveIdentityVerifier();
		if (!verifier) throw new Error("the dev verifier didn't stand");
		return verifier;
	};

	test("begin returns a reference bound to the request id", async () => {
		const verifier = await devVerifier();
		const started = await verifier.begin({
			requestId: "req-1",
			returnUrl: "https://web.test/guardian/tok",
		});
		expect(started.reference).toBe("dev-req-1");
		expect(started.handoff).toEqual({
			kind: "redirect",
			redirectUrl: "https://web.test/guardian/tok?verification=done",
		});
	});

	// The result is not carried in the address. In production the screen only says "finished" and the
	// server asks again by the stored reference; carrying it in dev alone would be a code path
	// production never takes.
	test("the returning address carries no verification result", async () => {
		const verifier = await devVerifier();
		const { handoff } = await verifier.begin({
			requestId: "req-1",
			returnUrl: "https://web.test/guardian/tok",
		});
		if (handoff.kind !== "redirect") throw new Error("not a redirect");
		const params = new URL(handoff.redirectUrl).searchParams;
		expect(params.get("verification")).toBe("done");
		expect([...params.keys()]).toEqual(["verification"]);
	});

	// Even in dev, attaching another request's reference is blocked. Apart from this adapter never
	// standing in production, imitating a verifier without channel binding would become the
	// expectation when using a real adapter.
	test("refuses another request's reference", async () => {
		const verifier = await devVerifier();
		expect(
			await verifier.verify({ requestId: "req-1", reference: "dev-req-2" }),
		).toEqual({ verified: false, reason: "failed" });
	});

	test("a correct reference returns the fact of being verified as an adult", async () => {
		const verifier = await devVerifier();
		const outcome = await verifier.verify({
			requestId: "req-1",
			reference: "dev-req-1",
		});
		expect(outcome).toMatchObject({ verified: true, adult: true });
		// Identity fields are empty: the port carries only the verification reference.
		expect(outcome).toMatchObject({ name: null, contact: null });
	});
});
