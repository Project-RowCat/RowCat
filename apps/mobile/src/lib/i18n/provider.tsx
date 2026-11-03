import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { AppState } from "react-native";
import { deviceLanguageTags } from "./device-locale.ts";
import { setActiveLocale } from "./instance.ts";
import { type Locale, type LocalePreference, resolveLocale } from "./locale.ts";
import {
	createLocalePreferenceStore,
	type LocalePreferenceStorage,
} from "./preference.ts";
import { expoLocaleStorage } from "./sqlite-storage.ts";

/**
 * React wiring for the language. No rules live here: the vocabulary and the resolution are in
 * `locale.ts`, the read tolerance in `preference.ts`. This attaches them to the i18next instance.
 *
 * It sits outside identity, beside the appearance preference, for the same reason: the sign-in,
 * waiting and error screens and guests all have a language, and switching accounts must not change
 * it.
 *
 * ## No English flash
 *
 * The stored choice is read and applied **synchronously** inside the `useState` initializer, before
 * the first frame. Applying in an effect would draw one English frame on every launch for someone
 * who reads Korean.
 *
 * ## Following the phone while it follows the phone
 *
 * With `system`, the language is re-read when the app comes back to the foreground: a person who
 * changes the phone's language in Settings and returns finds the app already in it. An explicit
 * choice is not re-read — the phone has nothing to say about it.
 */

interface DeviceLocale {
	preference: LocalePreference;
	locale: Locale;
	setPreference: (preference: LocalePreference) => void;
}

const LocaleContext = createContext<DeviceLocale | null>(null);

export function DeviceLocaleProvider({
	children,
	storage = expoLocaleStorage,
	deviceTags = deviceLanguageTags,
}: {
	children: ReactNode;
	/** Test and dev-harness hooks. The product path uses the defaults. */
	storage?: LocalePreferenceStorage;
	deviceTags?: () => readonly string[];
}) {
	const store = useMemo(() => createLocalePreferenceStore(storage), [storage]);
	const [preference, setPreferenceValue] = useState<LocalePreference>(() =>
		store.load(),
	);
	const [locale, setLocale] = useState<Locale>(() => {
		const initial = resolveLocale(store.load(), deviceTags());
		setActiveLocale(initial);
		return initial;
	});

	useEffect(() => {
		setActiveLocale(locale);
	}, [locale]);

	useEffect(() => {
		if (preference !== "system") return;
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") setLocale(resolveLocale("system", deviceTags()));
		});
		return () => subscription.remove();
	}, [preference, deviceTags]);

	const setPreference = useCallback(
		(next: LocalePreference) => {
			const resolved = resolveLocale(next, deviceTags());
			setActiveLocale(resolved);
			setPreferenceValue(next);
			setLocale(resolved);
			void store.save(next);
		},
		[store, deviceTags],
	);

	const value = useMemo(
		() => ({ preference, locale, setPreference }),
		[preference, locale, setPreference],
	);

	return (
		<LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
	);
}

export function useDeviceLocale(): DeviceLocale {
	const value = useContext(LocaleContext);
	if (!value)
		throw new Error("useDeviceLocale needs DeviceLocaleProvider at the root");
	return value;
}
