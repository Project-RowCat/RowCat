import { describe, expect, test } from "vitest";
import type { McpConfig } from "./config.ts";
import { planSetup } from "./setup.ts";

/**
 * Table of the four states `setup` can be in: no session -> login; session without key -> pair;
 * session with this account's key -> ready (pairing is not started); session with another account's
 * key -> pair.
 *
 * The last row is the one guarded here: reading a config from a different account as "connected"
 * would open drafts with someone else's envelope key.
 */

const BASE: McpConfig = { apiBaseUrl: "https://example.test/v2" };

const config = (memberId?: string, dek?: string): McpConfig => ({
	...BASE,
	...(memberId === undefined
		? {}
		: { cookie: `session=${memberId}`, memberId }),
	...(dek === undefined ? {} : { dek }),
});

describe("the next step", () => {
	test("without a session it starts with sign-in", () => {
		expect(planSetup(config(), null)).toBe("login");
	});

	test("a dead session also starts with sign-in: the task is the same, so they are not split", () => {
		expect(planSetup(config("member-a", "dek-a"), null)).toBe("login");
	});

	test("with a session but no key it is pairing, not the recovery code", () => {
		expect(planSetup(config("member-a"), { id: "member-a" })).toBe("pair");
	});

	test("with this account's key there is nothing to do", () => {
		expect(planSetup(config("member-a", "dek-a"), { id: "member-a" })).toBe(
			"ready",
		);
	});

	test("a key opened by someone else's account is the same as locked", () => {
		expect(planSetup(config("member-a", "dek-a"), { id: "member-b" })).toBe(
			"pair",
		);
	});

	test("a key without a written owner is the same as locked", () => {
		expect(
			planSetup(
				{ ...BASE, cookie: "session=x", dek: "dek-a" },
				{ id: "member-a" },
			),
		).toBe("pair");
	});

	test("a deployment whose environment gave both cookie and key is ready", () => {
		expect(
			planSetup(
				{
					...BASE,
					cookie: "session=x",
					dek: "dek-a",
					fromEnvironment: { cookie: true, dek: true },
				},
				{ id: "member-a" },
			),
		).toBe("ready");
	});

	test("a deployment whose environment gave only the key cannot know the owner, so it is pairing", () => {
		expect(
			planSetup(
				{
					...BASE,
					cookie: "session=x",
					dek: "dek-a",
					fromEnvironment: { cookie: false, dek: true },
				},
				{ id: "member-a" },
			),
		).toBe("pair");
	});
});
