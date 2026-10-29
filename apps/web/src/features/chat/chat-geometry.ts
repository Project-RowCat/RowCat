import type { ConversationDisplayMessage } from "#/features/conversation/message.ts";

/**
 * Conversation screen dimensions: values that the live list and the placeholder **must read
 * identically**.
 *
 * They were pulled out because the drift actually happened. When the composer changed from three
 * stacked borders to one rounded surface, `chat-skeleton.tsx` kept the old geometry (a top solid
 * rule and a square input box). The server-rendered screen then jumped 16px at hydration and lost
 * the solid rule, which is **exactly the jump the placeholder exists to prevent.** While two files
 * each write their own classes, that mismatch passes both compile and tests and is visible only to
 * someone who reloads.
 *
 * The second reason for this module is the **bundle boundary**. The placeholder is the only body
 * the server renders (`routes/(app)/chat/$roomId.tsx` imports it statically, outside `ClientOnly`),
 * so it cannot import values from `message-list.tsx`. Doing so would pull TanStack Virtual and the
 * whole conversation screen into the server bundle's static graph. So the direction is reversed:
 * this file imports nothing (only a type), and both the list and the placeholder read from here.
 *
 * Exporting class strings follows the same axis. Wrapping them in a component would have the
 * placeholder take a real input, and then `useState`, IME handling and generation callbacks would
 * follow it into the server bundle.
 *
 * ## This file is the typography
 *
 * **Almost every value here moved in the visual redesign.** Prose size and leading, the rhythm
 * between turns, the position of the action row and the composer surface are all constants in this
 * file. If they lived in the screen files, changing one would leave the virtualizer's estimate and
 * the placeholder behind separately. Keeping them side by side means that changing the typography
 * also changes the estimate.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Vertical rhythm of the transcript
 *
 * All of these are **virtualizer coordinates** (`message-list.tsx`). The rule in that file that the scroll
 * container gets no CSS margins shows up here as values: line spacing and list padding are options, not margins.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Gap between turns.
 *
 * Going from 24 to a larger value is half of the new rhythm. The other half is that **the action
 * row moved toward its body** (`MESSAGE_STACK_GAP` below). They are one decision: previously the
 * gap between body and actions (6px) and the gap between turns (24px) were the same order of
 * magnitude, so when scanning, the action row read as **another line wedged between lines** rather
 * than part of its turn. Now actions attach to their body (4px) and the gap between turns is nine
 * times larger, so the eye counts turns first.
 *
 * It is not pushed to 100px. This is still an ongoing conversation, and two turns have to fit in a
 * 768px-tall window.
 */
export const ROW_GAP_PX = 36;

/**
 * Space above the list. Clears the top of the stage so the first paragraph does not start directly
 * under the header.
 */
export const LIST_PADDING_START_PX = 28;

/**
 * Space below the list. Separates the list from the composer, and reserves the height of the `Jump to
 * latest` button so it does not sit on top of the last paragraph.
 */
export const LIST_PADDING_END_PX = 64;

/**
 * Gap between pieces inside one message line: speaker name, body, interruption note, action row.
 *
 * The class and the pixel value are exported **side by side**. The placeholder and the message rows
 * take this gap from CSS (`gap-1`), and the virtualizer's estimate needs the same gap as a number.
 * We do not add code that parses a class string into pixels at runtime: that would be a second
 * implementation of Tailwind's scale, and it fails silently when wrong. That the two say the same
 * value is kept by people. `chat-geometry.test.ts` pins the relation to
 * `MESSAGE_ACTIONS_RESERVE_PX` by value.
 */
export const MESSAGE_STACK_GAP = "gap-1";

/** Pixel value of `MESSAGE_STACK_GAP`: `gap-1` = 4px. The two are two representations of one value. */
export const MESSAGE_STACK_GAP_PX = 4;

/**
 * Height of the action row **itself**: the `h-8` in `message-action-bar.tsx`.
 *
 * This value and `MESSAGE_ACTIONS_RESERVE_PX` below are **different things**, and folding them into
 * one constant was the real defect. For a while this file had only `ACTIONS_ROW_PX = 36`: the name
 * said "action row" but the value was "gap + action row". A place that used it inside a parent that
 * already had the gap (`ChatSkeleton`) counted the gap **twice**, 4px extra per placeholder turn,
 * which is 16px across four turns. This kind of mismatch passes compile and tests, so the names
 * keep the two apart.
 */
