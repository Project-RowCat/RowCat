import type { ThemePreference } from "@rowcat/ui-native";
import { APPEARANCE_PREFERENCES } from "../../lib/appearance/preference.ts";

/**
 * Copy for the device appearance. The rules are not here.
 *
 * The vocabulary, the default and the tolerant reads live in `lib/appearance/preference.ts`, and
 * the storage medium sits behind that port. What remains here is the Korean and the **drawing
 * order**.
 *
 * That this is a `Record<ThemePreference, string>` is what the file actually enforces: adding a
 * value breaks this table at compile time first, so no unnamed row can appear.
 *
 * It uses **the same three words** as the web's `appearance-section.tsx`. If the same place said
 * different things in the two apps, users would read it as a different feature.
 */

export const APPEARANCE_LABEL: Record<ThemePreference, string> = {
	system: "Follow system setting",
	light: "Light",
	dark: "Dark",
};

/** Drawing order: the broadest choice first (follow the OS). It keeps the vocabulary's order. */
export const APPEARANCE_ORDER = APPEARANCE_PREFERENCES;

export const APPEARANCE_SECTION_TITLE = "Display";
/**
 * This field is `Screen brightness`, not `Theme`. The section directly below (account
 * colors) is titled `Theme`. While this field also used that word, `Theme` appeared twice on one screen,
 * and the title alone could not tell which applied to what. The header shortcut already uses this
 * name (`APPEARANCE_SHORTCUT_LABEL`).
 */
export const APPEARANCE_FIELD_LABEL = "Screen brightness";

/**
 * States **how far it reaches**. It is the only sentence that tells this apart from the account
 * theme.
 *
 * This value belongs to the device, so sign-in, account switching and local data reset do not touch
 * it. Without saying so, users would read it on the same axis as the account colors below, and
 * would have no way to explain why brightness differs on another device.
 */
export const APPEARANCE_FIELD_DESCRIPTION =
	"Follow the system setting or pick the brightness yourself. Applies only to this device.";

/** Accessible name of the guest trigger: a button with only an icon is read just as "button". */
export const APPEARANCE_SHORTCUT_LABEL = "Screen brightness";
