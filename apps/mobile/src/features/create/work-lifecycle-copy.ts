import {
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
} from "@rowcat/contracts";
import type { StoryLifecycleAction, StoryVisibility } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * What the lifecycle actions on the `Published` row **tell the person**.
 *
 * **The rules are not here.** `storyLifecycleActions` in `@rowcat/domain` decides which actions are
 * available, and the server re-checks with the same rules. If the screen rewrote that table, the
 * day the transition table changes this app would keep the old rules, and the symptom would be a
 * button that is pressed and answers 409, which is silent.
 *
 * Everything here is a **promise**. The confirmation copy is the last sentence read before an
 * irreversible action, and if it disagrees with actual server behavior, the mismatch shows only in
 * the irreversible direction: "will not be deleted" written while it gets deleted, or "can be
 * restored" written while it cannot. So it must be checkable without rendering, which is why this
 * file has no React.
 */

export const WORK_LIFECYCLE_LABEL: Record<StoryLifecycleAction, string> = {
	publish: "Public",
	unlist: "Switch to link-only",
	unpublish: "Switch to private",
	archive: "archive",
	restore: "Restore",
};

export const WORK_LIFECYCLE_PENDING_LABEL: Record<
	StoryLifecycleAction,
	string
> = {
	publish: "Making public…",
	unlist: "Switching…",
	unpublish: "Switching…",
	archive: "Archiving…",
	restore: "Restoring…",
};

/** Visibility name tag: the word the badge reads. */
export const WORK_VISIBILITY_LABEL: Record<StoryVisibility, string> = {
	public: "Public",
	unlisted: "Link only",
	private: "Private",
	archived: "Archived",
};

/**
 * The **weight** of each visibility state. Same table as web's `VISIBILITY_BADGE`
 * (`apps/web/src/features/create/creator-work-card.tsx`).
 *
 * ⚠️ For a while this app drew everything with `Badge`'s default (`secondary`). That compiled, and
 * the screen looked plausible, but **every state folded into one gray**, so someone scanning the
 * list could not tell a published work from an archived one. That distinction is exactly why this
 * column exists.
 *
 * `unlisted` does not get the filled badge, same as web: its weight depends on "is in the
 * catalogue".
 *
 * It is a `Record` on purpose. A new value in the vocabulary **breaks compilation** here; written
 * as a ternary, a new state would silently fall to the default.
 */
export const WORK_VISIBILITY_BADGE: Record<
	StoryVisibility,
	"default" | "secondary" | "outline"
> = {
	public: "default",
	unlisted: "outline",
	private: "outline",
	archived: "secondary",
};

export interface WorkLifecycleConfirm {
	title: string;
	/** What happens. Several lines because the text must also say what does **not** happen. */
	description: string;
	confirmLabel: string;
}

/**
 * Whether the action needs confirmation. `null` means run it immediately.
 *
 * All five are reversible, but **reversing them costs different amounts**:
 *
 * ```text
 * publish     confirm     others can see it; once someone has seen it, unpublishing cannot undo that
 * unlist      confirm     same: it is only off the list, and people holding the link open it the same way
 * archive     confirm     disappears from every public surface (easy to read as deletion)
 * unpublish   no confirm  a withdrawing action; if pressed by mistake, publishing again restores the state
 * restore     no confirm  returns to private; nothing visible from outside changes
 * ```
 *
 * Confirmation on every action makes the dialog go unread, and then the three that must be read go
 * unread too. **Why `unlist` requires confirmation**: the words sound safe. Someone who reads `Link
 * only` as a kind of private and presses it on a private work opens the work to the outside at that
 * moment.
 *
 * **The archive copy starting with "will not be deleted" is the most important line in this
 * function.** The word `archive` reads as "not deleted" only to people who know archiving; to most
 * people it is an action that makes the work vanish from lists. **That restoring is not publishing
 * is also stated here**, because restore itself has no confirmation dialog (nothing visible from
 * outside changes).
 */
export function workLifecycleConfirm(
	action: StoryLifecycleAction,
	title: string,
): WorkLifecycleConfirm | null {
	switch (action) {
		case "publish":
			return {
				title: `Make "${title}" public?`,
				description:
					"Making it public puts it in the gallery where anyone can see it. There's no review step — it goes public the moment you press. You can make it private again at any time.",
				confirmLabel: "Public",
			};
		case "unlist":
			return {
				title: `Make "${title}" link-only?`,
				description:
					"It won't show in the gallery, search or creator profile. Anyone with the link can open it and start a conversation — there's no password or expiry. You can make it public or private again at any time.",
				confirmLabel: "Link only",
			};
		case "archive":
			return {
				title: `Archive "${title}"?`,
				description:
					"The story isn't deleted. The cover and the views and favorites so far stay too. Archiving removes it from the gallery and the story address, and it takes no new comments. You can restore it later as private — restoring doesn't make it public again.",
				confirmLabel: "archive",
			};
		case "unpublish":
		case "restore":
			return null;
	}
}

/**
 * Failure copy, **split by server error code** (not by HTTP status).
 *
 * Both rejections are 409, but the user's next step differs: an archived work needs restoring
 * first, while restoring a public work is never the next step at all. Both codes are reached only
 * **when the list is stale** (the screen draws only actions possible in the current state), so the
 * copy tells the user to look at the list again rather than retry.
 */
export function workLifecycleErrorMessage(
	action: StoryLifecycleAction,
	error: unknown,
): string {
	if (isRowCatApiError(error)) {
		if (error.code === STORY_LIFECYCLE_ERROR_CODE.archived)
			return "This story is already archived. Restore it, then try again.";
		if (error.code === STORY_LIFECYCLE_ERROR_CODE.notArchived)
			return "This story isn't archived. Please refresh the list.";
		/**
		 * Adult eligibility applies **only to the two actions that send a work outward** (`publish` and
		 * `unlist`). The person's next step is identity verification, not pressing again, so folding it
		 * into a generic failure would make it a dead end forever.
		 */
		if (error.code === STORY_PUBLISH_ERROR_CODE.adultNotPermitted)
			return "Only members who completed adult verification can make adult stories visible to others.";
		if (error.status === 404) return "The story couldn't be found.";
	}
	return `Couldn't ${WORK_LIFECYCLE_LABEL[action]}. Please try again in a moment.`;
}
