import type { StoryVisibility } from "@rowcat/domain";
import type { PublishFailureReason } from "./publish-draft.ts";

/**
 * The visibility choices the publish screen offers: three of the four vocabulary values.
 *
 * `archived` is not a publish destination. A work's state and its publish destination are different
 * axes; iterating the whole vocabulary would offer archive here and the creator would meet a server
 * rejection.
 *
 * `unlisted` is a publish destination in its own right. Reaching it as "publish public, then
 * unlist" would briefly put the work in the catalogue, which cannot be undone.
 *
 * Pure module because the copy is a promise: it is the last sentence read before `Publish`, so drift
 * from server behaviour would only surface after an irreversible publish.
 */

export type PublishVisibility = Exclude<StoryVisibility, "archived">;

/**
 * Narrowest exposure first, the same order as the web list. Read top to bottom it goes from "only
 * me" to "people with the link" to "anyone".
 */
export const PUBLISH_VISIBILITIES: readonly PublishVisibility[] = [
	"private",
	"unlisted",
	"public",
] as const;

/**
 * What each choice causes. The wording must not imply review: there is no pre-moderation, so
 * "published after review" would make a creator think the work is not live yet.
 */
export const PUBLISH_VISIBILITY_LABEL: Record<PublishVisibility, string> = {
	private: "Private",
	unlisted: "Link only",
	public: "Public",
};

/**
 * The link-only sentence matters most: that state promises only "not in the list". Anyone with the
 * address can open it, with no password or expiry, so stronger wording would mislead whoever shares
 * it.
 */
export const PUBLISH_VISIBILITY_HINT: Record<PublishVisibility, string> = {
	private: "Only you can see it. You can make it public any time later.",
	unlisted:
		"It isn't shown in lists or search, and only people with the link can use it. Anyone who gets the link can open it.",
	public:
		"It goes up in the gallery the moment you publish, and anyone can see it.",
};

export const PUBLISH_BUTTON_LABEL: Record<PublishVisibility, string> = {
	private: "Publish privately",
	unlisted: "Publish as link-only",
	public: "Publish publicly",
};

export const PUBLISH_PENDING_LABEL = "Publishing…";

/**
 * Confirmation before publishing, only for choices that become reachable from outside. The table is
 * `Partial<Record<…>>` so that asking "is there a value" decides it: a state added later passes
 * through here instead of silently skipping confirmation. Attaching a dialog to all three choices
 * would make it unread, and the two that must be read would go unread with it.
 */
export interface PublishConfirm {
	title: string;
	description: string;
	confirmLabel: string;
}

export const PUBLISH_CONFIRM: Partial<
	Record<PublishVisibility, PublishConfirm>
> = {
	public: {
		title: "Publish publicly?",
		description:
			"It goes up in the gallery the moment you publish, and anyone can see it. There's no review step. You can make it private again at any time.",
		confirmLabel: PUBLISH_VISIBILITY_LABEL.public,
	},
	unlisted: {
		title: "Publish as link-only?",
		description:
			"It won't show in the gallery, search or creator profile. Anyone with the link can open it and start a conversation — there's no password or expiry. You can make it public or private again at any time.",
		confirmLabel: PUBLISH_VISIBILITY_LABEL.unlisted,
	},
};

/**
 * Maps a stored draft value to one this screen can draw. The draft can hold all four vocabulary
 * values; `archived` (from migration, another device or hand-edited data) folds to private, the
 * narrowest choice, which the publish button then states.
 *
 * Written as an allowlist: a `=== "public"` test would fold link-only into private, and new
 * vocabulary values would silently fall to one side.
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

/**
 * Publish failure copy, one branch per reason, because each reason has a different next step. A
 * single "could not publish" sentence would not say what to fix: adult content needs identity
 * verification, an archived work must be restored from `Published`, and a work owned by another draft
 * must be published from that draft.
 */
export function publishFailureMessage(reason: PublishFailureReason): string {
	switch (reason) {
		case "scene_image_invalid":
			return "A scene image wasn't found. Please choose the picture again.";
		case "archived_unavailable":
			return "You can't publish in the archived state.";
		case "story_archived":
			return "This story is archived. Restore it in `Published`, then try again.";
		case "adult_not_permitted":
			return "Only members who completed adult verification can make adult stories public.";
		case "origin_mismatch":
			return "This story was published by another draft. Publish from that draft.";
		/**
		 * This app has no studio, so the sentence points to the web. The web copy also lists diagnostics;
		 * this one only gives the way.
		 */
		case "runtime_invalid":
			return "Couldn't publish the runtime code. Check the problems in the web studio.";
		/**
		 * Points at the asset list, not code. The server does not say which name is wrong (that answer
		 * would be a media existence probe), so the copy asks to review the whole list.
		 */
		case "runtime_asset_invalid":
			return "Couldn't publish the runtime assets. Upload the images and sounds again from the web studio's asset list.";
		/**
		 * A sanction does not lift by waiting. The reason and appeal live under `Restrictions` in the account
		 * screen; repeating the reason here would split one fact across two places.
		 */
		case "restricted":
			return "A restricted account can't publish stories. Check the restriction on your account screen.";
		case "storage":
		case "unknown":
			return "Couldn't publish. Please try again in a moment.";
	}
}

/** The pre-publish autosave flush failed; nothing was sent to the server. */
export const PUBLISH_FLUSH_FAILED =
	"Unsaved edits remain, so it wasn't published. Please try again.";

/** A draft that cannot be published; validation gives the sentence for which field and why. */
export const PUBLISH_INVALID_HEADING = "Fix these before publishing";
