import type { CreateView } from "./create-view.ts";

/**
 * Copy for `Create`; no rules here. Normalization, validation and lifecycle decisions live in the
 * shared packages (`@rowcat/authoring`, `@rowcat/domain`); this file only turns their results into
 * words. Korean stays out of shared packages because rules would become locale-bound (same boundary
 * as `room-library-copy.ts` and `sidebar-copy.ts`). It uses the same words as the web: the same
 * spot saying different things in two apps reads as a different feature.
 */

export const CREATE_TITLE = "Create";

/**
 * `New story`, not `New draft`: users make works, and the draft is just the storage form; naming an internal
 * structure on a button makes the product explain its implementation. The web agrees.
 */
export const CREATE_NEW_LABEL = "New story";
export const CREATE_NEW_PENDING_LABEL = "Creating…";

// Tab labels; a `Record`, so growing the vocabulary breaks compilation first.
export const CREATE_VIEW_LABEL: Record<CreateView, string> = {
	drafts: "Drafts",
	published: "Published",
	analytics: "Analytics",
	comments: "Comments",
};

// Accessible name of the tab picker.
export const CREATE_VIEW_PICKER_LABEL = "Workspace";

export const CREATE_GUEST = {
	title: "Sign in to create stories",
	description:
		"Drafts are stored on this device and synced, encrypted, with your other signed-in devices.",
	action: "Sign in",
} as const;

// Not a sign-out: no sign-in button is drawn; the task is to ask again.
export const CREATE_UNAVAILABLE =
	"Couldn't check your session. Please try again in a moment.";

export const CREATE_STORAGE_ERROR = {
	message: "Couldn't open this device's storage.",
	action: "Try again",
} as const;

/**
 * Empty state of the drafts tab, using the web's words. These three once diverged from the web (`No
 * stories yet` / `Create a new story to get started…` / action `New story`); users read that as a different feature, and
 * `Story` and `Drafts` are different things here, since an empty tab does not mean no published work. The
 * header button is `New story` while this spot says `Create a new story` on purpose (as on the web): the header
 * action is always present so it is short, while the empty-state action is the only next step after
 * a sentence and takes a predicate.
 */
export const CREATE_DRAFTS_EMPTY = {
	title: "No drafts yet",
	description:
		"Drafts are saved on this device. They stay even without a title and without publishing.",
	action: "Create a new story",
} as const;

/**
 * Whether a draft has a published work: two words, not a badge. Follows the web's reason for
 * dropping the badge here (`draft-list.tsx`): a pill per row makes status the loudest thing in the
 * list when the eye should reach the title first. Not hidden either: words, not color, carry the
 * state, and `Published` is the one that stands out because it is the rarer.
 */
export const DRAFT_PUBLISH_STATE = {
	published: "Published",
	unpublished: "Unpublished",
} as const;

export const DRAFT_DELETE = {
	title: "Delete this story?",
	description: "The draft disappears from this device and synced devices.",
	/**
	 * Attached only to drafts that were ever published. The same warning on every delete soon goes
	 * unread, even by those who need it; for an unpublished draft `Published` is someone else's story.
	 */
	publishedNotice:
		"Only the draft is deleted. Stories you've already published stay.",
	confirm: "Delete",
} as const;

/**
 * Failure copy that does not split causes: every failure here is a SQLite write failure (disk,
 * connection closed mid account switch, permission) and the user can do the same thing either way.
 * Drawing the driver's raw text leaves a sentence that names nothing actionable.
 */
export const DRAFT_CREATE_FAILURE = "Couldn't create the story.";
export const DRAFT_DELETE_FAILURE = "Couldn't delete the story.";
export const DRAFT_STRUCTURE_FAILURE = "Couldn't save your changes.";

// Dismisses inline guidance: a failure is a fact that may go away, so the user must be able to
// clear it.
export const DISMISS_LABEL = "Close";

// `Comments` tab: same words as the web's (`comments/panel.tsx`).
export const CREATOR_COMMENTS = {
	empty: {
		title: "No comments received yet",
		description:
			"When others comment on or reply in your published stories, they gather here, newest first.",
	},
	// Session lost; also says the drafts are still on the device.
	reauth: {
		title: "You need to sign in again",
		description:
			"Your sign-in expired, so received comments can't be loaded. Your drafts stay on this device.",
		action: "Sign in",
	},
	moreFailed: "Couldn't load more comments. Please try again.",
} as const;

export const SERVER_PANEL = {
	offline: "Couldn't load because there's no connection.",
	error: "Couldn't load.",
	retry: "Try again",
	/**
	 * One line layered over a held value. Keeps the value but does not pass it off as current: after a
	 * failed background refresh, a value drawn alone reads as live though it is minutes old.
	 */
	stale: "This is the last confirmed value.",
	more: "Show more",
	/**
	 * `Show more` failed: a different sentence from the stale line. The held values are current and only
	 * the next page failed, so the message sits beside the button just pressed.
	 */
	moreFailed: "Couldn't load the next list. Please try again.",
} as const;

export const PUBLISHED_EMPTY = {
	title: "No published stories yet",
	description: "Open a draft and publish it, and it shows up here.",
} as const;

/**
 * Entry row to cover management. Not `Change cover`, since that dialog does three things (upload,
 * replace, delete) and the word must stay true for works with no cover.
 */
export const PUBLISHED_COVER = "Cover";

export const PUBLISHED_EDIT_DRAFT = "Edit draft";
/**
 * The source draft is not on this device; not a failure (published from another device, draft
 * deleted, or migrated in). All are normal and the screen only states the fact.
 */
export const PUBLISHED_NO_DRAFT = "The original draft isn't on this device.";
// Operator hiding: a different axis from the creator's visibility, so it is not folded.
export const WORK_HIDDEN_BADGE = "Hidden by operators";

export const ANALYTICS_EMPTY = {
	title: "No stories to analyze yet",
	description:
		"Publish a story and its views, favorites and comments pile up here.",
} as const;

export const ANALYTICS_SUMMARY_HEADING = "All-time total";
