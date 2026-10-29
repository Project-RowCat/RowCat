import { isStoryShareable, type Story } from "@rowcat/domain";
import { storyWebUrl } from "../../lib/public-web.ts";

/**
 * Sharing a work: **what can be handed over, and what gets included.** These are pure decisions.
 *
 * Opening (the OS share sheet) is done by `share-control.tsx`; this file holds only the two
 * questions before that. This app's tests do not render screens, so if the decision lived inside
 * the component the only way to check it would be trying it by hand. And these decisions fail
 * silently when wrong (a private work's link leaving the device raises no error).
 *
 * ## Can it be handed over: only when both are true together
 *
 * ```text
 * an origin exists        without one there is no address to build (a guessed domain is a 404 for the recipient)
 * opens from outside      a private or archived work is a 404 for the recipient: a dead end, not a link
 * ```
 *
 * The second is the point of this file. A private work's detail **opens for its owner**, so a share
 * button there looks natural, but whoever receives the link gets a 404, and the sender cannot tell
 * what went wrong. So **it does not point at a path that does not exist** (the web link on the
 * account screen made the same call — `lib/public-web.ts`).
 *
 * **`Link only` changed this decision from "is it public" to "does it open".** An unlisted work is
 * simply absent from lists but opens for anyone holding the address, and **sharing is exactly what
 * someone who chose that state wants to do**; blocking it here would leave that feature without a
 * handle. The rule lives in one domain predicate (`isStoryShareable`), and this file does not set
 * rules of its own: web's share action calls the **same function**, so there is no place where the
 * two apps could disagree on which states get handed over.
 *
 * ## Only the title and the address are carried
 *
 * Description, tags, creator, cover, hashtags and promotional text are not included. This payload
 * **leaves through whichever app the user picks** and persists on someone else's device, so any
 * sentence we added would become words the person never wrote. The adult-content display is not
 * included either: the screen that opens the link states that from the server's verdict, and
 * writing it into the share text would surface that word in the recipient's notification preview.
 *
 * `message` is not built separately, for the same reason. iOS carries both `url` and `message` when
 * given both; Android has no `url` axis at all and folds into `message` alone. Joining the title
 * and address into one string here would make iOS's preview card disappear. So the payload carries
 * the **shape the platform understands**: `title` is the Android picker's title, and `url` is the
 * value actually handed over.
 */

export interface StorySharePayload {
	/** Title for the Android picker. Not included in the text that is handed over. */
	title: string;
	/** The value actually handed over: one canonical web address. */
	url: string;
}

/**
 * Whether this work can be handed over right now: if so, the value that would be carried; otherwise
 * `null`.
 *
 * Boolean and value are not returned separately. Keeping them apart would make the state "can be
 * handed over, but no address" representable, and a screen reaching it would open an empty sheet.
 */
export function storySharePayload(
	story: Story,
	origin: string | null,
): StorySharePayload | null {
	if (!isStoryShareable(story.visibility)) return null;
	const url = storyWebUrl(origin, story.id);
	return url ? { title: story.title, url } : null;
}

/**
 * The action's name. An icon-only trigger reads as just "button".
 *
 * `Share story` rather than `Share` because this screen has more than one thing to share (the comment row
 * also has a report menu): the name says what is being shared.
 */
export const STORY_SHARE_LABEL = "Share story";

/**
 * The failure line. **Cancelling never arrives here.**
 *
 * Opening and dismissing the share sheet is a normal action, not a failure (the image picker's
 * cancel made the same call — `lib/image-picker.ts`). This sentence appears only when the sheet
 * **could not be opened**, and even then the only thing the user can do is press again, so no
 * reason is written (drawing the platform error body would answer no question).
 */
export const STORY_SHARE_FAILURE = "Couldn't share";
