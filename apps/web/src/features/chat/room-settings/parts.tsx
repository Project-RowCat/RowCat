import { ChevronRight, TriangleAlert } from "lucide-react";
import type { ReactNode, Ref } from "react";

/**
 * Two layout parts for the settings home: **one row, and a group of rows**.
 *
 * This file exists because the home is a list. If each row carried its own markup, the touch
 * height, focus indication and truncation rules would drift row by row, and the mismatch would show
 * only on narrow screens.
 *
 * **Not a general settings framework.** It holds the two parts conversation settings use. They are
 * not lifted into `@rowcat/ui-web`: that package is the home of feature-agnostic primitives, and
 * parking a layout with a single consumer there would freeze this screen's decisions into shared
 * vocabulary.
 */

/**
 * One group of rows: a title and the rows beneath it.
 *
 * **No bordered box.** Groups once had `rounded-lg border`, justified as "group boundaries must be
 * visible". That box stacked a surface on top of a dialog, which is already a floating surface.
 * With three boxes inside one window it became unclear what was the list and what was the
 * container, and the rows' left edges were pushed inward from the group title, leaving two vertical
 * lines to follow while scanning. Now **one line** divides groups: it keeps what the box did (this
 * is one set) while drawing only 1px.
 *
 * Groups are not removed either. Separating by whitespace alone would make the reader count where
 * `Conversations` ends, and this list's three groups differ in kind (how to make it, what this conversation
 * is, what to do with the conversation).
 *
 * The left edge is **one**. Only the rows step outward (`-mx-2` plus the rows' `px-2`), so the
 * title and the row text start on the same vertical line. The outward step is the width of the
 * pressed background, not an indent.
 */
export function RoomSettingsGroup({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="mt-3 border-t pt-4 first:mt-0 first:border-t-0 first:pt-0">
			<h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
			<div className="-mx-2 mt-1 flex flex-col">{children}</div>
		</section>
	);
}

/**
 * One row of the settings home. **It is always a button.**
 *
 * It is not built as `div` + `onClick`. Such an element cannot take focus, does not respond to
 * Enter or Space, and screen readers read neither its name nor its role. All three fail silently,
 * and a review that only presses the row with a mouse will not catch them.
 *
 * **The summary is part of the button's content.** If only the title were the button and the
 * summary sat outside, the target would shrink below a finger's size, while people aim at the whole
 * row (the expand button in `features/create/publishing/card-parts.tsx` made the same call).
 *
 * **Nothing is revealed only on hover.** The arrow and the summary are always visible: fingers have
 * no hover, and a hidden control is no control. Hover changes only **intensity** (the row's
 * background, the arrow's contrast); nothing that was absent appears.
 *
 * ## Three levels of hierarchy
 *
 * ```text
 * title     what this row is                 foreground · medium
 * summary   what currently applies           muted      · same size (colour and weight make the layer)
 * arrow     there is somewhere to go         muted/60   · does not compete with the text
 * ```
 */
export function RoomSettingsRow({
	title,
	summary,
	warning,
	navigational,
	destructive,
	ref,
	onClick,
}: {
	title: string;
	/** The one-line summary of the current value. If not known yet, do not pass it (the slot stays empty). */
	summary?: string | null;
	/**
	 * A one-line fact that the user must go in to resolve. The reason is stated inside.
	 *
	 * It is **a separate line** from the summary, on purpose. Joined into one sentence, "what applies"
	 * and "whether it can be used" would read as a single fact, but each is independently true or
	 * false.
	 *
	 * Only this line carries an icon. It is a spot where colour must not be the only signal (in the
	 * same window, `Delete conversation` uses the same colour, so colour alone does not tell the two apart). The
	 * meaning is still carried by the sentence; the icon is `aria-hidden`.
	 */
	warning?: string | null;
	/** Pressing it goes to another screen; the arrow says so. */
	navigational?: boolean;
	/**
	 * A row that leads to an irreversible operation.
	 *
	 * Colour alone is unreadable to some users, so the guard at that boundary is still the
	 * confirmation dialog (`delete-room-dialog.tsx`). The only thing colour does here is distinguish
	 * this row from ordinary navigation rows. For the same reason it gets no arrow, and no large
	 * warning box is raised: if every row warns, none does.
	 */
	destructive?: boolean;
	ref?: Ref<HTMLButtonElement>;
	onClick: () => void;
}) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			/*
			 * `min-h-11` (44px) is the minimum finger target. A one-line row (`Rename`) would otherwise
			 * shrink below it with text height and padding alone.
			 *
			 * The focus ring draws outward now (it used to be `ring-inset`). Once the bordered box was
			 * removed there was no edge left for the ring to be clipped by, and an inset ring overlapped the
			 * pressed background and lost half its thickness. The dialog's side padding already provides
			 * those 2px.
			 */
			className={`group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
				destructive
					? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
					: "hover:bg-muted focus-visible:bg-muted"
			}`}
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{title}</span>
				{summary && (
					<span className="mt-0.5 block truncate text-sm text-muted-foreground">
						{summary}
					</span>
				)}
				{warning && (
					<span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-destructive">
						<TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
						<span className="min-w-0 truncate">{warning}</span>
					</span>
				)}
			</span>
			{navigational && (
				<ChevronRight
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground group-focus-visible:text-muted-foreground"
				/>
			)}
		</button>
	);
}
