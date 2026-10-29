import { i18nFor } from "#/lib/i18n/instance.ts";
import { DEFAULT_LOCALE } from "#/lib/i18n/locale.ts";

/**
 * Tests that render a component without the app's root have no `I18nProvider`. react-i18next then
 * falls back to the instance `initReactI18next` registered, so one is registered here, in the
 * source locale, before any test runs. Without it, the result would depend on whether some module
 * happened to translate a string before the first component rendered.
 */
i18nFor(DEFAULT_LOCALE);
