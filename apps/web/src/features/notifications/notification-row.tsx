import { isUnread, type Notification } from "@rowcat/domain";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
	Bell,
	BookOpen,
	Flag,
	Gavel,
	MessageSquare,
	ShieldCheck,
	UserPlus,
} from "lucide-react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { relativeTime } from "#/lib/format/relative-time.ts";
import { translator } from "#/lib/i18n/current.ts";
import { standardTransition } from "#/lib/motion/transitions.ts";
import {
	notificationActorInitial,
	notificationDetail,
	notificationMessage,
} from "./notification-copy.ts";
import {
	type NotificationDestination,
	notificationDestination,
} from "./notification-destination.ts";

/**
 * One notification row. The whole row is a single action: each notification is one event, and
 * pressing it goes to where the event happened.
 * - The link covers the entire row, and no second button is placed inside it. A `<button>` inside
 *   an `<a>` is invalid markup. The browser repairs the tree, causing a hydration mismatch, and
 *   keyboard behavior differs. The conversation list keeps its trigger as a sibling of its link for
 *   the same reason.
 * - A row with no destination renders as a button, not a link. A departed actor or removed story
 *   has nowhere to go, so instead of a 404 the row becomes a button that only marks it as read.
 *   Screen readers announce it as a button, which matches its behavior.
 * - Unread status is not conveyed by color alone. The dot is `aria-hidden`, and the accessible
 *   name includes the word `Unread`.
 * - The dot occupies a fixed column on the left, not the right edge. On the right, its x position
 *   would shift with each row's text length, so the eye could not scan for new items down the list.
 *   In a left column, the dots of twenty rows line up.
 * - Unread is not shown with bold weight. Bolding changes the sentence width when a row is marked
 *   as read, which re-wraps the text. The aligned dot and a faint background do the job without
 *   changing width.
 * - `surface` changes presentation only. Destination, copy, unread check, and activation are
 *   identical on both surfaces; only corners and borders differ. The axis is not exposed as a
 *   boolean or density option. With two known surfaces, an open-ended combination would eventually
 *   produce a third shape on screen.
 */
export type NotificationSurface = "page" | "popover";

export function NotificationRow({
	notification,
	surface,
	onActivate,
}: {
	notification: Notification;
	surface: NotificationSurface;
	/**
	 * Called when the row is pressed. Marking the notification as read is the caller's job, not the
	 * row's. The row is rendered on two surfaces: the popover must close after activation, while the
	 * full list must stay open. The row has no reason to know that difference.
	 */
	onActivate: () => void;
}) {
	const unread = isUnread(notification);
	const destination = notificationDestination(notification);
	const iso = notification.createdAt;
	const detail = notificationDetail(notification);

	const body = (
		<>
			{/*
			 * The dot is decoration. The state is spoken by the `aria-label` below.
			 *
			 * The dot keeps its place when the notification is read. Previously it was conditionally
			 * rendered, so on read it left the layout, the text column widened, and the row jumped once.
			 * Now only the opacity changes, on the same rhythm as the background color transition
			 * (`transition-colors`). One thing changing instantly and the other gradually would read as two
			 * separate events.
			 *
			 * It is aligned vertically to the first line's text center (`mt-2`). Centering it on the 32px
			 * icon would push the dot down on two-line rows and misalign the column.
			 */}
			<m.span
				aria-hidden="true"
				animate={{ opacity: unread ? 1 : 0 }}
				transition={standardTransition}
				className="mt-2 size-2 shrink-0 rounded-full bg-primary"
			/>

			<NotificationIcon notification={notification} />

			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				{/*
				 * The sentence comes first. The badge, timestamp, and dot are each stepped down one level so
				 * none of them outranks the sentence.
				 */}
				<span className="text-sm leading-snug break-words">
					{notificationMessage(notification)}
				</span>
				{detail && (
					<span className="text-xs leading-5 break-words text-muted-foreground">
						{detail}
					</span>
				)}
				{/*
				 * The relative time is shown, and the machine-readable value stays in `dateTime`. The `title`
				 * attribute holds the absolute time, since "3 days ago" alone does not say when.
				 *
				 * The timestamp is one step quieter than the second line (the public reason or the
				 * effective-version line). Both were `text-muted-foreground`, so the two lines read as the same
				 * layer, yet they differ. The second line states a fact about this event, while the timestamp is
				 * a coordinate every row carries. Desktop does not place it in a right-hand column for the same
				 * reason: as a column it would compete with the sentence for space.
				 */}
				<time
					dateTime={iso}
					title={formatDateTime(iso)}
					className="text-xs text-muted-foreground/60"
				>
					{relativeTime(iso)}
				</time>
			</span>
		</>
	);

	/**
	 * The accessible name is the sentence plus the state.
	 *
	 * The sentence is already visible, so repeating it is redundant. But the unread state exists only
	 * as a visual signal (dot and background). Without including it in the label, screen reader users
	 * would not receive it at all.
	 */
	const label = unread
		? translator("notifications")("unread", {
				message: notificationMessage(notification),
			})
		: notificationMessage(notification);

	const className = rowClassName(surface, unread);

	if (!destination)
		return (
			<li>
				<button
					type="button"
					aria-label={label}
					className={className}
					onClick={onActivate}
				>
					{body}
				</button>
			</li>
		);

	return (
		<li>
			<NotificationLink
				destination={destination}
				aria-label={label}
				className={className}
				/**
				 * This does not wait for the mark-as-read request. Read marking optimistically updates the
				 * cache first and the request is sent in the background, so the click leads straight into
				 * router navigation. If the request fails, the destination has still opened, and the row simply
				 * shows as unread again later.
				 */
				onClick={onActivate}
			>
				{body}
			</NotificationLink>
		</li>
	);
}