export const MESSAGE_ACTION_BAR_HEIGHT_PX = 32;

/**
 * Extra vertical space a message takes **when actions are attached**: `gap + action row height`.
 *
 * This is a **cost**, not a physical height. The difference between a row without actions and one
 * with actions is exactly this value, so it applies only where a cell has to reserve its own room
 * inside its own flow:
 *
 * ```text
 * estimate                  estimateMessageHeight        the action row takes space even when hidden (only opacity is 0)
 * streaming response        reserve cell in message-list a sibling outside MessageRow, so no gap is added automatically
 * ```
 *
 * Where space is reserved inside a parent that **already has `MESSAGE_STACK_GAP`**, the code uses
 * `MESSAGE_ACTION_BAR_HEIGHT_PX` instead (`ActionsReserve` in `ChatSkeleton`): the parent has
 * already paid the gap.
 *
 * The streaming response's reserve is the one noticed last. A streaming line cannot show actions
 * (it is not a record, it has no identity to copy and no tail to rewrite), but once the line
 * becomes a stored message, the action row appears. If the space is not reserved in advance, the
 * last paragraph the user was reading is pushed down by that amount.
 *
 * **Not shrinking this height is one of the main points of the visual redesign.** Making actions
 * quieter is different from removing their space. Removing it makes the conversation jump on every
 * hover, and touch users lose their way to reach the action. What was reduced is **weight**, not
 * geometry (`message-action-bar.tsx`).
 */
export const MESSAGE_ACTIONS_RESERVE_PX =
	MESSAGE_STACK_GAP_PX + MESSAGE_ACTION_BAR_HEIGHT_PX;

/**
 * Height of the cell waiting for the first token: two lines of prose.
 *
 * This replaced three dots. That indicator only said "something is running", so it could look like
 * something that happens anywhere in the conversation. This cell now **holds the space the next
 * turn will occupy**, and so says where the text will appear.
 *
 * The value is exactly two lines so the jump when the first token arrives stays small. The first
 * frame of a response is usually one or two lines, so a larger value would make the cell shrink as
 * the text appears.
 */
export const PENDING_ROW_PX = 60;

/* ══════════════════════════════════════════════════════════════════════════
 * Height estimation
 *
 * The height of lines not yet drawn. The further the estimate is from reality, the more the scrollbar lies, and the
 * correction after loading earlier messages (`Load earlier messages`) does not land in one step: measurements arrive and
 * the list catches up gradually. So instead of one constant, lines are counted from character counts. Roleplay
 * responses range from one line to twenty.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Height of one line of assistant body. **Must equal the leading of `ASSISTANT_PROSE`.** */
export const ESTIMATED_LINE_HEIGHT_PX = 30;

/**
 * Estimated number of characters that fit on one prose line at the reading width.
 *
 * Both the width and the glyph size grew, so this barely moved (720px / 15px → 736px / 16px). **It
 * errs low**, meaning it assumes fewer characters per line and so counts more lines. The estimate
 * runs slightly tall, and the error only makes the scrollbar look a little long. The opposite error
 * would leave the list at the bottom while text still remains.
 */
export const ESTIMATED_LINE_CHARS = 40;

/**
 * Characters that fit on one line of a user bubble. **Far fewer than prose.**
 *
 * This axis appeared with this typography pass. The bubble now takes at most 64% of the reading
 * width (`message-row.tsx`; the two roles are deliberately not symmetric). Counting with the same
 * character count as prose would halve the line count of a long utterance. Most utterances are one
 * or two lines, so the error is usually invisible. It shows up as a scroll offset only in rooms
 * holding long pasted messages.
 */
export const ESTIMATED_USER_LINE_CHARS = 26;

/** Extra added only to user bubbles: the speaker-name line and the bubble's inner padding (`py-3`). */
export const USER_BUBBLE_EXTRA_PX = 44;

