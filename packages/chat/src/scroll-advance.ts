import { assistantTailOpen } from "./continuation.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Decides when a scroll gesture at the bottom of a conversation starts a paid action.
 *
 * - A truncated or incomplete last response is continued in the same message (`continue`,
 *   prefilled).
 * - A complete last response starts the next scene in a new message (`advance`), without user
 *   input.
 * - Otherwise nothing starts, since Regenerate already covers a last message that is the user's
 *   own.
 * - One judgment picks both actions so the apps cannot disagree. If each screen decided on its
 *   own, one app would continue a cut-off sentence while another wrote a new scene.
 * - `advance` adds no new request shape. The context assembler already appends a continue nudge
 *   when history ends with the assistant, and Regenerate takes the same path. This file only
 *   decides when that request is sent.
 * - The judgment lives outside the screens because it opens a paid action and has two consumers.
 *   A condition loosened in one app would turn one momentum scroll into several requests.
 * - Only new gestures trigger. A downward event starts a new gesture only after a quiet gap, and
 *   only when the gesture began at the bottom. A downward gesture that reaches the bottom is
 *   momentum, not a trigger.
 */

/**
 * A downward event after at least this much silence starts a new gesture. Momentum scrolling fires
 * events tens of milliseconds apart, so it can never start one; a person pausing and scrolling
 * again takes longer.
 */
export const SCROLL_ADVANCE_GESTURE_GAP_MS = 400;

/**
 * What a gesture starts: `continue` extends the same message, and `advance` writes the next scene
 * as a new message.
 */
export type ScrollAdvanceAction =
	| { kind: "continue"; messageId: string }
	| { kind: "advance" };

/**
 * The fields the judgment actually reads. Both display rows and stored rows pass through this type.
 */
type AdvanceableMessage = Pick<
	ChatMessage,
	"id" | "role" | "truncated" | "incomplete"
>;

/**
 * Returns what a scroll gesture at the bottom would start, or null. `canContinue` says whether the
 * session supports continuation (the work test session does not). If the last response is cut off
 * but continuation is unsupported, the function does not advance to a new scene, because a new
 * scene after a cut-off sentence would leave that sentence unfinished forever.
 */
export function scrollAdvanceAction(input: {
	/**
	 * Stored messages in ascending order. The opening message is not a record, so it is not in this
	 * list.
	 */
	messages: readonly AdvanceableMessage[];
	canContinue: boolean;
}): ScrollAdvanceAction | null {
	const last = input.messages[input.messages.length - 1];
	if (!last || last.role !== "assistant") return null;
	if (assistantTailOpen(last))
		return input.canContinue ? { kind: "continue", messageId: last.id } : null;
	return { kind: "advance" };
}

/**
 * The only state carried between events: the time of the last scroll activity. Every event updates
 * it, not just gesture starts.
 */
export interface ScrollAdvanceState {
	lastGestureAt: number | null;
}

export const initialScrollAdvanceState: ScrollAdvanceState = {
	lastGestureAt: null,
};

export interface ScrollAdvanceInput {
	/**
	 * A monotonically increasing time in ms. The caller owns the clock; the judgment never reads one
	 * itself.
	 */
	now: number;
	/**
	 * Whether the scroll is downward, toward the newest message (the finger moves up). Upward events
	 * count only as activity.
	 */
	downward: boolean;
	/** Whether the viewport is at the bottom, measured by each app with its own bottom threshold. */
	atBottom: boolean;
	/**
	 * The action that could start right now (see `scrollAdvanceAction`). If null, the gesture is only
	 * activity.
	 */
	action: ScrollAdvanceAction | null;
	/** Whether generation is already running. While it is, every gesture counts only as activity. */
	generating: boolean;
}

export interface ScrollAdvanceResult {
	state: ScrollAdvanceState;
	/** If set, the caller starts this action. It is set exactly once per gesture. */
	trigger: ScrollAdvanceAction | null;
}

/**
 * Turns one scroll event into a trigger or nothing. Every event updates the activity time,
 * regardless of direction or conditions. A trigger fires only for a new gesture where all
 * conditions hold. Updating activity unconditionally is the point: if non-matching events were not
 * counted, the moment conditions became true in the middle of momentum (generation ended, bottom
 * reached) would read as a new gesture.
 */
export function trackScrollAdvance(
	state: ScrollAdvanceState,
	input: ScrollAdvanceInput,
): ScrollAdvanceResult {
	const fresh =
		state.lastGestureAt === null ||
		input.now - state.lastGestureAt >= SCROLL_ADVANCE_GESTURE_GAP_MS;
	const trigger =
		fresh && input.downward && input.atBottom && !input.generating
			? input.action
			: null;
	return { state: { lastGestureAt: input.now }, trigger };
}
