import type { LoginMethodProvider } from "@rowcat/domain";

/**
 * Copy for the account screen. This app's tests do not render screens, so copy as values lets pure
 * tests check it and gives static scans one place to catch words that must not be promised (review,
 * deadline, coming soon).
 */

export const ACCOUNT_TITLE = "Account";

/** Accessible name of the header account menu; same sentence as the web `aria-label`. */
export const accountMenuLabel = (nickname: string): string =>
	`${nickname}'s account menu`;

export const ACCOUNT_MENU_ITEM = "Account";
/**
 * Settings folded into this menu from a header icon. It answered whether something calls you on
 * every screen but not how often; a brief-visit destination as an always-visible target makes every
 * screen noisier (header of `features/shell/shell-utilities.tsx`).
 *
 * The word is the screen's own name rather than an action like `Open settings`: every item here is a
 * destination and only `Sign out` is an action, so that contrast should read.
 */
export const ACCOUNT_MENU_SETTINGS = "Settings";
export const ACCOUNT_MENU_SIGN_OUT = "Sign out";

/** Guest: says why it cannot be seen instead of bouncing to login (same as `/chats`). */
export const ACCOUNT_GUEST = {
	title: "Sign-in required",
	description:
		"You can manage your account details and profile after signing in.",
	action: "Sign in",
} as const;

/** `unavailable` is not signed-out; asking again is what can be done here. */
export const ACCOUNT_UNAVAILABLE =
	"Couldn't check your session. Check your connection and try again.";
export const ACCOUNT_RETRY_LABEL = "Try again";

/**
 * Notice for restricted accounts: one fact and what still works. `approved` draws nothing (an
 * always-visible badge is decoration; the web `StatusNotice` made the same call). Sanction reasons
 * and appeals belong to personal moderation, and facts absent from `Viewer` are not invented.
 */
export const ACCOUNT_STATUS_NOTICE = {
	suspended: "This account is suspended.",
	banned: "This account is banned.",
} as const;
export const ACCOUNT_STATUS_NOTE =
	"Publishing and interactions are restricted, but you can still check account details, change content display and sign out.";

export const PROFILE_SECTION_TITLE = "Profile";
export const PROFILE_SECTION_DESCRIPTION =
	"Your nickname and bio appear on your public profile and published stories.";
export const PUBLIC_PROFILE_LINK_LABEL = "View public profile";

export const NICKNAME_LABEL = "Nickname";
export const BIO_LABEL = "Bio";
export const BIO_PLACEHOLDER = "Write a short bio.";
export const BIO_LOAD_FAILED =
	"Couldn't load your bio. Please try again in a moment.";

export const SAVE_LABEL = "Save";
export const SAVING_LABEL = "Saving…";
export const SAVED_LABEL = "Saved";

/**
 * Tells a restricted account why it is locked; same sentence rule as the web `restrictionNote`. The
 * object arrives as a whole phrase (`your bio`): building it from a bare field name would need
 * per-field articles and possessives, which are not worth implementing here.
 */
export function restrictionNote(
	status: "suspended" | "banned",
	target:
		| "your nickname"
		| "your bio"
		| "your profile photo"
		| "your pinned works",
): string {
	return status === "banned"
		? `This account is banned, so you can't change ${target}.`
		: `This account is suspended, so you can't change ${target}.`;
}

/**
 * Copy for the pinned-works field; same words as web `pinned-stories-field.tsx`. The limit comes
 * from the contract constant (`PROFILE_PINNED_STORY_LIMIT`), since a hand-written `3` would become
 * false only in this app when the limit changes.
 */
export const PINNED_LABEL = "Pinned works";
export const pinnedDescription = (limit: number): string =>
	`Pin up to ${limit} at the top of your public profile.`;
export const PINNED_EMPTY = "No pinned stories.";
export const PINNED_LOAD_FAILED = "Couldn't load featured stories.";
export const PINNED_ADD_LABEL = "Add story";
/**
 * Unpinnable works are mixed in (e.g. made private on another device). The chosen order is kept and
 * the sentence says what to remove (`pinned_story_unavailable`).
 */
export const PINNED_UNAVAILABLE =
	"Some stories can't be pinned. Remove the ones that aren't public and save again.";
export const pinnedMoveUpLabel = (title: string): string =>
	`Move ${title} earlier`;
