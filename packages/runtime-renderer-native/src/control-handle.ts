import type {
	NativeControlHandle,
	NativeScrollHandle,
	NativeTextEntryHandle,
} from "./control-deck.ts";

/**
 * Turns an attached ref into a control handle by checking its shape; returns null otherwise.
 *
 * Checked by shape rather than with an `as` cast. Animated.createAnimatedComponent's ref type is
 * loose in RN's declarations. A cast would let the deck call methods the component lacks, so one
 * command would crash the surface, and that failure would only show on device. Rejecting it here
 * means the handle is simply not attached, which is already a normal state.
 *
 * Only the two methods the deck calls are checked. Checking more would make this file the place
 * that knows RN's ref shape, and that knowledge goes stale silently when RN changes.
 */
export function controlHandleOf(instance: unknown): NativeControlHandle | null {
	if (instance === null || typeof instance !== "object") return null;
	const candidate = instance as Partial<
		NativeScrollHandle & NativeTextEntryHandle
	>;
	if (
		typeof candidate.scrollTo === "function" &&
		typeof candidate.scrollToEnd === "function"
	)
		return candidate as NativeScrollHandle;
	if (
		typeof candidate.focus === "function" &&
		typeof candidate.blur === "function"
	)
		return candidate as NativeTextEntryHandle;
	return null;
}
