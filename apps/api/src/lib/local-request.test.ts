import { describe, expect, test } from "vitest";
import { isLocalRequest, isLoopbackAddress } from "./local-request.ts";

const ALLOWED = "http://localhost:3000";

/** A request that passes every row; each case below breaks exactly one. */
const facts = (
	overrides: {
		remoteAddress?: string | undefined;
		headers?: Record<string, string | undefined>;
	} = {},
) => {
	const headers: Record<string, string | undefined> = {
		host: "localhost:3001",
		origin: ALLOWED,
		...overrides.headers,
	};
	return {
		remoteAddress:
			"remoteAddress" in overrides ? overrides.remoteAddress : "127.0.0.1",
		header: (name: string) => headers[name],
		isAllowedOrigin: (origin: string) => origin === ALLOWED,
	};
};

describe("isLoopbackAddress", () => {
	test.each([
		"127.0.0.1",
		"127.1.2.3",
		"::1",
		"::ffff:127.0.0.1",
		"::FFFF:127.0.0.1",
	])("%s is loopback", (address) =>
		expect(isLoopbackAddress(address)).toBe(true));

	test.each([
		undefined,
		"",
		"10.0.0.1",
		"172.17.0.1",
		"192.168.65.1",
		"::ffff:10.0.0.1",
		"fe80::1",
		"128.0.0.1",
		"127.0.0.1.evil",
	])("%s is not", (address) => expect(isLoopbackAddress(address)).toBe(false));
});

describe("isLocalRequest", () => {
	test("a browser on this computer is local", () => {
		expect(isLocalRequest(facts())).toBe(true);
		expect(
			isLocalRequest(
				facts({ remoteAddress: "::1", headers: { host: "[::1]:3001" } }),
			),
		).toBe(true);
		expect(
			isLocalRequest(facts({ headers: { host: "127.0.0.1:47301" } })),
		).toBe(true);
	});

	test("a peer elsewhere is not, whatever its headers say", () => {
		expect(isLocalRequest(facts({ remoteAddress: "172.17.0.1" }))).toBe(false);
		expect(isLocalRequest(facts({ remoteAddress: undefined }))).toBe(false);
	});

	test.each([
		"forwarded",
		"x-forwarded-for",
		"x-forwarded-host",
		"x-forwarded-proto",
		"x-real-ip",
	])("a %s header means a proxy stands in front", (name) => {
		expect(isLocalRequest(facts({ headers: { [name]: "127.0.0.1" } }))).toBe(
			false,
		);
	});

	test.each([
		undefined,
		"rowcat.example",
		"localhost.evil.example:3001",
		"127.0.0.1.nip.io:3001",
	])("Host %s is not this computer", (host) => {
		expect(isLocalRequest(facts({ headers: { host } }))).toBe(false);
	});

	test("a page elsewhere making the browser post here is not", () => {
		expect(
			isLocalRequest(facts({ headers: { origin: "https://evil.example" } })),
		).toBe(false);
		expect(isLocalRequest(facts({ headers: { origin: undefined } }))).toBe(
			false,
		);
	});
});
