/**
 * Which language the app is drawn in. Pure: it takes the stored preference and the device's
 * language tags and decides, so the rule is verified without a simulator.
 *
 * The vocabulary is the web's (`apps/web/src/lib/i18n/locale.ts`): the same two locales, English as
 * the source. It is restated here rather than imported because an app does not import another app,
 * and the two sides differ in where the choice is read from — the web reads a cookie and
 * Accept-Language on the server, this app reads its own device storage and the OS.
 */

export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * English is the source language: every key is written in English first and the Korean dictionary
 * must match its shape (`messages.test.ts` and the `Messages` type both enforce that). A device whose
 * language is neither gets English.
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * What the person chose. `system` follows the device's language and is the default, so someone who
 * never opens the picker sees the language their phone is set to.
 */
export const LOCALE_PREFERENCES = ["system", ...LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = "system";

/**
 * Each locale's own name for itself, for the picker. It is not in the dictionaries: a language's
 * name for itself is the same whatever the app is drawn in, and someone who landed in a language
 * they cannot read finds theirs by that spelling. (The web asks `Intl.DisplayNames`; Hermes does not
 * ship it, so the two spellings are written here.)
 */
export const LOCALE_ENDONYM: Record<Locale, string> = {
	en: "English",
	ko: "한국어",
};

export function isLocale(value: unknown): value is Locale {
	return (
		typeof value === "string" && (LOCALES as readonly string[]).includes(value)
	);
}

/**
 * Stored string → preference. Unknown values become `system`. Case is not folded: only our code writes
 * this value, so leniency would give it two spellings (the appearance preference decides the same).
 */
export function parseLocalePreference(
	value: string | null | undefined,
): LocalePreference {
	return (LOCALE_PREFERENCES as readonly string[]).includes(value ?? "")
		? (value as LocalePreference)
		: DEFAULT_LOCALE_PREFERENCE;
}

/**
 * Folds a language tag to a supported locale by its primary subtag (`ko-KR`, `ko_KR` → `ko`).
 * Anything else is `null`, so the caller falls through to the next tag instead of guessing.
 */
export function localeFromTag(tag: string | null | undefined): Locale | null {
	if (!tag) return null;
	const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
	return isLocale(primary) ? primary : null;
}

/**
 * The locale to draw: an explicit choice wins; `system` takes the first device tag this app speaks,
 * in the OS's order of preference; nothing matching is English.
 */
export function resolveLocale(
	preference: LocalePreference,
	deviceTags: readonly string[],
): Locale {
	if (preference !== "system") return preference;
	for (const tag of deviceTags) {
		const locale = localeFromTag(tag);
		if (locale) return locale;
	}
	return DEFAULT_LOCALE;
}
