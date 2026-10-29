import type { ChatGenerationEnd } from "@rowcat/chat";

/**
 * Pure decision on whether to signal generation completion by touch.
 *
 * The signal is justified only because the user pressed send and is waiting for the result:
 * - saved: a discarded turn (empty body, ownership moved) delivered nothing.
 * - completed: a stop is already known to the user, and a failure has its own recovery control
 *   (no error haptic, per `docs/design/FAILURE-FEEDBACK.md`).
 * - waited: a short reply ends in front of the user's eyes and would read as a second press.
 * - focused: firing after leaving the room raises "what finished where".
 * - foreground: the OS blocks it in the background anyway, and we do not burst on return.
 *
 * Takes both timestamps instead of reading a clock so the boundary is testable by value.
 */

/** Replies shorter than this end in front of the user's eyes (streaming shows from the first character). Tunable; record the reason for any change here. */
export const GENERATION_HAPTIC_MIN_WAIT_MS = 3000;

export function signalsGenerationDone(input: {
	end: ChatGenerationEnd;
	saved: boolean;
	startedAt: number;
	endedAt: number;
	focused: boolean;
	foreground: boolean;
}): boolean {
	return (
		input.end === "completed" &&
		input.saved &&
		input.focused &&
		input.foreground &&
		input.endedAt - input.startedAt >= GENERATION_HAPTIC_MIN_WAIT_MS
	);
}