/**
 * Styling for a row. This one function holds the entire difference between the two surfaces.
 *
 * Geometry (spacing, padding) is the same on both. Only two things differ, and both come from the
 * nature of the container:
 * - `popover`: each row is its own rounded piece, showing within a small box which item is
 *   pressed.
 * - `page`: rows have no borders. The list already divides rows with `divide-y`, so it is one
 *   continuous surface.
 *
 * The full list's focus ring is drawn inset (`ring-inset`) as a result. Without rounded corners, a
 * ring drawn outward would be clipped by the neighboring rows and borders, leaving only three
 * sides.
 *
 * Vertical padding is one step larger on the page variant than in the popover. In the narrow
 * popover, six rows should fit at a glance. In the full list a finger must pick out one row
 * exactly, so the touch target is not shrunk for density.
 */
function rowClassName(surface: NotificationSurface, unread: boolean): string {
	const base =
		"flex w-full gap-3 px-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50";
	/**
	 * The unread background is very faint. A strong tint would make the row look like the current
	 * selection rather than something new, and an inbox with ten selected rows makes no sense.
	 *
	 * Hover (`accent/60`) is always stronger than this tint, so the row under the pointer never gets
	 * hidden by the new-item marker.
	 */
	const tint = unread ? "bg-accent/30" : "";
	return surface === "page"
		? `${base} py-3.5 focus-visible:ring-inset ${tint}`
		: `${base} rounded-md py-3 ${tint}`;
}

/**
 * A placeholder that holds the geometry of the row about to arrive.
 *
 * It lives next to the row. If it were in another file, a change to the row's column layout would
 * leave the placeholder in its old shape, and the mismatch would only show when the value arrives
 * and the whole list is re-laid out. Earlier, the two surfaces each kept their own placeholder, and
 * the dot column was in fact missing from one of them.
 *
 * `Skeleton` already animates, so no motion is added here.
 */
export function NotificationRowSkeleton({
	surface,
}: {
	surface: NotificationSurface;
}) {
	return (
		<li className={`flex gap-3 px-3 ${surface === "page" ? "py-3.5" : "py-3"}`}>
			<span className="mt-2 size-2 shrink-0" />
			<Skeleton className="size-8 shrink-0 rounded-full" />
			{/*
			 * The text column's gaps and bar heights match the real row. The sentence is `text-sm leading-snug`
			 * (20px) and the timestamp is `text-xs` (16px), totaling 38px. That is taller than the 32px icon,
			 * so the text column is what sets the row height.
			 *
			 * With `gap-2` and `h-4`/`h-3` bars, the column was 36px, and every notification arrival grew the
			 * whole list by 2px per row.
			 */}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<Skeleton className="h-5 w-2/3" />
				<Skeleton className="h-4 w-16" />
			</div>
		</li>
	);
}

