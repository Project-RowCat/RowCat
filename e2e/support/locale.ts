import { LOCALE_COOKIE } from "../../apps/web/src/lib/i18n/locale.ts";

/**
 * Every journey's browser has already chosen English.
 *
 * A browser with no language cookie gets the first-visit language window, and that window stands in
 * front of whatever the journey meant to press. The journeys are written against the English copy and
 * none of them is about the first visit, so the choice is made for them in the context's starting
 * state rather than dismissed in each journey (a dismiss step would be a line every new journey has
 * to remember, and the one that forgets fails on an unrelated button).
 *
 * The cookie name comes from the web's own module so renaming it cannot silently bring the window back.
 */
export const CHOSEN_LOCALE_COOKIE = {
	name: LOCALE_COOKIE,
	value: "en",
	domain: "localhost",
	path: "/",
	expires: -1,
	httpOnly: false,
	secure: false,
	sameSite: "Lax" as const,
};
