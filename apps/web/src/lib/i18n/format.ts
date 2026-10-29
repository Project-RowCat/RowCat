import { currentLocale } from "./current.ts";
import type { Locale } from "./locale.ts";

/**
 * The `Intl` locale for each product locale. Number and date formatting follow the render's
 * language (`1,247` reads the same in both, but a date like `October 29` does not), and they follow the
 * same decision the strings do, so a page never mixes an English sentence with a Korean date.
 */
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", ko: "ko-KR" };

export const intlLocale = (): string => INTL_LOCALE[currentLocale()];

export const formatNumber = (
	value: number,
	options?: Intl.NumberFormatOptions,
): string => value.toLocaleString(intlLocale(), options);

/**
 * `Intl` formatters are not cheap to construct, and lists format twenty rows or more. One per
 * locale and shape is kept; the locale is part of the key so one request's language never reaches
 * another's.
 */
export function cachedFormatter<T>(make: (locale: string) => T) {
	const cache = new Map<string, T>();
	return (): T => {
		const locale = intlLocale();
		let formatter = cache.get(locale);
		if (!formatter) {
			formatter = make(locale);
			cache.set(locale, formatter);
		}
		return formatter;
	};
}
