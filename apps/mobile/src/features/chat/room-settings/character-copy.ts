/**
 * Copy for the characters screen; the rules live in `@rowcat/chat`'s `character.ts`.
 *
 * The wording must match the web's counterpart file. It is duplicated because the pure package
 * holds no Korean; with only two consumers, divergence shows when they are put side by side.
 */

/**
 * Settings-home row summary; states both the added count and the story-defined count. Only the
 * added count would lie for rooms migrated from legacy, which already have story characters while
 * an empty list reads as "nobody in this conversation".
 */
export function characterRowSummary(added: number, fromStory: number): string {
	if (added === 0 && fromStory === 0)
		return "Add characters to this conversation";
	if (fromStory === 0) return `${added} added`;
	if (added === 0) return `${fromStory} set by the story`;
	return `${fromStory} from the story · ${added} added`;
}
