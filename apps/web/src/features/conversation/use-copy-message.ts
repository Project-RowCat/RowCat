import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { COPY_FEEDBACK_MS } from "#/lib/motion/icon-swap.ts";

/**
 * Copies one message to the clipboard. This state machine is shared by two screens.
 *
 * It lives in a hook because the placement differs but the logic does not. The conversation action
 * row shows this button among five hover-revealed icons. The work-test debugger has only this
 * button (no message tail to delete, no server identity to report), so the difference is in the
 * class and neighboring buttons, not in whether the copy succeeded.
 *
 * Two copies would drift in a predictable way: one side forgets to clear the unmount timer, or one
 * side loses the live region. A lost live region fails silently, and only for users who are not
 * looking at the screen.
 */

export type CopyMessageState = "idle" | "copied" | "failed";

export interface CopyMessage {
	state: CopyMessageState;
	/** Accessible name of the button. It changes with the state. */
	label: string;
	/** Text read by the live region. Empty when idle, because there is nothing to announce. */
	announcement: string;
	copy: () => void;
}

/**
 * Decides what is copied. Only the label varies; the state machine stays a single one.
 *
 * A third consumer, the work-test debugger that copies prompts and JSON, introduced this axis.
 * There `Copy message` is the wrong name. A second 40-line state machine would still drift: one side
 * forgets the unmount timer cleanup, or one side loses the live region, which fails silently for
 * users who are not looking at the screen.
 */
export type CopyNoun =
	| "message"
	| "block"
	| "request"
	| "lore"
	| "scanText"
	| "value"
	| "previousValue";

const LABEL = (
	t: TFunction<"conversation">,
	noun: string,
): Record<CopyMessageState, string> => ({
	idle: t("copy.idle", { noun }),
	copied: t("copy.copied"),
	failed: t("copy.failed"),
});

const ANNOUNCEMENT = (
	t: TFunction<"conversation">,
	noun: string,
): Record<CopyMessageState, string> => ({
	idle: "",
	copied: t("copy.announceCopied", { noun }),
	failed: t("copy.announceFailed", { noun }),
});

/**
 * Copies the stored original text, not the text rendered on screen.
 *
 * If a markdown renderer is added later, what users take away must still be text they can paste.
 * Copying rendered DOM text would paste without paragraph, emphasis, or list markup, which is a
 * different text from the original.
 *
 * Internal identifiers, model names, and token usage are left out. The user asked for this message,
 * not its metadata. An export feature, if needed, would come from its own action.
 */
export function useCopyMessage(
	content: string,
	/** The noun used in the button label. Defaults to the conversation screen's wording. */
	noun: CopyNoun = "message",
): CopyMessage {
	const { t } = useTranslation("conversation");
	const [state, setState] = useState<CopyMessageState>("idle");
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	/**
	 * If the component unmounts before the status reverts, the timer would outlive it. This cleanup
	 * clears it.
	 */
	useEffect(
		() => () => {
			if (timerRef.current !== null) clearTimeout(timerRef.current);
		},
		[],
	);

	const flash = (next: Exclude<CopyMessageState, "idle">) => {
		setState(next);
		if (timerRef.current !== null) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
	};

	const copy = () => {
		const clipboard = navigator.clipboard;
		// The Clipboard API is absent in insecure contexts or where permission is blocked, so the attempt
		// is reported as a failure rather than thrown.
		if (!clipboard) return flash("failed");
		void clipboard.writeText(content).then(
			() => flash("copied"),
			() => flash("failed"),
		);
	};

	return {
		state,
		label: LABEL(t, t(`copy.nouns.${noun}`))[state],
		announcement: ANNOUNCEMENT(t, t(`copy.nouns.${noun}`))[state],
		copy,
	};
}