/**
 * Estimated number of lines that prose wraps to. **The repository has exactly one copy of this
 * rule.**
 *
 * Counts explicit line breaks first, then adds how many lines each paragraph wraps to at this
 * width.
 *
 * **It does not interpret markdown syntax.** Headings, lists and tables have heights that differ
 * from their character counts, but those lines get their real height from `ResizeObserver` as soon
 * as they enter the viewport. The estimate has to answer for lines not yet drawn, and most
 * conversation content is prose with no syntax at all. Running a parser here would parse every
 * line's markdown twice on each scroll, once for the estimate and once for the render. Counting
 * each consecutive blank line separately is the same axis: markdown folds them into one gap, so the
 * estimate runs taller than reality, and as this file records, **that direction is safe.**
 *
 * Not exported, for ownership reasons. If the stored message and the streaming response each began
 * writing `split("\n")` and `Math.ceil(length / charsPerLine)`, the same text would estimate
 * differently in the two states, and the conversation would jump by that difference when the
 * response is confirmed.
 */
function estimateTextLines(text: string, charsPerLine: number): number {
	return text
		.split("\n")
		.reduce(
			(total, line) =>
				total + Math.max(1, Math.ceil(line.length / charsPerLine)),
			0,
		);
}

/**
 * Height of a message's **body**. Actions are not included here.
 *
 * Separating the two is the second point of this file. Whether actions attach is a screen policy
 * (`renderActions` in `MessageList`), while the body height is a typographic result. Combining them
 * would charge 36px per line even on screens that do not draw actions.
 */
export function estimateMessageContentHeight(
	message: Pick<ConversationDisplayMessage, "role" | "content">,
): number {
	const isUser = message.role === "user";
	const lines = estimateTextLines(
		message.content,
		isUser ? ESTIMATED_USER_LINE_CHARS : ESTIMATED_LINE_CHARS,
	);
	return lines * ESTIMATED_LINE_HEIGHT_PX + (isUser ? USER_BUBBLE_EXTRA_PX : 0);
}

/**
 * Estimated height of one stored message row.
 *
 * A pure function, so it can be checked without rendering. That is the point. Omitting the action
 * reserve here would make every row's estimate 36px too small. The error accumulates with row count
 * and only shows in long conversations (in a ten-message room it is 360px, which is easy to miss).
 *
 * `hasActions` is an argument because **the axis actually varies**. The conversation screen passes
 * no `renderActions` until the local scope opens (`chat-page.tsx`), and until then rows draw no
 * action row. There is no default value, for the same reason: the caller must state the DOM it
 * draws, and forgetting it breaks compilation first.
 */
export function estimateMessageHeight(
	message: Pick<ConversationDisplayMessage, "role" | "content">,
	hasActions: boolean,
): number {
	return (
		estimateMessageContentHeight(message) +
		(hasActions ? MESSAGE_ACTIONS_RESERVE_PX : 0)
	);
}

/**
 * Estimated height of the in-progress response row. Before and after the first token are **two
 * appearances of the same row.**
 *
 * This cell was once `streamingText ? ESTIMATED_LINE_HEIGHT_PX : PENDING_ROW_PX`, and the value
 * after the first token never grew with the text: a twenty-paragraph response was estimated at
 * 30px. While the row is on screen, `ResizeObserver` corrects that quickly, so there is no visible
 * symptom. A response growing off-screen gets no such correction. If the user is reading several
 * screens up, the row is not even mounted. Meanwhile the total virtual height stays the same, so
 * the scrollbar and the `Jump to latest` decision are wrong, and then a large correction happens all at
 * once when the user approaches that row.
 *
 * So it is counted by **the same function** as a stored assistant message. For the same text and
 * the same action geometry, the two estimates must be equal, so the estimate does not change in the
 * frame where the response is confirmed.
 */
