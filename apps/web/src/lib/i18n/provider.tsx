import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { i18nFor } from "./instance.ts";
import type { Locale } from "./locale.ts";

/**
 * Hands the subtree the instance for this render's locale. The locale arrives as a prop from the
 * root route's context rather than being re-read here, so the document's `lang` and the strings
 * inside it come from one decision.
 */
export function I18nProvider({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	return <I18nextProvider i18n={i18nFor(locale)}>{children}</I18nextProvider>;
}
