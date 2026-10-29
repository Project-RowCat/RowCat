import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A thin surface set shared by the workspace cards: the management menu shell, the expand trigger,
 * and the expanded body. Only accessibility wiring and dimensions live here. What goes inside each
 * card (published work, lore, start scene) is decided by that card.
 *
 * A shared `<CollapsibleEntityCard type=...>` is deliberately not created. It would absorb summary,
 * fields, menu items, and save rules all at once, so fixing one card would mean knowing about the
 * others.
 *
 * Writing these surfaces by hand in each card is risky in quiet ways. `aria-expanded` gets dropped
 * on one side, trigger targets shrink below finger size on narrow screens, or the trigger and the
 * menu end up as a button inside a button rather than siblings. Nested interactive elements are
 * invalid markup, so browsers rewrite the tree and the press target diverges. None of this fails
 * compilation or tests.
 */

/**
 * The management menu shell for one card. Items are passed in by the caller.
 *
 * The trigger is icon-only, so a name is required. A generic `Menu` label would give every card's
 * trigger the same name for screen reader users (the conversation list makes the same call).
 *
 * Not hidden behind hover. What goes in here, such as cover replacement or archiving, costs
 * something to undo, and touch devices have no hover. A hover-hidden action would not exist on
 * touch devices.
 */
export function CardActionsMenu({
	label,
	children,
}: {
	/** What this menu manages. Must be unique within the list. */
	label: string;
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						// One size larger on narrow screens: in a list, this is where a thumb has to land accurately.
						className="size-9 shrink-0 sm:size-8"
					/>
				}
			>
				<MoreHorizontal aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-40">
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The button that expands and collapses a card. The trigger is this one element, not the whole
 * card.
 *
 * If the whole card were tappable, the inputs and menu inside it would sit inside the trigger, and
 * which element gets a press would differ between browsers. So the trigger and the management menu
 * are siblings.
 *
 * The collapsed summary is the button's content. Keeping the summary outside and making only the
 * arrow a button would shrink the target below finger size, and screen readers would read a
 * nameless button.
 *
 * The arrow rotates in CSS only. Motion is avoided because these cards live inside a presence
 * container (`AnimatePresence initial={false}`), which suppresses descendants' `initial`. Cards
 * that were there when the list opened would silently skip the animation. An animation that runs on
 * some cards and not others is worse than none.
 */
export function CardDisclosureButton({
	expanded,
	panelId,
	onToggle,
	children,
}: {
	expanded: boolean;
	/**
	 * The id of the expanded body. When collapsed the element does not exist, so no reference is set.
	 */
	panelId: string;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-expanded={expanded}
			aria-controls={expanded ? panelId : undefined}
			onClick={onToggle}
			className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<ChevronRight
				aria-hidden="true"
				className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
					expanded ? "rotate-90" : ""
				}`}
			/>
			<span className="min-w-0 flex-1">{children}</span>
		</button>
	);
}

/**
 * The expanded body. Its height is not animated. Textareas inside grow with their content
 * (`field-sizing-content`), so interpolating height would re-run that calculation on every
 * keystroke. That would place the cheapest decoration on the most expensive spot in the editor. The
 * structural change is already conveyed by the arrow and by the content itself.
 */
export function CardDisclosurePanel({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	return (
		<div id={id} className="mt-3 flex flex-col gap-4">
			{children}
		</div>
	);
}
