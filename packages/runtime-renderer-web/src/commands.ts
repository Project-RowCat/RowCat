import type {
	RuntimeCommandBatch,
	RuntimeHostCommand,
} from "@rowcat/runtime-host/commands";
import { rendererError, WEB_RENDERER_ERROR_CODE } from "./errors.ts";
import type { NodeRecord, NodeRegistry } from "./nodes.ts";

/**
 * Control command → one DOM operation. There is one handler per kind, and no method is named by a
 * string.
 * - No element[method]() in this file. This follows the same rule as the prop table, which has no
 *   setAttribute(name, value). If a command carried a method name, a runtime command would be
 *   authority over the whole DOM, and safety would rest on a string instead of types.
 * - A control that is not attached is not a failure. The VM warns when a control is not attached
 *   for this realm. The race is real, though: a commit that removes the node may be applied after
 *   the command was sent. Throwing would let a normal node lifecycle kill the renderer, so the
 *   command is silently skipped.
 * - The trusted shell is never controlled. Lookup uses only this renderer's registry, which holds
 *   nodes created by patches. There is no document or querySelector here, so creator commands
 *   cannot reach anything outside the shadow root. Even the synthetic root (rc-root) receives no
 *   control, since it has no prop table entry.
 */

/**
 * A node's kind is the authorization for control commands. Only these kinds accept scroll or focus.
 */
const SCROLLABLE = "scroll";
const TEXT_ENTRY: ReadonlySet<string> = new Set(["text-input", "text-area"]);

const scrollElement = (record: NodeRecord): HTMLElement | null =>
	record.kind === SCROLLABLE ? (record.node as HTMLElement) : null;

const entryElement = (
	record: NodeRecord,
): (HTMLElement & { focus(): void; blur(): void }) | null =>
	TEXT_ENTRY.has(record.kind as string)
		? (record.node as HTMLInputElement | HTMLTextAreaElement)
		: null;

/**
 * The axis is set by the scroll's `horizontal` flag, and only that axis is touched. Setting both to
 * 0 together would reset the vertical position when a horizontal scroll moves.
 */
function applyScroll(
	element: HTMLElement,
	horizontal: boolean,
	to: number,
): void {
	if (horizontal)
		element.scrollTo({ left: to, behavior: "instant" as ScrollBehavior });
	else element.scrollTo({ top: to, behavior: "instant" as ScrollBehavior });
}

const endOffset = (element: HTMLElement, horizontal: boolean): number =>
	horizontal
		? Math.max(0, element.scrollWidth - element.clientWidth)
		: Math.max(0, element.scrollHeight - element.clientHeight);

function applyCommand(
	registry: NodeRegistry,
	command: RuntimeHostCommand,
): void {
	const record = registry.control(command.control);
	if (record === null) return;
	switch (command.op) {
		case "scroll": {
			const element = scrollElement(record);
			if (element === null)
				throw rendererError(
					WEB_RENDERER_ERROR_CODE.contract,
					`scroll command targets a ${record.kind} node`,
				);
			const horizontal = record.props.get("horizontal") === true;
			/**
			 * `end` is measured against the current layout. Reading scrollHeight forces layout, so content
			 * grown by the commit that just arrived is already reflected. That is why the web needs no queue
			 * waiting for mount.
			 */
			const to =
				command.to === "offset"
					? command.offset
					: command.to === "start"
						? 0
						: endOffset(element, horizontal);
			applyScroll(element, horizontal, to);
			return;
		}
		case "focus": {
			const element = entryElement(record);
			if (element === null)
				throw rendererError(
					WEB_RENDERER_ERROR_CODE.contract,
					`focus command targets a ${record.kind} node`,
				);
			/**
			 * A disabled input does nothing. The browser already behaves this way, but it is checked here
			 * too so the contract can be verified by value, and so both platforms give the same answer.
			 */
			if (record.disabled) return;
			element.focus();
			return;
		}
		case "blur": {
			const element = entryElement(record);
			if (element === null)
				throw rendererError(
					WEB_RENDERER_ERROR_CODE.contract,
					`blur command targets a ${record.kind} node`,
				);
			element.blur();
			return;
		}
	}
}

/**
 * Applies a batch in order. If it throws, the renderer is in the failed state; the caller decides
 * what to do.
 */
export function applyCommandBatch(
	registry: NodeRegistry,
	batch: RuntimeCommandBatch,
): void {
	for (const command of batch.commands) applyCommand(registry, command);
}
