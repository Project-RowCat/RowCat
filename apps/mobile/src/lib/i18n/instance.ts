import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { membershipAges } from "../membership-ages.ts";
import { DEFAULT_LOCALE, type Locale } from "./locale.ts";
import { en } from "./messages/en/index.ts";
import { ko } from "./messages/ko/index.ts";
import type { Messages, Namespace } from "./types.ts";

/**
 * The app's one i18next instance.
 *
 * The web keeps one instance per locale that never switches, because its server renders concurrent
 * requests in one process. This app has no server render and one person per process, so the usual
 * shape is the right one: a single instance whose language changes when the person (or the phone)
 * changes it. `react-i18next`'s `useTranslation()` subscribes to that change, so every screen that
 * draws with it redraws in place — no remount, no lost navigation.
 *
 * Both dictionaries are bundled and init is synchronous: the first frame must not wait on a load,
 * and a language switch with the resources in memory applies before `changeLanguage` returns
 * (`instance.test.ts` pins that).
 *
 * The instance starts in English and stays there until the root applies the device's choice
 * (`provider.tsx`). Tests never mount that root, so they draw the English source.
 */
export const i18n = createInstance();

i18n.use(initReactI18next).init({
	lng: DEFAULT_LOCALE,
	fallbackLng: DEFAULT_LOCALE,
	resources: { en, ko },
	defaultNS: "common",
	ns: Object.keys(en),
	interpolation: {
		// React Native draws text, not markup; escaping would draw `&amp;`.
		escapeValue: false,
		/**
		 * The deployment's ages, available to every string as `{{guardianAge}}` and `{{adultAge}}` without
		 * each call site passing them. Getters, because i18next spreads this object on every
		 * translation: the value read is the one current now (`lib/membership-ages.ts`).
		 */
		defaultVariables: {
			get guardianAge() {
				return membershipAges().guardianConsent;
			},
			get adultAge() {
				return membershipAges().adult;
			},
		},
	},
	initAsync: false,
	returnNull: false,
});

export function activeLocale(): Locale {
	return i18n.language === "ko" ? "ko" : "en";
}

/** Root wiring only (`provider.tsx`) and tests. */
export function setActiveLocale(locale: Locale): void {
	if (i18n.language !== locale) void i18n.changeLanguage(locale);
}

/**
 * Translation for code that is not a component (pure copy functions, failure tables). Components use
 * `useTranslation()` instead, which is also what makes them redraw when the language changes.
 *
 * Call it where the text is needed, never at module top level: a module constant is evaluated once
 * and would keep the language of the moment the module loaded.
 */
export function translator<N extends Namespace>(ns: N) {
	return i18n.getFixedT(null, ns);
}

/**
 * A copy table that reads the current language on every access: `TABLE[key]` is a getter, so a
 * module-level table (`AUTH_FAILURE_MESSAGE`, a `Record<Union, string>` many callers index) keeps
 * its shape and still follows the language. The keys come from the English group, so `Object.keys`
 * and `Object.values` see every entry.
 *
 * Reading a table does not subscribe a component; the screen that draws it calls `useTranslation()`
 * so a language change redraws it.
 */
export function deferredGroup<
	N extends Namespace,
	G extends keyof Messages[N] & string,
>(ns: N, group: G): Messages[N][G] {
	const source = en[ns][group as keyof (typeof en)[N]] as unknown as Tree;
	return deferredTree(ns, group, source) as Messages[N][G];
}

type Tree = { [key: string]: string | Tree };

/** Nested groups become nested tables, so `COPY.value.dark` reads `group.value.dark`. */
function deferredTree(ns: string, path: string, source: Tree): Tree {
	const table: Tree = {};
	for (const [key, value] of Object.entries(source)) {
		const keyPath = `${path}.${key}`;
		if (typeof value === "object") {
			table[key] = deferredTree(ns, keyPath, value);
			continue;
		}
		Object.defineProperty(table, key, {
			enumerable: true,
			get: () =>
				(i18n.t as unknown as (key: string, options: object) => string)(
					keyPath,
					{ ns },
				),
		});
	}
	return table;
}
