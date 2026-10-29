import type { ReactNode } from "react";
import { ConversationViewport } from "#/features/conversation/conversation-viewport.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Skeleton of the conversation screen: one cell confined to the screen height.
 *
 * Its geometry differs from document-flow screens. Discovery, detail and the editor scroll the
 * window, but a conversation has a history that scrolls inside and an input pinned to the bottom.
 * The shell decides that difference (`viewportLocked` in `components/app-shell/shell-route.ts`).
 * All this file does is pass the height along: without `min-h-0`, the history cell grows to fit its
 * content and the scrolling leaks to the page.
 *
 * The header, the back link and the title were removed from here in an earlier pass; all three
 * moved to the fixed header:
 *
 * - **The header** is now drawn once by the layout route. When each screen drew its own, it
 *   remounted completely on every navigation.
 * - **The title** comes from the header's context cell. While it lived here, the conversation,
 *   the placeholder and the not-found state each drew it separately, so it shifted slightly on
 *   every state change. On this screen, which is confined to the viewport height, those 40px are
 *   one mobile message line.
 * - **The way out** belongs to the header's global navigation. Its destination is now `Conversations`
 *   (`/chats`), because that is this screen's product parent. The rule is unchanged: it looks at
 *   neither the history nor the work that created the room. Rooms are local data and outlive their
 *   work, and someone who opens the address directly or reloads has no item to go back to. The
 *   screen must not turn into one that asks the server where to go back to. For the same reason the
 *   canvas carries no separate `← Conversations`: two controls going to the same place means one of them
 *   becomes dead decoration.
 *
 * ## The width left this cell, because of the scrollbar
 *
 * This div once bounded the whole screen with `max-w-3xl`, which drew the history's scrollbar just
 * inside the right edge of that width. On a wide screen it sat beside the text column, around the
 * middle of the screen, which put a system widget where the eye lands while reading. That is a
 * typesetting problem, not a matter of taste.
 *
 * Now this cell holds only the vertical extent, and the width belongs to the **content**
 * (`ChatColumn`). The scroll cell takes the full canvas width, so the scrollbar moves to the far
 * right edge, and the text stays centred in `max-w-3xl`. The trade-off is that several places now
 * state that width, so **the value has one source**. If each place wrote `max-w-3xl`, adjusting the
 * width would leave only the input, or only the error line, at a different width.
 *
 * The text width is `max-w-[50rem]`. It moved from `max-w-3xl` (48rem) not for the width itself but
 * because **the text got bigger**: prose went from 15px to 16px, so at the same width fewer
 * characters fit per line and the rhythm got tighter. The side margins were also widened one step
 * (`px-5 md:px-8`). All three moved together, so a line still holds roughly 46 Korean characters
 * and the prose keeps its reading rhythm.
 *
 * Extra space on desktop is not widened into. Longer lines make it harder to find the start of the
 * next line. The leftover space is the **edge of the stage**, not waste, and filling it turns the
 * conversation into a full-screen document.
 */
export function ChatShell({
	title,
	children,
}: {
	/** The room title. Omit it while unknown (placeholder and error states). */
	title?: string;
	children: ReactNode;
}) {
	/*
	 * The vertical cell and the document title belong to `ConversationViewport`. They moved there when
	 * runtime playback began sharing the same geometry (see that file's header). What remains here is
	 * the conversation room's name and the width of the reading column below.
	 */
	return (
		<ConversationViewport title={title ?? translator("chat")("conversation")}>
			{children}
		</ConversationViewport>
	);
}

/**
 * Reading column width. **This one string sets the typography of the conversation screen.**
 *
 * It is exported as a class because some consumers cannot be wrapped in a component: the
 * virtualized list's inner cell and the absolutely positioned "latest message" button. Wrapping
 * either one in a component would add a box for the virtualizer to measure, or another positioning
 * reference for the absolute child.
 *
 * Do not apply it to the scroll cell. Doing so pulls the scrollbar back inside this width, which is
 * the exact opposite of what this value is for.
 */
export const CHAT_COLUMN = "mx-auto w-full max-w-[50rem] px-5 md:px-8";

/**
 * Wraps content in the reading column. Used by the siblings that do not scroll (the input, the
 * error line and the empty state).
 *
 * `shrink-0` is the default because these cells must **not give up height**. In the vertical cell
 * only the history may shrink. If the input began to shrink, the space to write would disappear
 * first in a long conversation.
 */
export function ChatColumn({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={`${CHAT_COLUMN} shrink-0 ${className ?? ""}`}>
			{children}
		</div>
	);
}
