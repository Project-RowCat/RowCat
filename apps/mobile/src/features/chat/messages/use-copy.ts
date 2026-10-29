import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Copies one message to the clipboard: same state machine as the web's
 * `features/conversation/use-copy-message.ts`, different transport. The mark stands briefly then
 * reverts, the result reaches people not looking at the screen, and what is copied is the stored
 * original.
 *
 * ```text
 * transport  navigator.clipboard  ->  expo-clipboard  (RN core's Clipboard is being removed)
 * announce   <output aria-live>   ->  AccessibilityInfo.announceForAccessibility
 * mark       icon swaps           ->  same (`copy` -> `check`)
 * ```
 *
 * Because those three differ, the hook is not lifted into a shared package; sharing a constant and
 * three sentences is not worth a clipboard port in `@rowcat/chat`.
 *
 * `expo-clipboard` is a native module, so adding it needs a rebuild, a build-pipeline change rather
 * than a "component added" (as `react-native-svg` was).
 *
 * The content is never logged on failure; `lib/boundaries.test.ts` already bans `console` in
 * product paths, which here protects conversation content.
 */

/**
 * How long the copied mark stands. It reverts because it is a response, not a state: left on, it
 * reads as "already copied" next time and the user cannot tell whether they copied just now.
 */
const COPY_FEEDBACK_MS = 1600;

export type CopyMessageState = "idle" | "copied" | "failed";

export interface CopyMessage {
	state: CopyMessageState;
	/** Accessible name of the button; changes with state. */
	label: string;
	copy: () => void;
}

/**
 * What is being copied: only the name varies, the state machine is one. A second consumer (the
 * playtest inspector, copying prompts and JSON) made `Copy message` the wrong name there, but a second
 * state machine would diverge (one loses the unmount timer cleanup or the spoken announcement,
 * which only surfaces for users not looking at the screen).
 */
const LABEL = (noun: string): Record<CopyMessageState, string> => ({
	idle: `Copy ${noun}`,
	copied: "Copied",
	failed: "Couldn't copy",
});

const ANNOUNCEMENT = (
	noun: string,
): Record<Exclude<CopyMessageState, "idle">, string> => ({
	copied: `Copied the ${noun}`,
	failed: `Couldn't copy the ${noun}`,
});

/**
 * Copies the stored original, not the text as drawn, so the user gets something pasteable even if a
 * markdown renderer is added. Internal ids, model and token usage are excluded; an export would be
 * its own action.
 */
export function useCopyMessage(
	content: string,
	/** Subject of the label; defaults to the conversation screen's. */
	noun = "Message",
): CopyMessage {
	const [state, setState] = useState<CopyMessageState>("idle");
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Leaving before the mark reverts would leave only the timer. */
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (timerRef.current !== null) clearTimeout(timerRef.current);
		};
	}, []);

	const flash = useCallback(
		(next: Exclude<CopyMessageState, "idle">) => {
			if (!mountedRef.current) return;
			setState(next);
			/** The icon swap is visual only; announce the same fact aloud for screen-reader users. */
			AccessibilityInfo.announceForAccessibility(ANNOUNCEMENT(noun)[next]);
			if (timerRef.current !== null) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				if (mountedRef.current) setState("idle");
			}, COPY_FEEDBACK_MS);
		},
		[noun],
	);

	const copy = useCallback(() => {
		void Clipboard.setStringAsync(content).then(
			(ok) => flash(ok ? "copied" : "failed"),
			() => flash("failed"),
		);
	}, [content, flash]);

	return { state, label: LABEL(noun)[state], copy };
}
