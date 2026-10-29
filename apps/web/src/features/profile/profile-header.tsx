import {
	type ProfileActions,
	type PublicProfile,
	profileDisplayName,
	profileInitial,
	type Viewer,
} from "@rowcat/domain";
import { buttonVariants } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BlockMenu } from "#/features/social/block-menu.tsx";
import { FollowButton } from "#/features/social/follow-button.tsx";
import { formatNumber } from "#/lib/i18n/format.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";

/**
 * - No social hero banner. A cover image, stat row, and action cluster would take half the
 *   desktop screen and push the works below the fold on mobile.
 * - Identity and actions are grid siblings (avatar, identity, actions). When they shared one
 *   wrapping line, the title's line breaks depended on the button width, so `Follow` changing to `Following`
 *   could toggle the title between one and two lines.
 * - On narrow screens the avatar shares the name's row, and the actions take the full width as a
 *   thumb target. The avatar is not shrunk further, since a list-thumbnail size would stop it from
 *   helping people recognize each other.
 * - Actions are rendered once and placed into different grid cells. Two copies hidden by
 *   responsive classes would both mount, so their mutation and menu state would split and drift
 *   apart.
 * - Only the follower count is shown. The following count is omitted because there is no list to
 *   open from it in this deployment (§8). The works count is omitted because a shown count must
 *   then always answer what is counted. The follower count is read from the public profile and not
 *   recounted here: follow and block responses carry authoritative totals, and @rowcat/query keeps
 *   the cache in step. It is not styled as a link because pressing it would do nothing.
 * - Follow and block carry different weight. Follow is a button beside the name; block sits in
 *   the overflow menu. Side by side they would be the same size, making the destructive action the
 *   most prominent element in the header.
 * - Which actions appear is decided by `resolveProfileActions` in @rowcat/domain. The profile,
 *   viewer, and personalization may not have arrived yet. Spreading the conditions through JSX
 *   would let "unknown" silently collapse into "no", which shows as a label flicker after refresh.
 */
export function ProfileHeader({
	profile,
	viewer,
	actions,
}: {
	profile: PublicProfile;
	/** The current viewer. `null` for guests; the gate for relationship writes checks this value. */
	viewer: Viewer | null;
	/**
	 * Outcome of deciding what to render. There are exactly three branches: owner, guest, or another
	 * member.
	 */
	actions: ProfileActions;
}) {
	const { t } = useTranslation("profile");
	const bio = profile.bio?.trim();
	const name = profileDisplayName(profile);

	return (
		/*
		 * A grid because the two layouts above move the same three elements. The tight vertical gap
		 * (`gap-y-3`) keeps them reading as one block. The spacing that separates identity from the works
		 * lives outside this header, in `profile-page.tsx`.
		 *
		 * Both columns use `minmax(0,1fr)`. With the default `auto`, one long unbroken name sets the
		 * column's minimum width to its content and pushes the grid off screen. `break-words` does not
		 * prevent that, since it only helps when the column can shrink.
		 */
		<header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
			<ProfileAvatar profile={profile} />

			{/*
			 * Identity: the name and the follower count form one block. Spacing them apart would make the count
			 * read as a separate metric.
			 */}
			<div className="flex min-w-0 flex-col gap-1">
				{/*
				 * The display name is the page's main heading. `text-balance` and `break-words` together stop long
				 * unbroken names or emoji runs from causing horizontal scroll, and keep short names from splitting
				 * oddly.
				 *
				 * Not truncated to one line. `truncate` looks like a fix but erases the name the person chose, and
				 * a
				 * profile exists to show that name.
				 */}
				<h1 className="min-w-0 text-2xl font-black tracking-tight text-balance break-words md:text-3xl">
					{name}
				</h1>

				{/*
				 * The follower count is public and is shown even at 0. Zero means no one has followed yet, not that
				 * the feature is missing.
				 *
				 * Not abbreviated (`1.2K`), since that would make 12,400 and 12,449 identical. The repository does
				 * not
				 * abbreviate counts on other screens either.
				 *
				 * `tabular-nums` keeps the width steady when an optimistic ±1 is followed by the server's
				 * correction.
				 *
				 * The number animates (rolls) when it changes, because it is the only thing the follow action
				 * visibly
				 * changes and the eye needs to see it move. The label `Followers` sits outside the rolling box: it never
				 * changes, and inside the box it would shake with every update.
				 */}
				<p className="text-sm text-muted-foreground tabular-nums">
					{t("followers")}{" "}
					<AnimatedCount value={formatNumber(profile.followers)} />
				</p>
			</div>

			<ProfileHeaderActions
				profile={profile}
				viewer={viewer}
				actions={actions}
			/>

			{/*
			 * Renders nothing when there is no bio. A placeholder such as `No bio` is not used: it tells
			 * readers nothing, and it makes the owner's profile look incomplete. A profile without a bio is not
			 * a
			 * defect.
			 */}
			{bio && (
				/*
				 * Line breaks are authored by the user, and collapsing them would lose paragraph structure. The
				 * width is not the full body column, following the typesetting rule for work descriptions: an
				 * overly long line makes it hard to find the start of the next one. `break-words` prevents
				 * horizontal scroll from long unbroken addresses. The grid gives up its width, and only this
				 * paragraph narrows.
				 *
				 * Not truncated. The social-preview description has a length limit (the route's `head`), but
				 * that is a meta-tag constraint; the visible bio is shown in full.
				 *
				 * Not parsed as HTML. The value is plain text rendered as a text node; the absence of
				 * `dangerouslySetInnerHTML` in this file is the whole rule.
				 */
				<p className="col-span-2 max-w-2xl text-[0.9375rem] leading-7 break-words whitespace-pre-wrap text-muted-foreground sm:col-start-2 sm:row-start-2">
					{bio}
				</p>
			)}
		</header>
	);
}

