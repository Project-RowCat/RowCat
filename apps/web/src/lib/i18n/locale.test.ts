import { describe, expect, test } from "vitest";
import {
	DEFAULT_LOCALE,
	LOCALE_COOKIE,
	localeFromTag,
	resolveLocale,
} from "./locale.ts";

describe("resolveLocale", () => {
	test("an explicit cookie beats Accept-Language", () => {
		expect(
			resolveLocale({
				cookie: `a=1; ${LOCALE_COOKIE}=ko`,
				acceptLanguage: "en-US,en;q=0.9",
			}),
		).toBe("ko");
	});

	test("an unsupported cookie falls through to Accept-Language", () => {
		expect(
			resolveLocale({ cookie: `${LOCALE_COOKIE}=fr`, acceptLanguage: "ko-KR" }),
		).toBe("ko");
	});

	test("Accept-Language is read in q order and q=0 is excluded", () => {
		expect(
			resolveLocale({ acceptLanguage: "fr;q=1, ko;q=0.5, en;q=0.8" }),
		).toBe("en");
		expect(resolveLocale({ acceptLanguage: "ko;q=0, en;q=0.1" })).toBe("en");
	});

	test("nothing usable is the default locale", () => {
		expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
		expect(resolveLocale({ acceptLanguage: "fr, de" })).toBe(DEFAULT_LOCALE);
	});

	test("a malformed cookie value does not throw", () => {
		expect(resolveLocale({ cookie: `${LOCALE_COOKIE}=%E0%A4%A` })).toBe(
			DEFAULT_LOCALE,
		);
	});
});

test("localeFromTag folds region subtags", () => {
	expect(localeFromTag("ko-KR")).toBe("ko");
	expect(localeFromTag("EN_us")).toBe("en");
	expect(localeFromTag("ja")).toBeNull();
});