export function estimateResponseHeight(
	streamingText: string,
	hasActions: boolean,
): number {
	/*
	 * Before any character has arrived, the placeholder height is this row's height. Treating it as
	 * one line would make the cell grow to two lines when it is drawn, and the user would see the
	 * message they just sent pushed upward.
	 */
	const content = streamingText
		? estimateMessageContentHeight({
				role: "assistant",
				content: streamingText,
			})
		: PENDING_ROW_PX;
	return content + (hasActions ? MESSAGE_ACTIONS_RESERVE_PX : 0);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Typography
 *
 * The prose classes live here because they are **the same value** as `ESTIMATED_LINE_HEIGHT_PX` above. Changing the leading
 * in a screen file silently falls out of step with the estimate. The symptom is only a long conversation's scrollbar
 * drifting a little, so nobody finds the cause.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Assistant body: **the protagonist of this screen**.
 *
 * It still has no bubble. What changed is weight. The move from 15px / 28 to 16px / 30 follows the
 * nature of this text: it is neither a notification nor a log, it is **prose to read**, so it
 * should follow body-text typography rather than messaging typography.
 *
 * **The line-break rule left this string.** Since the body began rendering as markdown
 * (`chat-markdown.tsx`), this place cannot hold `whitespace-pre-wrap`. Newline text nodes sit
 * **between** the block elements of the markdown output, and if the outer box preserves whitespace,
 * each newline becomes a blank line and the gap between paragraphs doubles. So the block that holds
 * the text preserves breaks (`PROSE_SOFT_BREAKS`), and `PROSE_BLOCK_GAP` handles the gap between
 * paragraphs.
 *
 * `word-break: keep-all` is the result of looking at Korean first. The default (`normal`) breaks
 * CJK at character boundaries, so words split at arbitrary points at line ends. A short English
 * benchmark screen never shows this; real roleplay sentences do. Tokens with no break opportunity
 * (URLs, paths) are handled by `break-words`. Without it, a single address would scroll the whole
 * conversation horizontally.
 *
 * **`break-keep` is not written here.** Passing that utility together with `break-words` to `cn()`
 * makes tailwind-merge treat them as one group and **drop the first one**: the class string keeps
 * it, the rendered element does not. That mismatch passes compile and string-only tests, and it
 * appears only when a Korean sentence is actually drawn (it did). The arbitrary-property form has
 * its own group, so it is never dropped.
 */
export const ASSISTANT_PROSE =
	"w-full text-[1rem] leading-[1.875rem] [word-break:keep-all] break-words text-foreground";

/**
 * Line breaks for blocks that hold text directly. Line breaks inside a paragraph are drawn as they
 * are written.
 *
 * Roleplay manuscripts break lines even inside a paragraph to build scenes ("He laughed." followed
 * by a line of dialogue).
 *
 * **Ownership of that preservation moved from this class to the parser.** Breaks are now nodes in
 * the tree (`remark-breaks` in `@rowcat/markdown`). Mobile has no such CSS, so if only the web held
 * this in CSS, the same manuscript would breathe differently on the two screens. What remains here
 * is the newline in places the parser does not turn into nodes (a line inside a table cell, and old
 * markup that still uses this class). It stays because removing it gains nothing and loses nothing:
 * breaks already consumed by a `break` node never reach this class.
 *
 * `pre-line`, not `pre-wrap`, is deliberate. The latter keeps runs of spaces, so markdown
 * indentation would appear on screen and list items would shift a column.
 *
 * It applies only to blocks that **hold text directly** (paragraphs, headings, table cells). On
 * containers such as lists, quotes or tables, the newline nodes between children would become blank
 * lines again. That is the same reason `ASSISTANT_PROSE` lost this rule.
 */
export const PROSE_SOFT_BREAKS = "whitespace-pre-line";

/**
 * Height cap for markdown images.
 *
 * The width is already set by the reading column (`max-w-full`). This sets the vertical limit, and
 * it is needed only in the conversation screen: a tall picture covering the whole screen would hide
 * the text above and below it, and the user would lose their place. In a document that would be
 * fine, but this is a conversation.
 *
 * It lives in `chat-geometry.ts` because it sits on the **same axis** as the estimate above.
 * `estimateTextLines` does not parse markdown, so a line containing an image is always estimated
 * smaller than it really is. A cap puts a ceiling on that error. Without one, a single 4000px
 * picture would make that line's estimate meaningless. The real height arrives from
 * `ResizeObserver` soon after.
 */

/**
 * Gap between markdown blocks: **exactly one line.**
 *
 * Two reasons this value is not arbitrary. The first is typography: the old `whitespace-pre-wrap`
 * drew the blank lines between paragraphs at one line's height. Using the same value means plain
 * text (a response with no markdown syntax) keeps exactly the same rhythm, **not one pixel
 * changes**. Turning markdown on must not change the shape of conversations already accumulated.
 *
 * The second is the estimate above. `estimateTextLines` counts each blank line in the source as
 * **one line**. Markdown removes those blank lines and draws this gap instead, so the estimate
 * stays exact only when the two are equal. That is why this constant lives here rather than in a
 * screen file, and why `chat-geometry.test.ts` compares the two values.
 */
export const PROSE_BLOCK_GAP = "mt-[1.875rem] first:mt-0";

/* ══════════════════════════════════════════════════════════════════════════
 * Composer
 *
 * Class strings, for the reason given in the header: the placeholder cannot take the real composer as a value.
 * Also deliberately absent: the surface that comes alive with focus or input (`focus-within:*`) and its transitions
 * exist only on the **real** composer. The placeholder has no field that can take focus, and if these values were
 * exported too, the next person would attach them to the placeholder as well.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The outer layer around the composer: spacing from the conversation, and the device's safe area.
 *
 * The larger margin **replaces the solid rule.** Previously a top rule divided the conversation
 * from the composer, and after it was removed, the 12px margin left the composer nearly touching
 * the last paragraph. The boundary was gone but no hierarchy had replaced it. Now the gap, together
 * with the list's bottom padding, is a full step of space, so the stage and the object on it are
 * separated by space.
 *
 * `max()` is used because `env()` is 0 on desktop. It grows only on devices with a home indicator,
 * without forcing a large margin everywhere.
 *
 * **Width is not set here.** The reading column's width is already owned by the caller
 * (`CHAT_COLUMN`), and `chat-shell.tsx` records that it must have a single source.
 */
export const COMPOSER_FRAME =
	"shrink-0 bg-background pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]";

/**
 * The input and the send button are **one surface**, and that surface recedes when idle.
 *
 * Previously a top solid rule (`border-t`) divided the conversation from the input, and inside it
 * the input and the button each had their own borders and floated: three boundaries in the same
 * place. The next pass folded that into one rounded surface, and this time the surface **has
 * states**. While reading, it recedes into a faint gray. When focus arrives or text is typed, its
 * background, border and shadow come alive together. Size does not change by a pixel, since a
 * growing input would push the paragraph being read.
 *
 * `items-end` keeps the send button at the bottom as the input grows across lines. Only the inner
 * left padding is larger (`pl-3`), so the text starts inside the surface's curve.
 */
export const COMPOSER_SURFACE =
	"flex items-end gap-2 rounded-3xl border border-border/60 bg-muted/30 p-2 pl-3";

/**
 * Minimum height of the input field inside the surface: larger than the send button (`size-10`,
 * 40px).
 *
 * So the field, not the button, sets the surface height. The placeholder uses the same value, so
 * the surface keeps its height through hydration.
 */
export const COMPOSER_FIELD_MIN_H = "min-h-11";

/**
 * Font size of the input field. **On narrow screens it does not go below 16px.**
 *
 * This is iOS Safari behavior, not a taste choice. The browser **zooms the page** when focus enters
 * an input whose text is smaller than 16px. This screen is locked to the viewport
 * (`viewportLocked`), so the zoom never reverts, and the header and composer are pushed outside the
 * enlarged layout viewport. To the user it looks like "I tapped to type and the screen broke."
 *
 * There are two fixes, and we do not use the first. `user-scalable=no` (or `maximum-scale=1`)
 * prevents that zoom but **also blocks pinch zoom**. Low-vision users would then be unable to
 * enlarge any screen in this product, a cost that cannot be weighed against this problem. So the
 * axis is reversed: make the text large enough that zoom is never needed.
 *
 * Returning to 15px on wide screens is because those screens do not have this behavior (a browser
 * used with a mouse does not zoom on focus). From `sm` up, the font matches the message body, so
 * the conversation and the composer sit on one scale.
 */
export const COMPOSER_FIELD_TEXT = "text-base sm:text-[0.9375rem]";

/**
 * Send and stop button: **a circle.**
 *
 * A square button sitting at the right of the surface reads as a separate control attached to the
 * input. A circle sits inside the rounded surface as part of the same geometry. More importantly,
 * `send → stop` then reads as **the glyph of the same object changing**: position, size and shape
 * stay the same.
 */
export const COMPOSER_BUTTON = "shrink-0 rounded-full";
