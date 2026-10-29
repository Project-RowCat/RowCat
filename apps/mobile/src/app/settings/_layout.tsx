import { Slot, usePathname } from "expo-router";
import { settingsCategoryForPath } from "../../features/settings/settings-nav.ts";
import { SettingsShell } from "../../features/settings/settings-shell.tsx";

/**
 * Settings workspace: stands the header and navigation row once.
 *
 * This file exists for motion. On web the layout route owns the settings navigation list, so it
 * survives a category change and the active indicator can slide between siblings. Here each
 * category was a stack screen, so `General` → `AI` replaced the whole screen and the navigation row and
 * indicator were rebuilt. That was once recorded as an intended difference, but the blocker was
 * this app's route structure, not the platform; nested layout + `<Slot />` fixes it.
 *
 * `<Slot />` rather than `<Stack />`: a stack would make category switches screen transitions
 * again. `Slot` renders the chosen child with no transition of its own, so what changes is one cell
 * inside the shell.
 *
 * The route stays the source of truth: the category derives from the address
 * (`settingsCategoryForPath`), not from `useState` beside a `router.replace`, which would make deep
 * links, back and restoration follow a second source that eventually disagrees. `usePathname()` is
 * used because it names the child being drawn; `useSegments()` depends on segment count and group
 * notation and would silently count something else when a route folder is added.
 *
 * No auth decision here: `SettingsShell` owns it, because guests are not redirected to login in
 * this app and the outcome is content to draw, not a redirect.
 */
export default function SettingsLayout() {
	const pathname = usePathname();

	return (
		<SettingsShell category={settingsCategoryForPath(pathname)}>
			<Slot />
		</SettingsShell>
	);
}
