import { describe, expect, test } from "vitest";
import {
	type ClientIpBasis,
	forwardedFromUnlistedPeer,
	resolveClientIp,
	trustedProxyMatcher,
} from "./client-ip.ts";

const NONE: ClientIpBasis = { trustedProxies: [], ipHeader: null };

const facts = (
	remoteAddress: string | undefined,
	headers: Record<string, string> = {},
) => ({ remoteAddress, header: (name: string) => headers[name] });

describe("with no proxy configured — the shipped compose shape", () => {
	test("the socket peer is the client", () => {
		expect(resolveClientIp(facts("203.0.113.7"), NONE)).toBe("203.0.113.7");
	});

	/** Each forged value was a fresh bucket: password guessing without limit. */
	test("a forged X-Forwarded-For is ignored", () => {
		expect(
			resolveClientIp(
				facts("203.0.113.7", { "x-forwarded-for": "198.51.100.1" }),
				NONE,
			),
		).toBe("203.0.113.7");
	});

	/** Absent or multi-value used to fold everyone into one shared bucket. */
	test("a request with no forwarding header still has its own address", () => {
		expect(
			resolveClientIp(
				facts("203.0.113.7", { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }),
				NONE,
			),
		).toBe("203.0.113.7");
	});

	test("an IPv4-mapped peer is counted as IPv4", () => {
		expect(resolveClientIp(facts("::ffff:203.0.113.7"), NONE)).toBe(
			"203.0.113.7",
		);
	});

	test("no socket means no address", () => {
		expect(resolveClientIp(facts(undefined), NONE)).toBeNull();
	});
});

describe("behind trusted proxies", () => {
	const basis: ClientIpBasis = {
		trustedProxies: ["10.0.0.0/8", "2001:db8::/32"],
		ipHeader: null,
	};

	test("the first untrusted hop from the right is the client", () => {
		expect(
			resolveClientIp(
				facts("10.0.0.2", {
					"x-forwarded-for": "198.51.100.9, 203.0.113.7, 10.0.0.5",
				}),
				basis,
			),
		).toBe("203.0.113.7");
	});

	test("a peer outside the list is the client, whatever it forwards", () => {
		expect(
			resolveClientIp(
				facts("203.0.113.7", { "x-forwarded-for": "198.51.100.1" }),
				basis,
			),
		).toBe("203.0.113.7");
	});

	test("a malformed hop stops the walk at the proxy", () => {
		expect(
			resolveClientIp(
				facts("10.0.0.2", { "x-forwarded-for": "not-an-ip" }),
				basis,
			),
		).toBe("10.0.0.2");
	});

	test("IPv6 ranges match", () => {
		expect(
			resolveClientIp(
				facts("2001:db8::1", { "x-forwarded-for": "2001:db9::5" }),
				basis,
			),
		).toBe("2001:db9::5");
	});
});

describe("a named header", () => {
	test("is believed from a trusted proxy", () => {
		expect(
			resolveClientIp(
				facts("10.0.0.2", { "cf-connecting-ip": "203.0.113.7" }),
				{ trustedProxies: ["10.0.0.0/8"], ipHeader: "cf-connecting-ip" },
			),
		).toBe("203.0.113.7");
	});

	test("is not believed from a peer outside the list", () => {
		expect(
			resolveClientIp(
				facts("198.51.100.4", { "cf-connecting-ip": "203.0.113.7" }),
				{ trustedProxies: ["10.0.0.0/8"], ipHeader: "cf-connecting-ip" },
			),
		).toBe("198.51.100.4");
	});

	/** Its earlier meaning, kept: a deployment that set only the header put the API behind that proxy. */
	test("alone, is believed from any peer", () => {
		expect(
			resolveClientIp(
				facts("198.51.100.4", { "cf-connecting-ip": "203.0.113.7" }),
				{ trustedProxies: [], ipHeader: "cf-connecting-ip" },
			),
		).toBe("203.0.113.7");
	});

	test("that is not one IP falls back to the peer", () => {
		expect(
			resolveClientIp(
				facts("198.51.100.4", { "cf-connecting-ip": "1.1.1.1, 2.2.2.2" }),
				{ trustedProxies: [], ipHeader: "cf-connecting-ip" },
			),
		).toBe("198.51.100.4");
	});
});

test("single addresses and ranges both match", () => {
	const matches = trustedProxyMatcher(["192.0.2.1", "10.0.0.0/8"]);
	expect(matches("192.0.2.1")).toBe(true);
	expect(matches("192.0.2.2")).toBe(false);
	expect(matches("10.200.0.1")).toBe(true);
	expect(trustedProxyMatcher([])("10.0.0.1")).toBe(false);
});

describe("the misconfiguration a deployment can see", () => {
	const listed: ClientIpBasis = {
		trustedProxies: ["173.245.48.0/20"],
		ipHeader: null,
	};
	const matches = trustedProxyMatcher(listed.trustedProxies);

	/** A host nginx in front of the API whose own address was never listed: every visitor is nginx. */
	test("forwarding headers from a connection outside the list", () => {
		expect(
			forwardedFromUnlistedPeer(
				facts("172.18.0.1", { "x-forwarded-for": "203.0.113.7, 173.245.48.5" }),
				listed,
				matches,
			),
		).toBe(true);
	});

	test("not from a listed hop, not without headers, and never with no list", () => {
		expect(
			forwardedFromUnlistedPeer(
				facts("173.245.48.9", { "x-forwarded-for": "203.0.113.7" }),
				listed,
				matches,
			),
		).toBe(false);
		expect(
			forwardedFromUnlistedPeer(facts("172.18.0.1"), listed, matches),
		).toBe(false);
		expect(
			forwardedFromUnlistedPeer(
				facts("172.18.0.1", { "x-forwarded-for": "203.0.113.7" }),
				NONE,
				() => false,
			),
		).toBe(false);
	});
});
