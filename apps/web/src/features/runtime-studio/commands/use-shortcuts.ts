import { useEffect, useRef } from "react";

/**
 * Four shortcuts that live only inside the studio: ⌘P (quick open), ⌘B (collapse explorer), ⌘Enter
 * (run or restart preview), ⌘⇧P (command palette). This is not a general shortcut framework: no
 * registry, priorities, or user rebinding. Such a layer would hide which key comes from where.
 * - ⌘Enter exists because re-running a stale preview is the most frequent action on this screen.
 *   Editing makes the running preview stale by design. The product deliberately does not re-run in
 *   place, since there is no way to carry arbitrary hook state into new code. So the loop is edit,
 *   restart, look. The key does what the preview button does, and nothing when the preview is not
 *   eligible. Eligibility stays with the check state; the worker's full compile remains final.
 * - The key runs or restarts depending on preview state (`runtimePreviewControls`). One key
 *   rather than two, because the user's intent is the same: show the current code.
 * - ⌘P (print) and ⌘B (bookmarks bar in some browsers) are browser defaults, so overriding them
 *   is accepted. The override lasts only while the studio is open, since the listener is removed on
 *   leave. ⌘⇧P and ⌘Enter are not used by browsers.
 * - Ignored while a dialog or menu is open, or while typing. Those widgets own their keys.
 *   Intercepting here would make ⌘B collapse the explorer while someone types a name.
 * - The code editor (Monaco) is passed through as well. Its input is a hidden textarea, which the
 *   check above catches. The editor registers its own bindings for the same actions
 *   (`runtime-code-editor.tsx`). Outside the editor this hook handles keys; inside it, Monaco does.
 */

export interface RuntimeShortcutHandlers {
	quickOpen: () => void;
	toggleExplorer: () => void;
	/**
	 * The preview's primary action: run, or restart. When the preview is not eligible, the caller does
	 * nothing. The check is not made here because the same rule guards the button and the palette, and
	 * the decision must live in one place.
	 */
	runPreview: () => void;
	openCommands: () => void;
}

/** Whether the event target owns its keys. If so, this hook ignores the event. */
function ownedElsewhere(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	)
		return true;
	/**
	 * Floating layers keep their own keyboard conventions, such as arrow keys in menus and Escape in
	 * dialogs.
	 */
	return (
		target.closest('[role="menu"],[role="dialog"],[role="listbox"]') !== null
	);
}

export function useRuntimeShortcuts(handlers: RuntimeShortcutHandlers): void {
	/**
	 * The listener is attached once. Capturing the callback in a closure would keep calling the first
	 * render's function, which sees stale state. The ref holds the latest handlers, as the editor
	 * component does.
	 */
	const latest = useRef(handlers);
	latest.current = handlers;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			/** Keys already handled by another layer (`defaultPrevented`) are not handled twice. */
			if (event.defaultPrevented) return;
			if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
			const key = event.key.toLowerCase();
			/**
			 * Shift applies only to the command palette. If ⌘⇧P fell through to quick open in the other
			 * three, two surfaces would answer the same key, and which one opened would depend on event
			 * order in the browser.
			 */
			const action =
				key === "p"
					? event.shiftKey
						? "commands"
						: "quickOpen"
					: event.shiftKey
						? null
						: key === "b"
							? "toggleExplorer"
							: key === "enter"
								? "runPreview"
								: null;
			if (action === null) return;
			if (ownedElsewhere(event.target)) return;

			event.preventDefault();
			if (action === "quickOpen") latest.current.quickOpen();
			else if (action === "commands") latest.current.openCommands();
			else if (action === "toggleExplorer") latest.current.toggleExplorer();
			else latest.current.runPreview();
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}

/**
 * The label for a key on this platform, used by menu hints. It pairs with the rule in
 * `runtime-explorer-commands.ts` of never printing a shortcut that does not exist. Printing a real
 * shortcut under the wrong name is the same kind of lie: on a Mac, showing `Ctrl+P` would send the
 * user to press it, see nothing, and read it as a bug. Without `navigator` on the server, `Ctrl` is
 * the default. The screen only renders on the client, behind `ClientOnly`.
 */
export function runtimeShortcutLabel(
	key: string,
	options: { shift?: boolean } = {},
): string {
	const apple =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
	/**
	 * Only single-character keys are uppercased. Uppercasing `Enter` would give `⌘ENTER`, a label that
	 * appears on no keyboard.
	 */
	const display = key.length === 1 ? key.toUpperCase() : key;
	if (apple) return `⌘${options.shift === true ? "⇧" : ""}${display}`;
	return `Ctrl+${options.shift === true ? "Shift+" : ""}${display}`;
}
