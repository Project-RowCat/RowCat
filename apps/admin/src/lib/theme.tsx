import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "rowcat-admin-theme";

interface ThemeState {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

/**
 * Much simpler than the web's: this is a pure SPA with no server-rendered document, so no
 * pre-hydration inline script is needed to avoid a flash; applying it in an effect is in time.
 *
 * The `admin` prefix on the storage key matters: the web and console can share an origin (they do
 * in development), and a shared key would let one app's toggle change the other's theme.
 */
function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	root.classList.remove("light", "dark");
	const resolved =
		theme === "system"
			? window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
			: theme;
	root.classList.add(resolved);
	// The class only switches our tokens; scrollbars and native form controls read this property.
	root.style.colorScheme = resolved;
}

const readStored = (): Theme => {
	if (typeof window === "undefined") return "system";
	const stored = window.localStorage.getItem(STORAGE_KEY);
	return stored === "light" || stored === "dark" || stored === "system"
		? stored
		: "system";
};

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(readStored);

	useEffect(() => {
		applyTheme(theme);
		if (theme !== "system") return;
		/**
		 * Only `system` follows OS changes; an explicit choice changing at sunset would be something the
		 * person did not do.
		 */
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyTheme("system");
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [theme]);

	const setTheme = useCallback((next: Theme) => {
		window.localStorage.setItem(STORAGE_KEY, next);
		setThemeState(next);
	}, []);

	return (
		<ThemeContext.Provider value={{ theme, setTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeState {
	const context = useContext(ThemeContext);
	if (!context) throw new Error("useTheme was called outside ThemeProvider");
	return context;
}
