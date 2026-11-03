import { describe, expect, it } from "vitest";
import {
	DEFAULT_LOCALE,
	LOCALE_ENDONYM,
	LOCALES,
	localeFromTag,
	parseLocalePreference,
	resolveLocale,
} from "./locale.ts";

describe("which language the app draws", () => {
	it("an explicit choice wins over the phone", () => {
		expect(resolveLocale("ko", ["en-US"])).toBe("ko");
		expect(resolveLocale("en", ["ko-KR"])).toBe("en");
	});

	it("`system` follows the phone's language, region and script folded away", () => {
		expect(resolveLocale("system", ["ko-KR"])).toBe("ko");
		expect(resolveLocale("system", ["ko_KR"])).toBe("ko");
		expect(resolveLocale("system", ["ko-Kore-KR"])).toBe("ko");
		expect(resolveLocale("system", ["en-GB"])).toBe("en");
	});

	it("takes the first tag this app speaks, in the phone's order", () => {
		expect(resolveLocale("system", ["fr-FR", "ko-KR", "en-US"])).toBe("ko");
	});

	/** A phone in a language we do not ship gets the source language, never a guess. */
	it("nothing matching is English", () => {
		expect(resolveLocale("system", ["fr-FR", "ja-JP"])).toBe(DEFAULT_LOCALE);
		expect(resolveLocale("system", [])).toBe(DEFAULT_LOCALE);
		expect(localeFromTag("")).toBeNull();
		expect(localeFromTag("kor")).toBeNull();
	});
});

describe("the stored preference is read leniently", () => {
	it("reads the three values as they are", () => {
		for (const value of ["system", "en", "ko"] as const)
			expect(parseLocalePreference(value)).toBe(value);
	});

	it("anything else follows the phone", () => {
		for (const value of [null, "", "KO", "ko-KR", "fr", "{}"])
			expect(parseLocalePreference(value), String(value)).toBe("system");
	});
});

it("every locale names itself", () => {
	for (const locale of LOCALES)
		expect(LOCALE_ENDONYM[locale].length).toBeGreaterThan(0);
});
