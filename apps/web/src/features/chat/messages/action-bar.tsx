import type { ChatMessage } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { cn } from "@rowcat/ui-web/lib/utils";
import {
	Check,
	Copy,
	Flag,
	MoreHorizontal,
	Pencil,
	RefreshCw,
	Scissors,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCopyMessage } from "#/features/conversation/use-copy-message.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { messageActionsFor } from "./actions.ts";
import type { MessageActions } from "./use-actions.tsx";

/**
 * Actions attached to one message row.
 *
 * ## Always takes up space — but does not look like a row
 *
 * On desktop the row is invisible until hover, but it is never removed (only its opacity is 0). The
 * virtualizer measures the real DOM height, so if the height grew on appearance, the row's
 * measurement would change and the virtualizer would correct the scroll by that amount. That is why
 * the conversation moved a few pixels with every mouse movement. It is also why there are no enter
 * or exit animations that change height or size here, and only opacity moves.
 *
 * The visual redesign changed the **weight**, not the seat. The row used to read, when revealed, as
 * a toolbar on every message, so when scanning a conversation the icon rows were counted before the
 * paragraphs. Now it has low contrast and stays faint even when revealed, becoming sharp only when
 * the mouse reaches an individual action. What was pulled back is the appearance, not the geometry:
 * the height is still held by `MESSAGE_ACTION_BAR_HEIGHT_PX`, and that value goes into both the
 * estimate and the placeholder.
 *
 * ## Must be reachable without a mouse
 *
 * `group-hover` alone would leave keyboard users with actions that **do not exist** for them
 * (tabbing into invisible buttons shows nothing). Adding `group-focus-within` is the minimum: once
 * focus enters this row, the row appears.
 *
 * ## Why narrow and wide screens differ
 *
 * Touch has no hover. So on narrow screens the actions are **always visible**, and there are fewer
 * of them: one copy button and a menu holding the rest. Copy stays outside the menu because it is
 * non-destructive and frequently used, and above all because it needs a place to **show the copied
 * indicator**. Pressing it inside the menu would close the menu and take that indicator away with
 * it.
 *
 * The point is not to hand the three hover-only icons of the wide layout to touch unchanged.
 */

/** A one-icon action. Its label is invisible but always present. */
function IconAction({
	label,
	onClick,
	children,
	destructive = false,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
	destructive?: boolean;
}) {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={cn(
				/*
				 * Dimmed by default and sharpened on hover. The button primitive already supplies the
				 * background, so the icon it sits on is also read.
				 */
				"text-muted-foreground/70",
				destructive ? "hover:text-destructive" : "hover:text-foreground",
			)}
		>
			{children}
		</Button>
	);
}

