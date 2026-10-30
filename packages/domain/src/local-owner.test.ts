import { describe, expect, test } from "vitest";
import { isLoopbackHostname } from "./local-owner.ts";

describe("isLoopbackHostname", () => {
	test.each([
		"localhost",
		"LOCALHOST",
		"127.0.0.1",
		"127.0.1.1",
		"[::1]",
	])("%s is this computer", (hostname) =>
		expect(isLoopbackHostname(hostname)).toBe(true));

	test.each([
		"",
		"rowcat.example",
		"localhost.example",
		"127.0.0.1.nip.io",
		"192.168.0.10",
		"::1",
	])("%s is not", (hostname) =>
		expect(isLoopbackHostname(hostname)).toBe(false));
});
