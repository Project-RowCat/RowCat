import { ScriptOnce } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { syncThemeChromeScheme } from "#/lib/theme/chrome-scheme.ts";

type Theme = "dark" | "light" | "system";

/**
 * The resolved appearance. `system` never reaches this type: it is a preference, not an appearance.
 */
type ColorScheme = "dark" | "light";

interface ThemeProviderState {
	/**
	 * The user's choice, stored per browser. It is not synced to the account: guests must also be able
	 * to get the dark screen, and account scope would leave nowhere to store a logged-out visitor's
	 * preference.
	 */
	theme: Theme;
	/**
	 * The appearance to draw now, with `system` folded into the OS setting. It is in context because
	 * screens that show default values for unset fields need it. The theme color editor preview draws
	 * the default palette for the current scheme. It is not used to apply account custom colors. The
	 * palette is single, so that resolution does not depend on the scheme. Having consumers read
	 * matchMedia again would create a second decision point, and one of them would miss OS scheme
	 * changes. That symptom is quiet: a dark color stays visible during the day.
	 *
	 * Do not branch render markup on this value. The server cannot know the browser's OS setting, so
	 * the first render is always `light`, and the real value arrives after mount. Markup that varies
	 * with it would be a hydration mismatch.
	 */
	scheme: ColorScheme;
	setTheme: (theme: Theme) => void;
}

/**
 * Inline script that runs before hydration. The chosen theme lives only in the browser
 * (localStorage and the OS setting), so the server-rendered document has no theme class yet.
 * Deciding it in an effect would paint light first and switch to dark later, flashing white on
 * every reload for dark-theme users (FOUC). So the class is set while the document is parsed, not
 * by React. It is minified to one line because it must finish synchronously before the body.
 *
 * Account custom colors are not passed here. They are private server state. Placing them where this
 * script can read them (unscoped localStorage) would cross account boundaries: a logged-out browser
 * would keep the previous account's colors, and the next person's first paint would use them. The
 * cost is that the first paint uses default colors, which is cheaper than breaking account
 * isolation.
 */
function getThemeScript(storageKey: string, defaultTheme: Theme) {
	const key = JSON.stringify(storageKey);
	const fallback = JSON.stringify(defaultTheme);

	return `(function(){try{var t=localStorage.getItem(${key});if(t!=='light'&&t!=='dark'&&t!=='system'){t=${fallback}}var d=matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='system'?(d?'dark':'light'):t;var e=document.documentElement;e.classList.add(r);e.style.colorScheme=r}catch(e){}})();`;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
	undefined,
);

/**
 * Maps a preference to the scheme to draw now. This is the single resolver. The first apply,
 * explicit changes, and OS changes all pass through this function. Writing a ternary in each of
 * those three places would eventually have one place written backwards, and only that place would
 * stop following the OS.
 */
function resolveScheme(theme: Theme): ColorScheme {
	if (theme !== "system") return theme;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

/**
 * Reflects the resolved theme on the document root. `light` and `dark` are removed first because
 * the script above has already added one. The two classes must never stack when toggling.
 *
 * This class is the only record of the device or default appearance. Account themes do not touch
 * it, so the shell layer can always read back what the default was.
 *
 * `colorScheme` is not written here. Scrollbars and native form controls read that property, and it
 * must follow the background actually visible. An account preset can override that background, so
 * the answer can differ from this value (device light plus a black preset). The one place that
 * merges both axes into the final value is lib/theme/chrome-scheme.ts. Writing it here too would
 * let this later effect win, and only scrollbars would disagree with the account background when
 * the OS scheme changes.
 */
function applyScheme(scheme: ColorScheme) {
	const root = document.documentElement;
	root.classList.remove("light", "dark");
	root.classList.add(scheme);
	/** Order matters: the shell layer reads the class that was just set above. */
	syncThemeChromeScheme(root);
}

/**
 * App-wide theme: light, dark, or system. The source of truth is localStorage. This provider reads
 * it and exposes it to React. The server render has no stored value, so the first render always
 * uses `defaultTheme`, then syncs to the stored value after mount. The flicker in between is
 * already prevented by the script above.
 *
 * This provider does not own account custom colors. Those are server state, applied by a separate
 * layer (features/theme/account-theme-bridge.tsx). This provider's only job is to expose the
 * resolved scheme so that layer knows which palette to paint.
 */
export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey = "theme",
}: {
	children: ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
}) {
	const [theme, setThemeState] = useState<Theme>(defaultTheme);
	/**
	 * The initial value is `light` because the server cannot know the OS setting. The effect right
	 * after mount sets the real value. Until then, nothing may read this value (see the type comment
	 * above).
	 */
	const [scheme, setScheme] = useState<ColorScheme>("light");
	const [mounted, setMounted] = useState(false);

	/**
	 * Applies the scheme to the document and sets the context value to the same result, so the two
	 * never diverge.
	 */
	const commitScheme = useCallback((next: Theme) => {
		const resolved = resolveScheme(next);
		applyScheme(resolved);
		setScheme(resolved);
	}, []);

	useEffect(() => {
		const stored = localStorage.getItem(storageKey);
		setThemeState(
			stored === "light" || stored === "dark" || stored === "system"
				? stored
				: defaultTheme,
		);
		setMounted(true);
	}, [defaultTheme, storageKey]);

	useEffect(() => {
		if (!mounted) return;
		commitScheme(theme);
	}, [theme, mounted, commitScheme]);

	/**
	 * Follows the OS setting only when the theme is `system`. If the user explicitly chose light or
	 * dark, that choice wins even when the OS changes.
	 */
	useEffect(() => {
		if (!mounted || theme !== "system") return;

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => commitScheme("system");
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [theme, mounted, commitScheme]);

	const setTheme = (next: Theme) => {
		localStorage.setItem(storageKey, next);
		setThemeState(next);
	};

	return (
		<ThemeProviderContext value={{ theme, scheme, setTheme }}>
			<ScriptOnce>{getThemeScript(storageKey, defaultTheme)}</ScriptOnce>
			{children}
		</ThemeProviderContext>
	);
}

export function useTheme() {
	const context = useContext(ThemeProviderContext);
	if (context === undefined)
		throw new Error("useTheme must be used within a ThemeProvider");
	return context;
}