export const pinnedMoveDownLabel = (title: string): string =>
	`Move ${title} later`;
export const pinnedRemoveLabel = (title: string): string => `Unpin ${title}`;
/** Work with an empty title; same word as the `Create` work list. */
export const UNTITLED_WORK = "Untitled";

export const PINNED_PICKER_TITLE = "Add featured story";
export const PINNED_PICKER_DESCRIPTION =
	"Only stories visible on your public profile can be chosen.";
export const PINNED_PICKER_EMPTY = "No more public stories to choose.";
export const PINNED_PICKER_LOAD_FAILED = "Couldn't load the story list.";
export const PINNED_PICKER_MORE = "Show more";
export const PINNED_PICKER_CLOSE = "Close";
export const CONTENT_SECTION_TITLE = "Content display";
/**
 * Name of the switch; not adult verification. If this word became 'verification', users would read
 * that turning it on verifies them (web `content-section.tsx` header).
 */
export const SHOW_ADULT_LABEL = "Show adult content";
export const SHOW_ADULT_DESCRIPTION =
	"When off, adult stories don't appear in the gallery or story pages.";

/**
 * The three ineligible cases are told apart; same split and reason as the web. `unverified` and
 * `minor` now have the verification action beside them (`features/adult-verification/`), yet these
 * sentences state facts only: what to do is said by the adjacent button, and 'verify to see adult
 * works' would read as verification being the road to adult content (eligibility and display are
 * different decisions). `child` still gets no action: that account has no such procedure, and the
 * server refuses with `requireNonChild`.
 */
export const ADULT_UNAVAILABLE_TITLE = {
	child: "This account is under 14.",
	unverified: "This account hasn't completed identity verification.",
	minor: "This account is under 19.",
} as const;

export const ADULT_UNAVAILABLE_NOTE = {
	/** Does not say 'once you complete verification'; that sentence is false for under-14s. */
	child:
		"Adult stories aren't shown, and the setting can't be turned on. All-ages stories and conversations are available as usual.",
	unverified:
		"Adult content display can only be set on accounts that completed identity verification.",
	/** Worded so it does not read as 'change your age'. */
	minor: "Adult content isn't shown.",
} as const;

/**
 * On iOS the place to turn display on is the web. This is a different axis from verification ending
 * in the app (`adult-content-policy.ts` holds the table). The sentence separates the two and must
 * not read as 'verify to see'; this person has already verified.
 *
 * Mentioning login up front is a rule too: the app session does not follow into the browser, and
 * unannounced the login wall reads as breakage.
 */
export const ADULT_ENABLE_ON_WEB_NOTE =
	"You can turn on adult content display on the web. Sign in on the web and set it on the account screen. Once on, it shows in this app too, and you can turn it off here.";
export const ADULT_ENABLE_ON_WEB_LABEL = "Set on the web";

/**
 * Confirmation before enabling on Android, so it is not a single tap. Letting adult UGC onto the
 * screen is close to turning off a filter, which warrants two steps. The copy does not recommend:
 * it states four facts (what becomes visible, who the setting is for, that it is reversible, and
 * that report and block remain).
 */
export const ADULT_ENABLE_CONFIRM_TITLE = "Show adult content?";
export const ADULT_ENABLE_CONFIRM_DESCRIPTION =
	"This setting is for adult users. Turning it on shows adult stories other users made in the gallery and search. You can turn it off again at any time, and reporting and blocking stay available.";
export const ADULT_ENABLE_CONFIRM_LABEL = "Show";

/**
 * Text, not colour, states the status, and the text matches the web
 * (`apps/web/src/features/account/email-section.tsx`). These used to be `Confirmed`·`Not confirmed`, which
 * disagreed with that file's own `Verified`·`Verification needed`, so two screens called the same state by different
 * words.
 */
export const EMAIL_VERIFIED_LABEL = "Verified";
export const EMAIL_UNVERIFIED_LABEL = "Verification needed";
/**
 * Creation time of the auth account, not guaranteed equal to the public profile's join date (see
 * the `AccountDetails.createdAt` note), so the label says so.
 */
export const ACCOUNT_INFO_CREATED_LABEL = "Account created";

/**
 * Technical name to readable name; same table as web `login-method-label.ts`. It is a `Record` so a
 * new `LoginMethodProvider` value breaks compilation instead of drawing an unknown provider raw.
 */
