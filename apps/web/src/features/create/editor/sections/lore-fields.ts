import type { ChatLorePosition } from "@rowcat/contracts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Vocabulary and summary rules for a lore entry: what is shown while the card is collapsed. They
 * are kept out of the component because a collapsed card makes a judgement, and that judgement must
 * be checkable without rendering. Failures are silent: if ten entries all fold to the same word,
 * the list is useless, though no error is raised. Every value produced here is display-only. No
 * code writes the fallback phrase into the record.
 */

/**
 * Called while typing, so empty fragments are dropped: `library, ` yields `[library]`, not two entries with
 * an empty second one. An empty keyword matches nothing in a conversation.
 */
export const splitKeys = (value: string): string[] =>
	value
		.split(",")
		.map((key) => key.trim())
		.filter(Boolean);

/**
 * Labels for the injection positions. Only the three values the prompt assembler actually reads are
 * offered. Legacy axes (`depth`, `group`, `oneshot`, `locked`) are ignored by the current
 * assembler, so exposing them would silently drop the creator's settings. That is worse than the
 * feature being absent.
 */
export const lorePositionLabel = (key: ChatLorePosition): string =>
	translator("create")(`lorePosition.${key}`);

/** Selection order, matching the order in which the prompt includes them. */
const LORE_POSITION_ORDER = [
	"system_top",
	"system_bottom",
	"before_history",
] as const satisfies readonly ChatLorePosition[];

/**
 * Options passed to the Select. Labels are not repeated elsewhere, because the collapsed card's
 * summary reads this same table. Two copies would let the word picked in the list differ from the
 * word shown when collapsed.
 */
export const LORE_POSITION_OPTIONS: {
	value: ChatLorePosition;
	label: string;
}[] = LORE_POSITION_ORDER.map((value) => ({
	value,
	label: lorePositionLabel(value),
}));

export interface LoreSummary {
	/** One line identifying the entry. If there are no keywords, it says so instead. */
	headline: string;
	/**
	 * Whether keywords actually exist. The UI uses this to dim the fallback phrase. It is not derived
	 * by comparing the headline, because a user may type `No keywords` as a keyword. That entry is valid
	 * and would otherwise look empty.
	 */
	hasKeys: boolean;
	/** Axes that must stay visible even when collapsed. Their order is the reading order. */
	meta: string[];
}

/**
 * The headline is the keywords, because they say when the entry is included. Body opening words
 * would make similar entries indistinguishable, and a curator usually looks for the entry a word
 * triggers.
 *
 * `Always include` appears only when it is on. Writing `Keyword match` when it is
 * off would look like an extra axis. Off is the default, so it would sit on every entry and only
 * lengthen the summary.
 */
export function loreSummary(entry: {
	keys: readonly string[];
	constant: boolean;
	position: ChatLorePosition;
	order: number;
}): LoreSummary {
	const t = translator("create");
	const keys = entry.keys.filter(Boolean);
	return {
		headline: keys.length > 0 ? keys.join(", ") : t("lore.noKeywords"),
		hasKeys: keys.length > 0,
		meta: [
			...(entry.constant ? [t("lore.alwaysInclude")] : []),
			lorePositionLabel(entry.position),
			t("lore.priority", { order: entry.order }),
		],
	};
}

/**
 * Whether nothing is written yet. This decides whether a card opens expanded the first time. It
 * answers from the record alone. A 'just added' flag would require the list to remember which id is
 * new, and that would be wrong for entries delivered by sync. Always-include is ignored: new
 * entries have a default for it, so including it would test 'still at defaults' rather than
 * 'empty'.
 */
export const isBlankLore = (entry: {
	keys: readonly string[];
	content: string;
}): boolean => entry.keys.length === 0 && entry.content.trim() === "";
