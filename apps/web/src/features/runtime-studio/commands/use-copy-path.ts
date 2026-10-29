import { useCallback, useEffect, useRef, useState } from "react";
import { COPY_FEEDBACK_MS } from "#/lib/motion/icon-swap.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { RUNTIME_COPY_PATH } from "../runtime-copy.ts";

/**
 * Copies one path to the clipboard. Success and failure are shown in different places, on purpose.
 * - Success: an inline line under the explorer header, where the surface that started the action
 *   is still visible.
 * - Failure: an error toast, since the menu that triggered the action has already closed. This
 *   follows the table in docs/design/FAILURE-FEEDBACK.md. An inline failure would land somewhere in
 *   the list after the menu closed, and a success toast would add a toast the app deliberately does
 *   not use. The success label reverts after a delay. If it stayed, the row would read as already
 *   copied the next time it was seen, and the user could not tell a recent copy from an old one.
 *   This matches the chat message copy behavior. The repo has no shared clipboard layer. Each
 *   feature calls navigator.clipboard, and this hook does not add one. What differs is where the
 *   result appears, not the API call.
 */

export interface CopyRuntimePath {
	/** Sentence read by the live region. Empty means there is nothing to announce. */
	announcement: string;
	copy: (path: string) => void;
}

export function useCopyRuntimePath(): CopyRuntimePath {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	/** Clears the pending revert timer on unmount, so it does not fire after the screen is left. */
	useEffect(
		() => () => {
			if (timerRef.current !== null) clearTimeout(timerRef.current);
		},
		[],
	);

	const flash = useCallback(() => {
		setCopied(true);
		if (timerRef.current !== null) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
	}, []);

	const copy = useCallback(
		(path: string) => {
			const clipboard = navigator.clipboard;
			/**
			 * `navigator.clipboard` is missing in insecure contexts or when permission is blocked. Treat
			 * that as a failure, not an exception.
			 */
			if (!clipboard) {
				showErrorToast(RUNTIME_COPY_PATH.failed);
				return;
			}
			void clipboard.writeText(path).then(flash, () => {
				showErrorToast(RUNTIME_COPY_PATH.failed);
			});
		},
		[flash],
	);

	return { announcement: copied ? RUNTIME_COPY_PATH.copied : "", copy };
}