export function MessageActionBar({
	message,
	actions,
	align,
}: {
	message: ChatMessage;
	actions: MessageActions;
	/** On the same side as the bubble: user on the right, assistant on the left. */
	align: "start" | "end";
}) {
	const { t } = useTranslation(["chat", "common"]);
	/**
	 * The copy state machine is **shared with the playtest** (`features/conversation/`). What remains
	 * here is only placement: this row holds it as one of five icons that appear on hover.
	 */
	const copyState = useCopyMessage(message.content);

	const available = messageActionsFor(message.role);
	const canEdit = available.includes("edit");
	const canRegenerate = available.includes("regenerate");
	const canReport = available.includes("report");

	/**
	 * The copied indicator is **a picture of the state**, not the state itself. Both the transition
	 * into it and the return out of it are owned by `useCopyMessage`'s timer (`COPY_FEEDBACK_MS`);
	 * here that value is only mapped to one glyph. There is no second timer and no "revert when the
	 * animation ends".
	 *
	 * `failed` shares a slot with `idle` on purpose. A failure is announced by the name and the live
	 * region (`copyState.label`, `announcement`), not by the icon. A separate branch here would let
	 * someone whose copy failed read the **change of icon** as success.
	 */
	const copied = copyState.state === "copied";
	const copyIcon = (
		/*
		 * Only the return is quiet. "Copied" is the answer to the press just made, but its disappearance
		 * is driven by the timer, so arriving at the same weight would read as success happening twice
		 * (`iconSwapQuietIn` in `icon-swap.ts`).
		 */
		<AnimatedIconSwap stateKey={copied ? "copied" : "idle"} quiet={!copied}>
			{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
		</AnimatedIconSwap>
	);

	return (
		/*
		 * The height is fixed (`h-8`). Even when the content changes (copied indicator, menu open), the
		 * row height must stay the same so the virtualizer's measurement does not waver. These 32px are
		 * `MESSAGE_ACTION_BAR_HEIGHT_PX`, and adding the message row's vertical gap gives
		 * `MESSAGE_ACTIONS_RESERVE_PX`. The two names differ because they are used in different places:
		 * inside a parent that already has the gap, the former; otherwise the latter. Changing the height
		 * here means moving that constant in the same commit.
		 *
		 * It is also exactly the value of the narrow-screen overflow trigger (`size-8`). For a finger
		 * user this row is the only control that is always visible, and if the trigger spilled out of it,
		 * it would take space from the neighbouring message.
		 */
		<div
			className={cn(
				/*
				 * `relative` keeps the live region below inside this row. Without it, the absolute position of
				 * `sr-only` is computed against the **outer** container.
				 */
				"relative flex h-8 items-center gap-0.5",
				align === "end" ? "justify-end" : "justify-start",
			)}
		>
			{/*
			 * The copy result must reach people who do not see the screen. The change of icon is a signal only the eyes read.
			 *
			 * **Without `left-0`, the conversation log gets a horizontal scrollbar.** `sr-only` is a 1px box with
			 * `position:absolute` and `margin:-1px`. Without a position it takes its static position from this flex row's
			 * alignment. The person's own messages are `justify-end`, so it sits at the right edge, and the `-1px` margin pokes
			 * 1px out of the row. That 1px exceeds the scroll container's `scrollWidth` (the container is `overflow-y-auto`, so
			 * its x axis computes to `auto`) and produces a horizontal scrollbar. Overflow to the left is not scrollable in LTR,
			 * so this position is safe.
			 */}
			<output className="sr-only left-0">{copyState.announcement}</output>

			{/* Copy sits outside the menu at both sizes: the indicator needs room to show. */}
			<div
				className={cn(
					"flex items-center gap-0.5",
					/*
					 * The hiding condition looks at **pointer as well as width.**
					 *
					 * With width alone, touch devices wider than 640px (tablets) would never show this row. Those
					 * devices have no hover, and the narrow-screen menu trigger is also gated by width and
					 * disappears with it. That is the only combination where the whole set of actions becomes
					 * unreachable, so the media query is written directly here and nowhere else.
					 *
					 * Only opacity moves. If height or size changed, the virtualizer would re-measure the row, and
					 * the conversation would shake a few pixels with each mouse movement.
					 */
					"sm:[@media(hover:hover)]:opacity-0 sm:[@media(hover:hover)]:transition-opacity",
					/*
					 * Revealed, but **never fully.** If this row went fully opaque, every message the mouse passed
					 * over would light up its toolbar, and the conversation would become noisy rather than the
					 * actions clearer. Individual icons sharpen when the mouse is over them (`IconAction`). Focus
					 * is the exception: showing dimmed actions to someone who arrived there by keyboard is not
					 * accessibility, only an imitation of it.
					 */
					"sm:[@media(hover:hover)]:group-hover/message:opacity-80",
					/* Must be reachable without a mouse: it appears when focus enters. */
					"sm:[@media(hover:hover)]:group-focus-within/message:opacity-100",
					// Stays visible while the copied indicator is up, so the result just pressed is not hidden.
					copyState.state !== "idle" && "sm:[@media(hover:hover)]:opacity-100",
				)}
			>
				<IconAction label={copyState.label} onClick={copyState.copy}>
					{copyIcon}
				</IconAction>

				{/* Wide screens: the remaining actions are also spread out as icons. */}
				<span className="hidden sm:contents">
					{canEdit && (
						<IconAction
							label={t("actionBar.editMessage")}
							onClick={() => actions.requestEdit(message)}
						>
							<Pencil aria-hidden="true" />
						</IconAction>
					)}
					{canRegenerate && (
						<IconAction
							label={t("actionBar.regenerateFromThisReply")}
							onClick={() => actions.requestRegenerate(message)}
						>
							<RefreshCw aria-hidden="true" />
						</IconAction>
					)}
					{/*
					 * Report comes **before** the destructive item. Of the actions on this row, the only irreversible one is
					 * delete, and when it sits at the very end the places where a hand can slip are gathered into one. Its colour
					 * is also left plain for the same reason: report is a button that asks for review, not one that punishes.
					 */}
					{canReport && (
						<IconAction
							label={t("actionBar.reportThisReply")}
							onClick={() => actions.requestReport(message)}
						>
							<Flag aria-hidden="true" />
						</IconAction>
					)}
					<IconAction
						label={t("actionBar.deleteFromHere")}
						destructive
						onClick={() => actions.requestDeleteFrom(message)}
					>
						<Scissors aria-hidden="true" />
					</IconAction>
				</span>
			</div>

			{/* Narrow screens: the rest are folded into one menu. */}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							/*
							 * Does not say which message the menu belongs to. Every row in the conversation has one, and
							 * putting the message body in the name would have a screen reader read the same text twice.
							 * The role is named instead.
							 */
							aria-label={
								message.role === "user"
									? t("actionBar.myMessageMenu")
									: t("actionBar.replyMenu")
							}
							className="text-muted-foreground/80 sm:hidden"
						/>
					}
				>
					<MoreHorizontal aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align={align === "end" ? "end" : "start"}>
					{canEdit && (
						<DropdownMenuItem onClick={() => actions.requestEdit(message)}>
							<Pencil aria-hidden="true" />
							{t("actionBar.editMessage")}
						</DropdownMenuItem>
					)}
					{canRegenerate && (
						<DropdownMenuItem
							onClick={() => actions.requestRegenerate(message)}
						>
							<RefreshCw aria-hidden="true" />
							{t("actionBar.regenerate")}
						</DropdownMenuItem>
					)}
					{canReport && (
						<DropdownMenuItem onClick={() => actions.requestReport(message)}>
							<Flag aria-hidden="true" />
							{t("actionBar.report")}
						</DropdownMenuItem>
					)}
					{/*
					 * The one irreversible item stands **after** a separator. This is the same rule as the item at the very end of
					 * the wide icon row; the room-management menu (`ROOM_ACTIONS`) and the same menu on mobile are arranged this way
					 * too. On narrow screens the gap between items is one finger wide, so position alone does not separate the place
					 * where a hand might slip.
					 */}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() => actions.requestDeleteFrom(message)}
					>
						<Scissors aria-hidden="true" />
						{t("actionBar.deleteFromHere")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
