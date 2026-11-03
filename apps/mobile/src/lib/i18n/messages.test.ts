import { afterEach, describe, expect, it } from "vitest";
import {
	providerCancelled,
	providerSurfaceFailed,
} from "../../features/adult-verification/adult-verification-error.ts";
import { AGE_COPY } from "../../features/onboarding/gate-copy.ts";
import { membershipAges } from "../membership-ages.ts";
import {
	activeLocale,
	deferredGroup,
	setActiveLocale,
	translator,
} from "./instance.ts";
import { en } from "./messages/en/index.ts";
import { ko } from "./messages/ko/index.ts";

/**
 * The `Messages` type already rejects a missing Korean key at compile time. This checks what the type
 * cannot: that each translation keeps the same interpolation variables (a Korean string that drops
 * `{{provider}}` compiles and draws without the name), and that the English source stays English.
 * The web's `messages.test.ts` checks its dictionaries the same way.
 */
type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out.set(path, value);
		else for (const [k, v] of leaves(value, path)) out.set(k, v);
	}
	return out;
}

const variables = (text: string): string[] =>
	[...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)]
		.map((match) => match[1] ?? "")
		.sort();

describe("the dictionaries", () => {
	it("Korean has exactly the English keys", () => {
		expect([...leaves(ko as Tree).keys()].sort()).toEqual(
			[...leaves(en as Tree).keys()].sort(),
		);
	});

	it("every translation keeps the source's interpolation variables", () => {
		const source = leaves(en as Tree);
		for (const [key, text] of leaves(ko as Tree))
			expect({ key, vars: variables(text) }).toEqual({
				key,
				vars: variables(source.get(key) ?? ""),
			});
	});

	it("no English source string contains Hangul", () => {
		for (const [key, text] of leaves(en as Tree))
			expect({ key, hangul: /[가-힣]/.test(text) }).toEqual({
				key,
				hangul: false,
			});
	});

	it("no string is empty", () => {
		for (const tree of [en, ko])
			for (const [key, text] of leaves(tree as Tree))
				expect({ key, empty: text.trim() === "" }).toEqual({
					key,
					empty: false,
				});
	});
});

describe("switching the language", () => {
	afterEach(() => setActiveLocale("en"));

	/**
	 * The provider applies the stored language inside a `useState` initializer, before the first frame.
	 * That only avoids an English flash if the switch is done by the time `changeLanguage` returns —
	 * which holds because both dictionaries are in memory.
	 */
	it("applies before the call returns", () => {
		expect(activeLocale()).toBe("en");
		setActiveLocale("ko");
		expect(activeLocale()).toBe("ko");
		expect(translator("common")("actions.cancel")).toBe("취소");
	});

	it("a deferred table follows the language on every read", () => {
		const table = deferredGroup("signIn", "failure");
		expect(table.unknown).toBe(en.signIn.failure.unknown);
		setActiveLocale("ko");
		expect(table.unknown).toBe(ko.signIn.failure.unknown);
		expect(Object.keys(table).sort()).toEqual(
			Object.keys(en.signIn.failure).sort(),
		);
	});

	it("interpolates", () => {
		expect(
			translator("signIn")("social.continue", { provider: "Google" }),
		).toBe("Continue with Google");
		setActiveLocale("ko");
		expect(
			translator("signIn")("social.continue", { provider: "Google" }),
		).toBe("Google로 계속하기");
	});
});

/**
 * A failure that stays on screen is held in state as a value, and that value must not freeze the
 * language it was made in. The adult-verification failure carries its sentence as a getter for
 * that reason; the gate's empty-date error is a flag for the same one.
 */
describe("held failures follow the language", () => {
	afterEach(() => setActiveLocale("en"));

	it("an adult-verification failure made in English reads Korean after a switch", () => {
		const held = providerSurfaceFailed();
		expect(held.message).toBe(en.membership.adult.error.surfaceFailed);
		setActiveLocale("ko");
		expect(held.message).toBe(ko.membership.adult.error.surfaceFailed);
	});

	it("cancel stays silent in every language", () => {
		setActiveLocale("ko");
		expect(providerCancelled().message).toBeNull();
	});

	it("the gate's ages come from the deployment, in both languages", () => {
		setActiveLocale("ko");
		expect(AGE_COPY.description).toContain(
			`만 ${membershipAges().guardianConsent}세`,
		);
	});
});