/**
 * Maps a destination kind to a typed link.
 *
 * The address is not built as a string for this reason. The router checks `to` as a literal, so a
 * route rename fails compilation here. If the address were assembled, the same rename would break
 * only at runtime.
 */
function NotificationLink({
	destination,
	children,
	...props
}: {
	destination: NotificationDestination;
	children: ReactNode;
	"aria-label": string;
	className: string;
	onClick: () => void;
}) {
	switch (destination.kind) {
		case "creator":
			return (
				<Link
					to="/creators/$creatorId"
					params={{ creatorId: destination.creatorId }}
					{...props}
				>
					{children}
				</Link>
			);
		case "story":
			return (
				<Link
					to="/stories/$storyId"
					params={{ storyId: destination.storyId }}
					{...props}
				>
					{children}
				</Link>
			);
		case "account":
			return (
				<Link to="/account" {...props}>
					{children}
				</Link>
			);
	}
}

/**
 * The leading mark is an icon, not an avatar.
 *
 * An avatar image path does exist now, but that does not change this. Moderation notifications have
 * no actor, so there would be nothing to draw. The row's geometry would then differ by kind, and
 * since the inbox mixes kinds on one screen, that shift would itself add to the cost of reading.
 *
 * For social notifications, the actor's initial goes in the icon slot, so who it is can be seen at
 * a glance. Everything is `aria-hidden`: the adjacent sentence says what happened.
 */
function NotificationIcon({ notification }: { notification: Notification }) {
	const shell =
		"flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground";

	/**
	 * The three kinds that have an actor draw the actor's initial, and new story publication is one of
	 * them. For those, the user first wants to know who, not what kind of event it is. The inbox mixes
	 * kinds, so the initial's column must align for the list to be scannable.
	 *
	 * The kind-specific icon is used only as a fallback, when no name can be derived (the actor has
	 * left, or the nickname begins with a symbol).
	 */
	if (
		notification.kind === "follow" ||
		notification.kind === "story_comment" ||
		notification.kind === "creator_story_published"
	) {
		/**
		 * The initial comes from the copy layer (`notificationActorInitial`).
		 *
		 * It was previously sliced inline with `name.slice(0, 1)`. For nicknames starting with an emoji,
		 * that drew half of a surrogate pair inside the circle. It compiled and the tests passed, so the
		 * rule belongs where it can be verified without rendering.
		 */
		const initial = notificationActorInitial(notification.actor);
		/**
		 * The fallback picture reflects the event. A new story publication points at one story, so it
		 * uses the book icon (`BookOpen`). This repo already uses that glyph for going to story detail
		 * (`runtime-chat-header-context.tsx`), and `story-detail` in `@rowcat/ui-native` uses the same
		 * glyph.
		 *
		 * Reusing the follow icon (`UserPlus`) would make two different events look identical, even
		 * though pressing them leads to different places.
		 */
		const Fallback =
			notification.kind === "follow"
				? UserPlus
				: notification.kind === "story_comment"
					? MessageSquare
					: BookOpen;
		return (
			<span aria-hidden="true" className={`${shell} text-sm font-medium`}>
				{initial || <Fallback className="size-4" />}
			</span>
		);
	}

	/**
	 * A moderation action gets a different icon. The distinct mark signals that the kind differs
	 * without introducing a second notification system.
	 *
	 * It does not change the color, highlight the row, or open a modal. If the action must be blocked,
	 * the entry gate already stands in front. A notification's job is only to tell the user.
	 */
	const Icon =
		notification.kind === "moderation_action"
			? Gavel
			: notification.kind === "moderation_reversed"
				? ShieldCheck
				: /**
					 * A report-review result gets a flag, not the gavel used for enforcement. The distinction is the
					 * point. If both kinds used the same mark, "my report was resolved" and "my account was
					 * sanctioned" would look alike in the list, yet they call for opposite actions from the user.
					 */
					notification.kind === "report_reviewed"
					? Flag
					: Bell;
	return (
		<span aria-hidden="true" className={shell}>
			<Icon className="size-4" />
		</span>
	);
}
