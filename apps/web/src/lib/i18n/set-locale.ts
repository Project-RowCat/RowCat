import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "./locale.ts";

/**
 * Stores the choice and reloads. A reload, not a context swap: the server must draw the next
 * document in the new language (it reads only the cookie), and swapping in place would leave strings
 * that pure modules already produced — toasts, cached labels — in the old one.
 */
export function chooseLocale(locale: Locale): void {
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Safari before 18.4, and this one write needs no async.
	document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
	window.location.reload();
}
