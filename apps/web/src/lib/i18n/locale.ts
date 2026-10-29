/**
 * Which language a request is drawn in. Pure: it reads two header values and decides, so the server
 * render and the browser can call the same rule and arrive at the same answer.
 *
 * The choice lives in a cookie, not localStorage. The server renders the first document, and it can
 * read a cookie but not browser storage; a localStorage choice would draw English first and switch
 * after hydration, a flash on every load and a hydration mismatch in between.
 *
 * The cookie is not the session and carries nothing about the account. A language is a browser's
 * preference: guests need one too, and on a shared browser one person's language is a sensible
 * default for the next, which is not true of anything account-scoped.
 */

export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * English is the source language: every key is written in English first and the Korean dictionary
 * must match its shape (`messages.test.ts` and the `LocaleMessages` type both enforce that).
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * A locale's own name for itself (`English`, and Korean's endonym), for the language picker. It comes
 * from the platform's CLDR data rather than a table here, so a new locale needs no extra string and
 * no locale's name is spelled in another locale's dictionary.
 */
export const localeName = (locale: Locale): string =>
	new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;

export const LOCALE_COOKIE = "rowcat-locale";

/** One year. The value is a preference with nothing to expire. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
	return (
		typeof value === "string" && (LOCALES as readonly string[]).includes(value)
	);
}

/**
 * Folds a language tag to a supported locale by its primary subtag (`ko-KR` → `ko`). Anything else
 * is `null`, so the caller falls through to the next source instead of guessing.
 */
export function localeFromTag(tag: string | null | undefined): Locale | null {
	if (!tag) return null;
	const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
	return isLocale(primary) ? primary : null;
}

function cookieValue(cookieHeader: string, name: string): string | null {
	for (const part of cookieHeader.split(";")) {
		const index = part.indexOf("=");
		if (index === -1) continue;
		if (part.slice(0, index).trim() !== name) continue;
		try {
			return decodeURIComponent(part.slice(index + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Accept-Language in preference order. `q=0` means "not this one" and is dropped, not ranked last.
 */
function acceptedTags(header: string): string[] {
	return header
		.split(",")
		.map((entry, index) => {
			const [tag, ...params] = entry.trim().split(";");
			const q = params
				.map((param) => param.trim())
				.find((param) => param.startsWith("q="));
			const weight = q ? Number(q.slice(2)) : 1;
			return {
				tag: tag ?? "",
				weight: Number.isFinite(weight) ? weight : 0,
				index,
			};
		})
		.filter((entry) => entry.tag && entry.weight > 0)
		.sort((a, b) => b.weight - a.weight || a.index - b.index)
		.map((entry) => entry.tag);
}

/**
 * The order is the rule: an explicit choice (cookie) beats what the browser advertises, and an
 * unsupported or malformed value falls through rather than stopping the search.
 */
export function resolveLocale(input: {
	cookie?: string | null;
	acceptLanguage?: string | null;
}): Locale {
	if (input.cookie) {
		const chosen = cookieValue(input.cookie, LOCALE_COOKIE);
		if (isLocale(chosen)) return chosen;
	}
	if (input.acceptLanguage) {
		for (const tag of acceptedTags(input.acceptLanguage)) {
			const locale = localeFromTag(tag);
			if (locale) return locale;
		}
	}
	return DEFAULT_LOCALE;
}
