import type { ThemePreference } from "@rowcat/ui-native";
import { APPEARANCE_PREFERENCES } from "../../lib/appearance/preference.ts";
import { deferredGroup } from "../../lib/i18n/instance.ts";

/**
 * Copy for the device appearance. The rules are not here.
 *
 * The vocabulary, the default and the tolerant reads live in `lib/appearance/preference.ts`, and
 * the storage medium sits behind that port. What remains here is the naming (read from the
 * dictionaries, `settings.appearance`) and the **drawing order**.
 *
 * That this is a `Record<ThemePreference, string>` is what the file actually enforces: adding a
 * value breaks this table at compile time first, so no unnamed row can appear.
 *
 * It uses **the same three words** as the web's `appearance-section.tsx`. If the same place said
 * different things in the two apps, users would read it as a different feature.
 */

/**
 * The field is `Screen brightness`, not `Theme`. The section directly below (account colors) is
 * titled `Theme`; while this field used that word too, `Theme` appeared twice on one screen and the
 * title alone could not tell which applied to what. The guest header shortcut uses the same name.
 *
 * The description states **how far it reaches** — the only sentence that tells this apart from the
 * account theme. This value belongs to the device, so sign-in, account switching and local data
 * reset do not touch it.
 */
export const APPEARANCE_COPY = deferredGroup("settings", "appearance");

export const APPEARANCE_LABEL: Record<ThemePreference, string> =
	APPEARANCE_COPY.value;

/** Drawing order: the broadest choice first (follow the OS). It keeps the vocabulary's order. */
export const APPEARANCE_ORDER = APPEARANCE_PREFERENCES;
