import { translator } from "#/lib/i18n/current.ts";
/**
 * Copy for the character screen. The rules live in `character.ts` in `@rowcat/chat`.
 *
 * ⚠️ The copy must match the same file on mobile. It is duplicated because the pure package keeps
 * product copy out, and since there are only two consumers, differences show up when the two are
 * compared.
 */

/**
 * One-line summary for the settings home. It states both the number added here and the number the
 * story set.
 *
 * Stating only the added count is false in a room migrated from legacy: that room already has
 * characters the story defined, and an empty list would read as "nobody in this conversation".
 */
export function characterRowSummary(added: number, fromStory: number): string {
	const t = translator("chat");
	if (added === 0 && fromStory === 0) return t("characters.summary.none");
	if (fromStory === 0) return t("characters.summary.added", { added });
	if (added === 0) return t("characters.summary.story", { fromStory });
	return t("characters.summary.both", { fromStory, added });
}
