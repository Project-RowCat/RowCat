import { describe, expect, test } from "vitest";
import {
	dekForViewer,
	isUnlocked,
	loginTransition,
	type McpConfig,
	storedOnly,
} from "./config.ts";

/**
 * Ownership of the envelope key. The state to rule out is: unlock as A, sign in as B, then use A's
 * key with B's cookie. If it were representable, picking the wrong account would open someone
 * else's drafts. The rules are pure functions so every branch is covered without files or network.
 */

const BASE: McpConfig = { apiBaseUrl: "https://example.test/v2" };

const signedIn = (memberId: string, dek?: string): McpConfig => ({
	...BASE,
	cookie: `session=${memberId}`,
	memberId,
	...(dek === undefined ? {} : { dek }),
});

describe("when sign-in moves accounts", () => {
	test("signing back into the same account keeps the key", () => {
		const { config, discardedDek } = loginTransition(
			signedIn("member-a", "dek-a"),
			"session=new",
			"member-a",
		);
		expect(discardedDek).toBe(false);
		expect(config.dek).toBe("dek-a");
		expect(config.memberId).toBe("member-a");
		expect(config.cookie).toBe("session=new");
	});

	test("signing into another account discards the previous account's key", () => {
		const { config, discardedDek } = loginTransition(
			signedIn("member-a", "dek-a"),
			"session=b",
			"member-b",
		);
		expect(discardedDek).toBe(true);
		expect(config.dek).toBeUndefined();
		expect(config.memberId).toBe("member-b");
		expect(isUnlocked(config)).toBe(false);
	});

	// An old config with no recorded owner is not assumed to belong to the current account. The cost
	// of migrating is one `unlock`; guessing wrong opens someone else's drafts.
	test("sign-in clears a key with no owner", () => {
		const legacy: McpConfig = { ...BASE, cookie: "session=old", dek: "dek-?" };
		const { config, discardedDek } = loginTransition(
			legacy,
			"session=b",
			"member-b",
		);
		expect(discardedDek).toBe(true);
		expect(config.dek).toBeUndefined();
	});

	test("a config without a key has nothing to discard", () => {
		const { discardedDek, config } = loginTransition(
			signedIn("member-a"),
			"session=a",
			"member-a",
		);
		expect(discardedDek).toBe(false);
		expect(config.dek).toBeUndefined();
	});

	// Derived values are not carried over; if persisted, the next run would read them as fact.
	test("does not carry the environment source note into the next config", () => {
		const { config } = loginTransition(
			{ ...signedIn("member-a"), fromEnvironment: { cookie: true, dek: true } },
			"session=a",
			"member-a",
		);
		expect(config.fromEnvironment).toBeUndefined();
	});

	// Secrets are passed through the environment precisely so they are not persisted; moving them to
	// the file would silently break CI and container expectations.
	test("does not move keys the environment gave into the file", () => {
		const { config } = loginTransition(
			{
				...signedIn("member-a", "dek-env"),
				fromEnvironment: { cookie: false, dek: true },
			},
			"session=a",
			"member-a",
		);
		expect(config.dek).toBeUndefined();
	});
});

describe("values left in the file", () => {
	test("strips cookies and keys the environment gave", () => {
		expect(
			storedOnly({
				...signedIn("member-a", "dek-env"),
				fromEnvironment: { cookie: true, dek: true },
			}),
		).toEqual({ apiBaseUrl: BASE.apiBaseUrl, memberId: "member-a" });
	});

	test("values from the file stay as is", () => {
		expect(storedOnly(signedIn("member-a", "dek-a"))).toEqual({
			apiBaseUrl: BASE.apiBaseUrl,
			cookie: "session=member-a",
			dek: "dek-a",
			memberId: "member-a",
		});
	});
});

describe("whether this key may be used", () => {
	test("used when the owner matches", () => {
		expect(dekForViewer(signedIn("member-a", "dek-a"), "member-a")).toEqual({
			ok: true,
			dek: "dek-a",
		});
	});

	test("a different owner is the same as locked", () => {
		expect(dekForViewer(signedIn("member-a", "dek-a"), "member-b")).toEqual({
			ok: false,
			reason: "owner_mismatch",
		});
	});

	test("folds to closed when no owner is written", () => {
		expect(
			dekForViewer({ ...BASE, cookie: "c", dek: "dek-?" }, "member-a"),
		).toEqual({ ok: false, reason: "owner_unknown" });
	});

	test("locked without a key", () => {
		expect(dekForViewer(signedIn("member-a"), "member-a")).toEqual({
			ok: false,
			reason: "locked",
		});
	});

	// The owner of an environment-supplied key is not the file's memo. Only when the same environment
	// also supplied the cookie is there an operator declaration that the two pair up.
	test("passes when the environment gave both cookie and key", () => {
		expect(
			dekForViewer(
				{
					...BASE,
					cookie: "c",
					dek: "dek-env",
					memberId: "member-a",
					fromEnvironment: { cookie: true, dek: true },
				},
				"member-b",
			),
		).toEqual({ ok: true, dek: "dek-env" });
	});

	test("when the environment gave only the key, the owner is unknown", () => {
		expect(
			dekForViewer(
				{
					...BASE,
					cookie: "c",
					dek: "dek-env",
					memberId: "member-a",
					fromEnvironment: { cookie: false, dek: true },
				},
				"member-a",
			),
		).toEqual({ ok: false, reason: "owner_unknown" });
	});
});
