import { z } from "zod";

/**
 * Visibility vocabulary: the same four values as the server column (story_visibility).
 *
 * It lives in its own file because its consumers import each other. The publish contract
 * (publication.ts) takes what to publish as, the public projection (gallery.ts) reports what a
 * story is, and the publish response reuses StoryDto. Placing the vocabulary in either would create
 * an import cycle, and zod schemas evaluated at module top level would then depend on
 * initialization order.
 *
 * Vocabulary and policy are separate. Publish can point only to public, unlisted, or private.
 * archived is rejected there, because archiving is a state transition of an already published work
 * with its own endpoint (story-lifecycle.ts). The value stays in the vocabulary because it already
 * exists on the read side, and removing it would freeze policy into the transport format.
 *
 * `unlisted` is not in lists but opens by link. It is a state value rather than a boolean, for the
 * same reason the server merged two legacy booleans into one column: exclusive states split into
 * booleans leave unrepresentable combinations such as private && unlisted. The meaning of the
 * values lives in story.ts in @rowcat/domain.
 */
export const STORY_VISIBILITIES = [
	"public",
	"unlisted",
	"private",
	"archived",
] as const;
export const StoryVisibility = z.enum(STORY_VISIBILITIES);
export type StoryVisibility = z.infer<typeof StoryVisibility>;
