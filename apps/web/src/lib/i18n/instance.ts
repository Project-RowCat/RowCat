import { createInstance, type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, type Locale } from "./locale.ts";
import { en } from "./messages/en/index.ts";
import { ko } from "./messages/ko/index.ts";

/**
 * One i18next instance per locale, created once and never switched.
 *
 * The usual pattern, a singleton with `changeLanguage()`, is wrong for this app: the server renders
 * concurrent requests in one process, so one request switching the shared instance would draw the
 * next request's page in its language. An instance whose language never changes can be shared by
 * every request that wants it.
 *
 * Both dictionaries are bundled. Lazy loading would make the first render async, and the server
 * render cannot wait on a translation fetch without drawing keys first.
 */
const instances = new Map<Locale, i18n>();

const resources = { en, ko };

export function i18nFor(locale: Locale): i18n {
	const existing = instances.get(locale);
	if (existing) return existing;

	const instance = createInstance();
	instance.use(initReactI18next).init({
		lng: locale,
		fallbackLng: DEFAULT_LOCALE,
		resources,
		defaultNS: "common",
		ns: Object.keys(en),
		// React escapes text already; escaping here as well would draw `&amp;`.
		interpolation: { escapeValue: false },
		// Synchronous init: the resources are in memory, and the first render must not wait.
		initAsync: false,
		returnNull: false,
	});
	instances.set(locale, instance);
	return instance;
}
