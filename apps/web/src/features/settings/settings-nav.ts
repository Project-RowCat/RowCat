import { translator } from "#/lib/i18n/current.ts";
/**
 * Navigation model for settings: one list of destinations.
 *
 * Kept as a pure module because two containers (the wide left rail and the narrow horizontal row)
 * must draw the same list. Separate arrays would let one side grow when a category is added, and
 * the bug would show only on narrow screens.
 *
 * Only screens that exist now are listed. Placeholder entries would render as disabled items, which
 * users read as upcoming features. The list grows by adding entries when screens land.
 * create-home-page.tsx follows the same rule for its three slots.
 *
 * Account management is not in this array. It is a handoff to another screen (/account), so listing
 * it here would imply that account settings live under /settings.
 */

/**
 * Settings screens that actually exist. A category is added only together with its screen, in the
 * same commit.
 */
export type SettingsCategory = "general" | "ai" | "persona";

export interface SettingsNavItem {
	category: SettingsCategory;
	/**
	 * A route. It is a path the router knows rather than a free string, so a typo fails the type
	 * check.
	 *
	 * `General` maps to `/settings`, not `/settings/general`. Two addresses for one screen would leave no
	 * answer to which one is canonical. This follows the same rule as the creation workspace, which
	 * omits its default pane from the address.
	 */
	to: "/settings" | "/settings/ai" | "/settings/personas";
}

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
	{ category: "general", to: "/settings" },
	{ category: "ai", to: "/settings/ai" },
	/**
	 * Personas belong to the account, not to any conversation (see persona.ts in
	 * @rowcat/chat).
	 *
	 * This list used to sit under the `Conversations` section with its own /personas address. That placement
	 * contradicted the data: editing a persona meant going through the conversation list, and the
	 * layout diverged from the settings workspace.
	 *
	 * The room settings picker is unchanged. It decides which copy of a persona to bind to this
	 * conversation. This list decides which personas can be chosen at all.
	 */
	{ category: "persona", to: "/settings/personas" },
] as const;

/**
 * An exit to another screen, not a category. A divider separates it from the category list for this
 * reason.
 *
 * Nickname, email, sign-in methods, content display, sync, and account deletion are all owned by
 * the account screen. This constant renders none of those values: two places editing the same value
 * would make it unclear which one is authoritative.
 */
export const SETTINGS_ACCOUNT_LINK = { to: "/account" } as const;

/** Category names, in the render's locale. The category itself is the key, so a new one needs a name. */
export const settingsNavLabel = (category: SettingsCategory): string =>
	translator("settings")(`nav.${category}`);

export const settingsAccountLinkLabel = (): string =>
	translator("settings")("nav.account");
