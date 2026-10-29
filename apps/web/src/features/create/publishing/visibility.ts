import type { StoryVisibility } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The visibility states the publish screen can choose. There are three.
 *
 * The vocabulary has four (`STORY_VISIBILITIES`), but `archived` is not a publish destination:
 * publishing and the states a work can be in are different axes. Drawing `STORY_VISIBILITIES`
 * directly would offer archive as an option, and choosing it would hit a 403 from the server.
 *
 * `unlisted` is the third choice because it is a publish destination. Link sharing is also a state
 * transition for an already published work (`unlist`), but it can be published directly. Requiring
 * 'publish as public, then unlist' would leave the work in the catalog for a few seconds, and that
 * cannot be undone.
 *
 * The module is pure because the copy is a promise. The hint is the last sentence read before
 * pressing `Publish`, so it must match actual server behavior. A mismatch would show up only in
 * directions the user cannot undo (believing a link is public when it is private, or the reverse).
 * It must be checkable without rendering.
 */
export type PublishVisibility = Exclude<StoryVisibility, "archived">;

/**
 * Visibility is ordered narrowest to widest: `only me` → `people with the link` → `anyone`. The order itself explains
 * each option. Alphabetical or vocabulary-declaration order would put `Link only` at one end and erase
 * this ladder.
 */
export const PUBLISH_VISIBILITIES: readonly PublishVisibility[] = [
	"private",
	"unlisted",
	"public",
] as const;

/**
 * The consequence of each choice, not a name tag. The badge already says `Public` or `Private`; the hint
 * answers 'if I pick this, who can see it?'
 *
 * The public option must not imply review. There is no pre-publication review, so a sentence like
 * `public after review` is false, and a creator who believes it leaves thinking the work is not up yet.
 *
 * The link-sharing sentence matters most in this table. That state promises only 'not listed'.
 * Anyone with the address can open it, with no password and no expiry. Stating stronger privacy
 * here would endanger a creator who shares a link based on it; the blocking copy makes the same
 * judgment.
 */
export const publishVisibilityHint = (visibility: PublishVisibility): string =>
	translator("create")(`visibility.hint.${visibility}`);

/**
 * The labels printed on the publish buttons. What happens must be clear from the button text alone.
 */
export const publishButtonLabel = (visibility: PublishVisibility): string =>
	translator("create")(`visibility.button.${visibility}`);

/**
 * Maps a saved draft value to a value this screen can draw.
 *
 * The draft's `visibility` field can hold all four vocabulary values (the storage model uses the
 * contract vocabulary directly). Data from a transfer, another device, or hand-edited data may
 * carry `archived`. An empty selection would leave the user unsure what they are publishing, so the
 * value folds to private: the narrowest of the three, which the publish button states.
 *
 * Use an allow-list. `=== 'archived' ? 'private' : visibility` would pass any new vocabulary value
 * through unchanged, and the server would reject it.
 */
export const toPublishVisibility = (
	visibility: StoryVisibility,
): PublishVisibility => {
	switch (visibility) {
		case "public":
		case "unlisted":
		case "private":
			return visibility;
		case "archived":
			return "private";
	}
};