/**
 * The actions cell, the only part of the header that leads outside it. On the owner's profile it
 * holds one link to the account. Otherwise it holds follow and the overflow menu.
 *
 * Keeping this cell separate makes the layout predictable: the left answers who this is, the right
 * answers what can be done. Whatever is shown, the cell keeps its place: the right end when wide,
 * and a row below identity when narrow.
 *
 * Absolute positioning is not used. What sits here changes width with relationship state and label
 * (`Follow` to `Following`), and fixed coordinates would overlap the name.
 */
function ProfileHeaderActions({
	profile,
	viewer,
	actions,
}: {
	profile: PublicProfile;
	viewer: Viewer | null;
	actions: ProfileActions;
}) {
	const { t } = useTranslation("profile");
	return (
		/*
		 * On narrow screens the cell takes its own row below identity (`col-span-2`). From `sm` it moves
		 * to the third column. That column is `auto`, so the container sits at its content width at the
		 * right end, with no `justify-end` or absolute positioning needed.
		 */
		<div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
			{actions.kind === "own" ? (
				/*
				 * The one link shown only on the owner's profile. The profile screen deliberately has no edit
				 * form. Two places to change the nickname would make it unclear which is authoritative, and the
				 * public screen would silently double as a write screen. The profile stays read-only; the
				 * account is the single place to edit.
				 *
				 * Not wrapped in `Button`'s render prop: an `<a>` that takes button semantics would lose
				 * open-in-new-tab and copy-link. Only the variant classes are applied, for the look.
				 */
				<Link
					to="/account"
					className={cn(
						buttonVariants({ variant: "outline", size: "sm" }),
						// On narrow screens this link owns its row and takes the full width, the same rule as the
						// follow button below.
						"h-9 flex-1 sm:h-8 sm:flex-none",
					)}
				>
					{t("edit")}
				</Link>
			) : (
				/*
				 * Guests still see the follow button, since it is the reason to log in. Pressing it sends the
				 * guest to login carrying the current page, then returns them to this profile.
				 *
				 * Block is hidden from guests instead. It is a member-only list with nothing to continue to
				 * after login. No disabled placeholder is drawn either: a control the user cannot press makes a
				 * guest wonder what they did wrong.
				 */
				<>
					{/*
					 * On narrow screens follow takes all remaining width, since it is a thumb target and width means
					 * accuracy. The overflow trigger stays small, so the two differ in weight. Equal widths side by
					 * side
					 * would make block the same kind of action as follow.
					 */}
					<FollowButton
						creatorId={profile.id}
						following={actions.kind === "member" && actions.following}
						viewer={viewer}
						className="min-w-0 flex-1 items-stretch sm:flex-none sm:items-start"
					/>
					{actions.kind === "member" && viewer && (
						<BlockMenu
							creatorId={profile.id}
							creatorName={profileDisplayName(profile)}
							blocked={actions.blocked}
							viewer={viewer}
						/>
					)}
				</>
			)}
		</div>
	);
}

/**
 * The avatar has three branches: the image if one exists, otherwise the initial, otherwise an icon.
 * The branches exist because an `<img>` with an empty source shows a broken-image icon, and an
 * initial-only fallback leaves an empty circle on nameless profiles that reads as loading.
 *
 * All three branches actually run. The image branch was once dead code, since nothing filled
 * `avatarUrl`. The media pipeline added that path without changing this component.
 */
function ProfileAvatar({ profile }: { profile: PublicProfile }) {
	/*
	 * The size drops one step on narrow screens, but not further. Shrinking to 32px to fit on the
	 * name's row would turn the face into a list thumbnail that cannot help people recognize each
	 * other. 64px is the smallest size that still reads as a face on that row.
	 *
	 * `sm:row-span-2` keeps the bio below the name rather than beside the face. A face spanning one
	 * row would leave a 24px gap between the 80px circle and the 56px identity block, which appears
	 * between the name and the bio and splits the identity into two pieces.
	 */
	const shape =
		"flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted sm:size-20 sm:row-span-2";

	if (profile.avatarUrl)
		return (
			<img
				src={profile.avatarUrl}
				referrerPolicy="no-referrer"
				/*
				 * The adjacent `h1` already carries the name, so `alt` is empty. Filling it would make screen
				 * readers announce the same name twice. Decorative is the correct role here.
				 */
				alt=""
				decoding="async"
				className={`${shape} object-cover`}
			/>
		);

	const initial = profileInitial(profile);
	return (
		/*
		 * `aria-hidden` for the same reason. The initial abbreviates the name and adds nothing new to
		 * read, and the icon branch conveys no more than "a person".
		 */
		<div aria-hidden="true" className={shape}>
			{initial ? (
				<span className="text-xl font-black text-muted-foreground select-none sm:text-2xl">
					{initial}
				</span>
			) : (
				<UserRound className="size-7 text-muted-foreground/60" />
			)}
		</div>
	);
}
