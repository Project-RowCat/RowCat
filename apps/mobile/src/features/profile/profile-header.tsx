import { space } from "@rowcat/design";
import {
	type ProfileActions,
	type PublicProfile,
	profileDisplayName,
} from "@rowcat/domain";
import { Avatar, Badge, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { formatCount } from "../../lib/format.ts";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import type { ViewerAction } from "../../lib/viewer-action.ts";
import { FollowControl } from "./follow-control.tsx";
import { useProfileMenu } from "./use-profile-menu.tsx";

/** Face diameter: larger than the list thumbnail (32), but not so large that it fills the first screen. */
const AVATAR_SIZE = 64;

/**
 * Profile header: face, name, followers, and relations.
 *
 * **No social hero banner.** A cover image, a stats row and a cluster of buttons push the work
 * below the first screen on short devices. People come to this screen to find works, so the header
 * says only whose profile this is. The web's `profile-header.tsx` made the same call. These also
 * stay out: a follower list, following count, work count, activity feed, badges and DMs.
 *
 * **Reporting exists, inside the overflow menu.** It is not a flag in the header, because its
 * weight would look like follow's. A second `⋯` is not added either: two overflow menus for one
 * person means nobody remembers what is where (`use-profile-menu.tsx`).
 *
 * ```text
 * [face]  name (may wrap to several lines)
 *         followers 1,234
 *
 * [follow                                    ] [⋯]
 * bio…
 * ```
 *
 * ## Actions do not decide the name's layout
 *
 * The web once wrapped the name and the buttons **on one line**, and the flaw showed only with long
 * names: the title's break point depended on the button width, so changing `Follow` to `Following` alone
 * made the name wrap to two lines and back. Here the actions sit on a **lower line**, so that
 * coupling cannot exist. This is the same layout the narrow web chose, and this app has no
 * wide-screen branch.
 *
 * ## The name is not truncated
 *
 * No `numberOfLines`. Cutting the name to one line looks like it solves long names, but it erases
 * the name the person chose, and a public profile exists to show that name.
 *
 * ## The follower count is text
 *
 * There is nothing to press, so it is not styled as a button. A number that looks pressable but
 * does nothing promises a follower list that does not exist. It is **not abbreviated** either:
 * `1.2K` makes 1,200 and 1,249 the same glyphs. `formatCount` holds that rule.
 *
 * This component deliberately does not count the figure. It is an aggregate carried on the public
 * profile. The writes that change it (follow, block) return the exact total, and keeping the cache
 * in step is `@rowcat/query`'s job. There is no arithmetic like `profile.followers + 1` in this
 * folder.
 */
export function ProfileHeader({
	profile,
	actions,
	action,
	returnPath,
}: {
	profile: PublicProfile;
	/** Decides what is drawn. `@rowcat/domain` owns it, and the web calls the **same function**. */
	actions: ProfileActions;
	/** Whether an authenticated write is possible now. The **same decision** as hearts and comments. */
	action: ViewerAction;
	/** Where login returns: this profile, as it is now. */
	returnPath: string;
}) {
	const name = profileDisplayName(profile);
	const bio = profile.bio?.trim();

	/**
	 * The management menu is drawn **only on other members' profiles**, and there is **only one**
	 * (report and block). It is hidden from guests because both actions tie to a member: the block
	 * list has no way to continue "what was being blocked" after login, and reporting is a multi-step
	 * form whose entries would vanish on a detour through login. Follow alone is exempt because it is
	 * one tap.
	 *
	 * The hook is always called, since conditional hook calls break the rules of hooks. When nothing
	 * is drawn, the exported nodes simply go unused; the cost is one closed menu and two closed
	 * dialogs.
	 */
	const menu = useProfileMenu({
		creatorId: profile.id,
		creatorName: name,
		blocked: actions.kind === "member" && actions.blocked,
		action,
	});
	const showsMenu = actions.kind === "member";

	return (
		<View style={head.root}>
			<View style={head.identity}>
				{/**
				 * The face rules (photo, falling back to initials) belong to `@rowcat/ui-native`.
				 * Reimplementing them here would keep a second copy of the failure handling that the
				 * comment row also has.
				 *
				 * The name is passed **as-is**. Passing the placeholder that `profileDisplayName` produces
				 * (`Unnamed creator`) would make the initial of a nameless profile the placeholder's first
				 * letter, drawing a name that does not exist.
				 */}
				<Avatar
					name={profile.displayName}
					uri={profile.avatarUrl}
					size={AVATAR_SIZE}
				/>
				<View style={head.names}>
					{/** The screen's main title is the person's name, the same hierarchy as the web detail. */}
					<Text accessibilityRole="header" variant="display">
						{name}
					</Text>
					{/**
					 * Zero is drawn as-is. Following is a real feature, so this zero means "no one has
					 * followed yet", not an unimplemented placeholder.
					 */}
					{/**
					 * The number **rolls in place**. The word is an unchanging fact and plain text.
					 * Pressing follow moves this value optimistically (the rule lives in `@rowcat/query`),
					 * and then the server's absolute value corrects it. Both changes arrive the same way, so
					 * the number rolls back in the other direction without a separately written reverse
					 * animation. The web's same line uses the same value.
					 */}
					<View style={head.followers}>
						<Text variant="label" tone="muted-foreground">
							Followers{" "}
						</Text>
						<AnimatedCount
							value={formatCount(profile.followers)}
							variant="label"
							tone="muted-foreground"
						/>
					</View>
				</View>
			</View>

			<View style={head.actions}>
				{actions.kind === "own" ? (
					/**
					 * A person's own profile has no relation actions, and **there is no path to editing yet.** The
					 * web puts a `/account` link here, but this app has no such screen, and a button that does
					 * nothing promises something that cannot be kept. That link arrives with the commit that adds
					 * the account screen.
					 *
					 * A fact is shown instead. If nothing sat here, the empty slot would read as loading. This is
					 * the same axis as the `My story` badge on the work detail.
					 */
					<Badge label="My profile" />
				) : (
					<View style={head.relations}>
						{/**
						 * Guests still **see** the follow button. It is the reason to log in: pressing it
						 * carries the current location through login and returns to this profile. It is not
						 * held as a disabled button, since a visible but unpressable control makes a guest
						 * ask what they did wrong.
						 */}
						<FollowControl
							creatorId={profile.id}
							creatorName={name}
							following={actions.kind === "member" && actions.following}
							action={action}
							returnPath={returnPath}
						/>
						{showsMenu ? menu.trigger : null}
					</View>
				)}
				{showsMenu ? menu.notice : null}
			</View>

			{/**
			 * With no bio, **nothing is drawn.**
			 *
			 * `No bio yet` is left out. The sentence is useless to everyone: to the reader it
			 * carries the same information as an empty line, and to the owner it makes the profile look
			 * lacking. A profile without a bio is not a defect.
			 *
			 * Line breaks are the author's, so they are not folded (RN's `Text` draws the source as-is).
			 * Nor is the text truncated: the value is plain text and becomes a text node unchanged.
			 */}
			{bio ? (
				<Text variant="body" leading="reading">
					{bio}
				</Text>
			) : null}

			{showsMenu ? menu.dialog : null}
		</View>
	);
}

const head = StyleSheet.create({
	root: { gap: space.md },
	/** Face and identity are one unit. A gap would make the name read as a line unrelated to the face. */
	identity: { alignItems: "center", flexDirection: "row", gap: space.md },
	/** The word and the rolling count share one line, because they are different kinds of value. */
	followers: { alignItems: "center", flexDirection: "row" },
	/**
	 * Without `minWidth: 0`, one long unbroken name pushes this column off screen. A flex child's
	 * minimum size defaults to its **content** (the `AppBar` title has the same value).
	 */
	names: { flex: 1, gap: 2, minWidth: 0 },
	actions: { gap: space.xs },
	/**
	 * Follow takes all remaining width on the row (it is a thumb target, so width is accuracy), and
	 * the overflow trigger gets only its own target. Placing them side by side at equal width would
	 * make block the same size of action as follow.
	 *
	 * `alignItems: "flex-start"` because the follow control can grow downward to hold a failure
	 * message. If the trigger moved to the middle as that happens, its icon would drift out of line
	 * with the button.
	 */
	relations: {
		alignItems: "flex-start",
		flexDirection: "row",
		gap: space.sm,
	},
});
