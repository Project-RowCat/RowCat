/**
 * The device's language, read through Hermes's `Intl` rather than a native module.
 *
 * `expo-localization` would answer the same question, but it is a native module: adding it changes
 * the native fingerprint, needs a new runtime generation and a new binary before any of this can
 * ship. Hermes already carries the answer — its default locale comes from the platform (on Apple,
 * the user's preferred languages; on Android, the default `Locale`) — so `resolvedOptions().locale`
 * is the device's first language with no new dependency.
 *
 * What this does not give is the OS's whole ordered list, only its first entry. A phone set to
 * French then Korean draws English here, where `expo-localization` would find Korean second. That is
 * the price of no native change, and the picker in settings is the way out.
 *
 * ⚠️ Not yet verified on a device. Simulator and device QA must confirm that switching the OS language
 * changes this value (`docs/mobile/LOCALIZATION.md` §기기 확인).
 */
export function deviceLanguageTags(): string[] {
	try {
		const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
		return tag ? [tag] : [];
	} catch {
		return [];
	}
}