export const LOGIN_METHOD_LABEL: Record<LoginMethodProvider, string> = {
	credential: "Email",
	/** Brand names are not translated; the screens the user lands on use that name. */
	google: "Google",
	apple: "Apple",
	/** The Korean spelling is the service's official name. */
	kakao: "Kakao",
};

export const DATA_SECTION_TITLE = "Data";
export const DATA_SECTION_DESCRIPTION =
	"Explains what is stored on this account and this device.";
/**
 * States the real storage model; 'all data is stored in the cloud' is false. The source of truth
 * for conversations and drafts is this device.
 */
export const DATA_LOCAL_NOTE =
	"Conversations and drafts in progress are saved on this device.";
/** Sign-out closes access without erasing; hiding that would mislead users. */
export const DATA_LOGOUT_NOTE =
	"Signing out doesn't erase this device's data; sign in again with the same account to continue.";

export const DATA_SYNC_SUBSECTION_TITLE = "Sync between devices";
/**
 * Not called 'real time' (other devices' changes arrive when the app reopens or returns to the
 * screen, possibly minutes later) nor 'backup' (it reads as us being able to recover it, the
 * opposite of this feature's design).
 */
export const DATA_SYNC_SUBSECTION_DESCRIPTION =
	"Conversations and drafts are encrypted and kept on this device, and you can continue on other devices too. Only encrypted data is stored on the server, and the server can't read it.";

export const DELETE_SECTION_TITLE = "Delete account";
export const DELETE_SECTION_NOTE = "A deleted account can't be restored.";
export const DELETE_TRIGGER_LABEL = "Delete account";

export const DELETE_DIALOG_TITLE = "Delete your account?";
export const DELETE_DIALOG_DESCRIPTION =
	"Account deletion happens immediately and can't be undone.";

export const DELETE_REMOVED_TITLE = "What gets deleted";
/**
 * What the server actually deletes (`apps/api/src/services/account/deletion.ts`); transcribed from
 * that implementation, not guessed.
 */
export const DELETE_REMOVED_ITEMS = [
	"Your account and sign-in details",
	"Your profile and favorites, follows and blocks",
	"Notifications",
	"Data kept for sync between devices",
	"Conversations and drafts saved on this device",
	"The sync key remembered on this device",
] as const;

export const DELETE_REMAINS_TITLE = "What may remain";
/**
 * Does not say everything is deleted everywhere immediately: the server cannot erase other devices'
 * storage, and server policy keeps public works with identity detached.
 */
export const DELETE_REMAINS_ITEMS = [
	"Publicly published stories — they may remain with the author details removed",
	"Conversations and drafts already stored on other devices — they disappear only when deleted on that device",
] as const;

export const DELETE_PASSWORD_LABEL = "Current password";
/** Social-only accounts: says up front why deletion works (or not) instead of a blank password field. */
export const DELETE_FRESH_SESSION_NOTE =
	"For security, deletion only works after a recent sign-in. If it's refused, sign out, sign in again and try.";

export const DELETE_CONFIRM_LABEL = "Delete account";
export const DELETE_CONFIRMING_LABEL = "Deleting account…";
export const DELETE_CANCEL_LABEL = "Cancel";

export const DELETE_GUIDE_LINK_LABEL = "See what gets deleted";

/** Deletion does not start without account details; when unsure, stop. */
export const DELETE_ACCOUNT_LOADING = "Checking your account details.";
export const DELETE_ACCOUNT_OFFLINE =
	"You're not connected, so deletion can't proceed right now. It reloads once you're connected.";
export const DELETE_ACCOUNT_LOAD_FAILED =
	"Account details couldn't be loaded, so deletion can't proceed right now.";

export const DELETION_PURGING_TITLE = "Deleting account…";
export const DELETION_PURGING_NOTE =
	"Your account was deleted, and the data stored on this device is being cleared. Please wait a moment.";

/** Two facts are told apart; 'deletion failed' would be false because the account really is gone. */
export const DELETION_CLEANUP_FAILED_TITLE = "Your account was deleted";
export const DELETION_CLEANUP_FAILED_NOTE =
	"However, clearing the conversations, drafts and sync key left on this device didn't finish. You can try clearing again.";

export const DELETION_RETRY_CLEANUP_LABEL = "Clean up again";
export const DELETION_GO_LOGIN_LABEL = "Go to sign-in";
