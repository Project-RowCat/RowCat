import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { i18nFor } from "./instance.ts";
import {
	DEFAULT_LOCALE,
	type Locale,
	localeFromTag,
	resolveLocale,
} from "./locale.ts";
import type { Namespace } from "./types.ts";

/**
 * The locale of the render in progress.
 *
 * On the server it is decided per request from the cookie and Accept-Language. In the browser it is
 * read back from `<html lang>`, which the server wrote from the same decision — so the browser does
 * not re-decide (and cannot disagree with) what the server drew, and hydration matches.
 *
 * Outside a request (tests, scripts) there is no header to read, and the answer is the default
 * locale rather than an exception. A web worker has no document either; it falls back to the
 * browser's language, which is what the server read from Accept-Language unless a cookie overrode it.
 */
export const currentLocale = createIsomorphicFn()
	.server((): Locale => {
		try {
			return resolveLocale({
				cookie: getRequestHeader("cookie"),
				acceptLanguage: getRequestHeader("accept-language"),
			});
		} catch {
			return DEFAULT_LOCALE;
		}
	})
	.client(
		(): Locale =>
			(typeof document === "undefined"
				? localeFromTag(globalThis.navigator?.language)
				: localeFromTag(document.documentElement.lang)) ?? DEFAULT_LOCALE,
	);

/**
 * Translation for code that is not a component (pure state functions, toast copy, failure tables).
 * Components use `useTranslation()` instead.
 *
 * Call it where the text is needed, never at module top level: a module constant is evaluated once
 * per process, so on the server it would freeze the first request's language for everyone.
 */
export function translator<N extends Namespace>(ns: N) {
	return i18nFor(currentLocale()).getFixedT(null, ns);
}

/**
 * A translator that may be held at module top level: it resolves the locale on every call rather
 * than once, so a module-level copy table (`get title() { return tr("…") }`) still follows the
 * render's language. `translator(ns)` held in a module constant would freeze the first request's.
 */
export function deferredTranslator<N extends Namespace>(
	ns: N,
): ReturnType<typeof translator<N>> {
	const resolve = (...args: unknown[]) =>
		(translator(ns) as unknown as (...rest: unknown[]) => string)(...args);
	return resolve as unknown as ReturnType<typeof translator<N>>;
}
