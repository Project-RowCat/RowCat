/**
 * The navigation model of the settings screen: one list of destinations.
 *
 * Same location, same set and same vocabulary as the web's `features/settings/settings-nav.ts`. The
 * module is pure because this app's tests do not render screens, so a list inside a component could
 * only be checked by hand.
 *
 * Only screens that exist today are listed. Values such as notifications, language, text size,
 * sound, start screen, data export or developer settings are not added in advance: a vocabulary
 * entry makes the screen draw it, even as a disabled row, and users read that as a coming feature.
 *
 * Account management is deliberately absent. It is a route to another screen (`/account`), not a
 * settings category; listing it here would imply that account settings live under `/settings`,
 * blurring the boundary between the two screens in the navigation row.
 */

/** Settings screens that exist. A category is added only together with its screen, in the same commit. */
export type MobileSettingsCategory = "general" | "ai" | "persona";

export interface MobileSettingsNavItem {
	category: MobileSettingsCategory;
	label: string;
	/**
	 * One route.
	 *
	 * `General` maps to `/settings` on purpose. A separate `/settings/general` would give the same screen
	 * two addresses with no way to say which is canonical (the create workspace omits its default tab
	 * from the address for the same reason). The web's list uses the same three addresses.
	 */
	route: "/settings" | "/settings/ai" | "/settings/personas";
}

export const MOBILE_SETTINGS_NAV: readonly MobileSettingsNavItem[] = [
	{ category: "general", label: "General", route: "/settings" },
	{ category: "ai", label: "AI", route: "/settings/ai" },
	/**
	 * Personas are an account asset, not a child of any conversation (`persona.ts` in `@rowcat/chat`).
	 * That is why the library lives here rather than inside conversation settings. The persona picker
	 * in room settings stays; it decides which copy is pinned to this conversation, not the list
	 * itself.
	 */
	{ category: "persona", label: "Persona", route: "/settings/personas" },
] as const;

/** Every address this navigation model knows. Also the set of values a post-login return can pick. */
export type MobileSettingsRoute = MobileSettingsNavItem["route"];

/**
 * The settings screen to return to after signing in.
 *
 * The reason this exists is one sentence: a guest who opens `/settings/ai` directly and signs in
 * must come back to `/settings/ai`. For a while the value here was the literal `"/settings"`, so
 * anyone who entered through the AI or personas address arrived somewhere other than the screen
 * they wanted. It is not an error, so nobody reports it.
 *
 * The current path is deliberately not passed through. Reading `usePathname()` and forwarding it
 * would make the return address a value the user can shape, and Better Auth's Expo client turns it
 * into a deep link (see the header of `lib/return-path.ts`: that one place is where phishing would
 * enter). This returns one of the three values the module already knows; values outside the
 * category vocabulary cannot be constructed from the type.
 */
export function settingsLoginRedirect(
	category: MobileSettingsCategory,
): MobileSettingsRoute {
	const item = MOBILE_SETTINGS_NAV.find((entry) => entry.category === category);
	/**
	 * A category missing from the list cannot be expressed (the vocabulary has three values), but a
	 * fallback exists anyway: sending the user to the settings home beats sending them to a
	 * non-existent address.
	 */
	return item?.route ?? "/settings";
}

/**
 * The way out of settings: a hand-off to another screen, not a category.
 *
 * It is kept out of the category list on purpose. Nickname, email, login methods, passkeys,
 * sessions, content display, sync and account deletion all belong to the account screen, and
 * settings draws none of those values. Two places editing the same value would make it unclear
 * which one is authoritative.
 */
export const MOBILE_SETTINGS_ACCOUNT_LINK = {
	route: "/account",
	label: "Manage account",
} as const;

/** Screen title. The header and the navigation row's accessible name use the same word. */
export const SETTINGS_TITLE = "Settings";

/** Accessible name of the category row, telling assistive technology what the row selects. */
export const SETTINGS_NAV_LABEL = "Settings categories";

/** One line drawn at the top of each category screen. States the same fact as the web's screen. */
export const SETTINGS_CATEGORY_DESCRIPTION: Record<
	MobileSettingsCategory,
	string
> = {
	/**
	 * ⚠️ **Differs from the web's value, because of a section that exists only in this app.**
	 *
	 * `Push notifications` is this device's delivery setting, so it is neither display nor stored data. The web has
	 * no such section (we did not build web push). Keeping the sentence identical to the web would
	 * drop one of this screen's three sections from the description.
	 */
	general:
		"Manage how this app looks and this device's notifications and stored data.",
	ai: "Generation settings applied to new conversations by default. Applies only to this device.",
	persona:
		"Save the roles you play in conversations and pick them again across conversations.",
};

/**
 * Path → current category. **The only route by which the navigation row learns where it is.**
 *
 * This function is the most recent change in this file. The category used to be a literal held by
 * the screen file (`<SettingsScreen category="ai">`). In that structure each category was a stack
 * screen, so the navigation row was rebuilt from scratch whenever the category changed, and the
 * active indicator appeared at the new position instead of sliding between siblings (it does slide
 * on the web).
 *
 * The row now belongs to the layout, so it survives a category change (`app/settings/_layout.tsx`),
 * and the only question it asks about its position goes to the address. Not keeping shadow state
 * (`selectedCategory`, `visualSelectedTab`) is expressed here as one function.
 *
 * Pure on purpose: this app's tests do not render screens, so a decision inside a hook could only
 * be checked by hand.
 *
 * **Unknown paths are `general`.** This runs under `/settings` already (the layout route), and an
 * unknown tail there is a non-existent screen that the router already answers. Throwing here would
 * make the whole navigation row disappear.
 */
export function settingsCategoryForPath(
	pathname: string,
): MobileSettingsCategory {
	/**
	 * Strip only one trailing slash. `usePathname()` returns just the path, with no query or fragment,
	 * but this normalization does not rely on that fact.
	 *
	 * It is not written as a regex for another reason: this repository's static scan treats "a regex
	 * that strips a trailing slash" as the marker of code that assembles canonical web addresses
	 * (`lib/parity-boundaries.test.ts`). Using that shape here would put this function on that list by
	 * mistake, and the check exists to catch where the origin leaks.
	 */
	const path = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	const item = MOBILE_SETTINGS_NAV.find((entry) => entry.route === path);
	return item?.category ?? "general";
}
