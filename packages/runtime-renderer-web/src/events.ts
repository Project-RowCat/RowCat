import type { NodeRecord } from "./nodes.ts";
import { syncEntryValue } from "./props.ts";

/**
 * Event delegation: a few listeners on the root, not a closure on each DOM node.
 * - Handler identity is the VM's number, stored in record metadata (nodes.ts). The root listener
 *   finds the record for the node where the event happened, then forwards one number to the host,
 *   plus one string for a text entry.
 * - No browser objects leave this file: no MouseEvent, InputEvent, coordinates, currentTarget or
 *   selection. What goes out is an integer and, for a text entry, a string the renderer read and
 *   built as a wire value.
 * - Korean IME is half of this file. During composition, Enter confirms a candidate. Reading that
 *   Enter as submit would send text the user never sent. So two facts are checked together: our
 *   composition state (from compositionstart and compositionend) and the event's own isComposing
 *   (set on keydown during composition, which also covers Safari's keyCode 229).
 * - The other half is that the host round trip is async. A commit that arrives before the reply
 *   to a sent text shows older characters. Writing the controlled value at the moment composition
 *   ends (which is also when the next composition starts) duplicates or scrambles jamo. So the file
 *   counts sends (NodeRecord.pendingSends) and writes the controlled value only after the reply
 *   arrives.
 * - Disabled elements follow native semantics: the browser creates no click or input for them.
 *   The record's value is checked again anyway, because synthetic dispatchEvent calls can skip that
 *   rule.
 */

export type RuntimeEventPayload = string | null;

/**
 * What raised the event. `media` is a sound reaching its end: the same handler path as a press, but
 * nobody pressed anything, and the host refuses interaction-only capabilities (generation) for it.
 * The renderer decides this at the DOM callback; creator code has no way to name it.
 */
export type RuntimeEventSource = "interaction" | "media";

export type RuntimeEventDispatcher = (
	handlerId: number,
	payload?: RuntimeEventPayload,
	source?: RuntimeEventSource,
) => void;

/** Legacy alias from when only presses existed. It is the same function. */
export type PressDispatcher = RuntimeEventDispatcher;

const PRESSABLE_KINDS: ReadonlySet<string> = new Set(["button", "pressable"]);
const ENTRY_KINDS: ReadonlySet<string> = new Set(["text-input", "text-area"]);

export function pressTargetOf(
	start: Node | null,
	root: Node,
	lookup: (node: Node) => NodeRecord | null,
): number | null {
	let current: Node | null = start;
	while (current !== null && current !== root) {
		const record = lookup(current);
		if (record !== null && PRESSABLE_KINDS.has(record.kind)) {
			if (record.disabled) return null;
			const handler = record.handlers.get("onPress");
			/**
			 * A pressable without a handler is transparent, not disabled: the outer pressable receives the
			 * press.
			 */
			if (handler !== undefined) return handler;
		}
		current = current.parentNode;
	}
	return null;
}

/**
 * The text entry record at the event's target, or none. Text entries have no children, so the
 * target is either the entry itself or not one.
 */
export function entryTargetOf(
	target: EventTarget | null,
	lookup: (node: Node) => NodeRecord | null,
): NodeRecord | null {
	if (!(target instanceof Node)) return null;
	const record = lookup(target);
	return record !== null && ENTRY_KINDS.has(record.kind) ? record : null;
}

/**
 * Sends the current text to the host, and the same value is never sent twice. Some browsers fire
 * `input` again after compositionend. Without this guard, those two events would become two VM
 * turns for one character.
 */
function sendText(record: NodeRecord, dispatch: RuntimeEventDispatcher): void {
	if (record.disabled) return;
	const handler = record.handlers.get("onChangeText");
	const value = (record.node as HTMLInputElement | HTMLTextAreaElement).value;
	if (handler === undefined) {
		/**
		 * If there is no handler, restore the controlled value. Otherwise the screen shows what the user
		 * typed while the creator's state lacks it, and the mismatch only surfaces when saving.
		 */
		syncEntryValue(record);
		return;
	}
	if (record.sentText === value) return;
	record.sentText = value;
	/**
	 * The controlled value may not write the screen until the reply arrives. The round trip is async,
	 * so a commit that arrives now may hold older text. Restoring it then scrambles Korean jamo
	 * (nodes.ts).
	 */
	record.pendingSends += 1;
	dispatch(handler, value);
}

export function installEventDelegation(
	root: HTMLElement,
	lookup: (node: Node) => NodeRecord | null,
	dispatch: RuntimeEventDispatcher,
): () => void {
	const onClick = (event: Event): void => {
		const target = event.target instanceof Node ? event.target : null;
		const handler = pressTargetOf(target, root, lookup);
		if (handler === null) return;
		dispatch(handler);
	};

	const onInput = (event: Event): void => {
		const record = entryTargetOf(event.target, lookup);
		if (record === null) return;
		sendText(record, dispatch);
	};

	const onCompositionStart = (event: Event): void => {
		const record = entryTargetOf(event.target, lookup);
		if (record !== null) record.composing = true;
	};

	const onCompositionEnd = (event: Event): void => {
		const record = entryTargetOf(event.target, lookup);
		if (record === null) return;
		record.composing = false;
		/**
		 * Send the confirmed text first, then sync the controlled value. That sync only writes once the
		 * reply to the sent text has arrived (syncEntryValue). This is the most expensive spot in the
		 * file. Composition end is also where the next composition begins (for example one Hangul syllable confirmed,
		 * then the next starts). Writing a stale value in between makes the IME redraw its composition over
		 * erased text, leaving lost or duplicated jamo.
		 */
		sendText(record, dispatch);
		syncEntryValue(record);
	};

	/**
	 * On focus-out the controlled value regains authority. If a send never got a reply, the creator
	 * may have swallowed the character (at a length cap the value does not change, so no commit
	 * arrives). The field would then lag one step behind every later commit. After focus is lost there
	 * is no composition and no typing, so there is no reason left to hold back.
	 */
	const onFocusOut = (event: Event): void => {
		const record = entryTargetOf(event.target, lookup);
		if (record === null) return;
		record.pendingSends = 0;
		syncEntryValue(record);
	};

	const onKeyDown = (event: Event): void => {
		if (!(event instanceof KeyboardEvent) || event.key !== "Enter") return;
		const record = entryTargetOf(event.target, lookup);
		if (record === null || record.kind !== "text-input") return;
		if (record.disabled) return;
		/**
		 * During composition Enter is not submit; it confirms the candidate. Both facts are checked
		 * because neither alone covers every browser.
		 */
		if (record.composing || event.isComposing) return;
		const handler = record.handlers.get("onSubmit");
		if (handler === undefined) return;
		/**
		 * preventDefault is not here to block form submission (there is no form). It keeps the same Enter
		 * from being read on two paths.
		 */
		event.preventDefault();
		/** Send the last text before submit, so the creator's state never lags the screen. */
		sendText(record, dispatch);
		dispatch(handler);
	};

	root.addEventListener("click", onClick);
	root.addEventListener("input", onInput);
	root.addEventListener("compositionstart", onCompositionStart);
	root.addEventListener("compositionend", onCompositionEnd);
	root.addEventListener("keydown", onKeyDown);
	root.addEventListener("focusout", onFocusOut);
	return () => {
		root.removeEventListener("click", onClick);
		root.removeEventListener("input", onInput);
		root.removeEventListener("compositionstart", onCompositionStart);
		root.removeEventListener("compositionend", onCompositionEnd);
		root.removeEventListener("keydown", onKeyDown);
		root.removeEventListener("focusout", onFocusOut);
	};
}
