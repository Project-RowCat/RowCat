import { isStoryShareable, type Story } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Work sharing: decides what can be handed off and what is included. This is a pure function.
 *
 * - Same judgement as the mobile file of the same name, via the shared domain predicate
 *   `isStoryShareable`. Two copies would eventually drop link-public, silently.
 * - Shareable only when the origin is known (absent on server render) and the work opens for
 *   outsiders. Private and archived works 404 for recipients, so a link to them is a dead end. The
 *   owner can view their private detail, but the sender of a link cannot tell why the recipient
 *   gets a 404.
 * - The address is the running document's origin plus the canonical route. The origin is not read
 *   from deployment config, since that would let staging hand out production addresses.
 * - There is no address for link-public works. `/stories/:id` is the only canonical route, with
 *   no token, query parameter, or expiry. If the address carried the exposure difference, the
 *   string would become the authorization, a security boundary this feature never promised.
 *   Exposure belongs in the server predicate.
 * - Only the title and the address are included. Description, tags, creator, cover, hashtags,
 *   promo text, and the adult flag are left out. The value leaves for another app and stays on
 *   someone else's device, so any added sentence would be words the sender never wrote, and the
 *   adult keyword would show in the recipient's notification preview.
 */

export interface StorySharePayload {
	/** Title for the system share sheet. The clipboard path does not use it. */
	title: string;
	/** The value actually handed off: one canonical web address. */
	url: string;
}

/**
 * Whether this work can be shared right now. Returns the value to share if so, otherwise `null`.
 *
 * Boolean and value are not returned separately. Splitting them would allow a state where the work
 * is shareable but has no address, and the screen reaching that state would open an empty sheet or
 * copy an empty string.
 *
 * The origin is passed in as an argument. Reading `window` here would force tests to fake a
 * browser, and the app's tests do not render screens.
 */
export function storySharePayload(
	story: Story,
	origin: string | null,
): StorySharePayload | null {
	if (!isStoryShareable(story.visibility)) return null;
	if (!origin) return null;
	return {
		title: story.title,
		/**
		 * The id is encoded even though the server issues it. Current ids are hex without hyphens, so
		 * encoding changes nothing today. Relying on that would make only already-shared addresses break
		 * silently on the day the id rule changes.
		 */
		url: `${origin.replace(/\/+$/, "")}/stories/${encodeURIComponent(story.id)}`,
	};
}

/**
 * The name of the action. An icon-only trigger reads as just 'button'.
 *
 * The label is `Share story`, not `Share it`, because this screen has more than one thing to share (comment
 * rows have a report menu too). The name says what is shared. It matches the mobile wording.
 */
export const storyShareLabel = (): string => translator("story")("share.label");

/**
 * The copy confirmation is a line beside the pressed button, not a toast. The toast layer has no
 * success messages (`lib/toast.ts`). That rule is right here too, but the screen still cannot stay
 * silent: the clipboard is invisible, so a pressed button that did nothing would look the same as
 * one that copied. The line appears in the same place failure would, inline for the remaining
 * interaction surfaces (`docs/design/FAILURE-FEEDBACK.md`).
 */
export const storyShareCopied = (): string =>
	translator("story")("share.copied");

/**
 * The failure line. Cancellation never reaches here.
 *
 * Opening the system share sheet and then dismissing it makes the browser reject with `AbortError`.
 * The user changed their mind, which is not a failure, so nothing is read or said. This line
 * appears only when neither the sheet nor the clipboard could be used, and it gives no reason. The
 * platform error text answers no question, and it is a string this code does not control.
 */
export const storyShareFailure = (): string =>
	translator("story")("share.failed");

/**
 * Dismissing the share sheet is not a failure. `navigator.share` rejects on cancel too, so without
 * telling the two apart, a user who changed their mind would see `Couldn't share`. On mobile,
 * `Share.share` returns dismissal as a normal exit. On the web this distinction has to be made
 * here.
 */
export const isShareAbort = (error: unknown): boolean =>
	error instanceof DOMException && error.name === "AbortError";
