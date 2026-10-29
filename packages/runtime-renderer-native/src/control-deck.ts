import type {
	RuntimeCommandBatch,
	RuntimeHostCommand,
} from "@rowcat/runtime-host/commands";
import type { NativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * Reconciles commands with the native views they target. Web applies patches to the DOM
 * synchronously, so a scroll-height read right after a commit sees the grown content. Native does
 * not: after commit the ref does not exist yet, and scrollToEnd() would target the pre-growth end.
 * So the deck is a small external store. A command raises a version that makes the surface
 * re-render; the surface's effect after each commit drains the pending list, when the tree is
 * materialized and refs are attached. The one-frame wait is the cost of guaranteeing that
 * scrollToEnd() right after setState sees the grown list.
 *
 * A command whose target is not found on drain is discarded, not kept for later frames, because a
 * late scroll would not follow from any user action.
 *
 * Sits in the same place as the audio deck for a different reason: sound is not drawn, so it lives
 * outside React, while control must run after drawing.
 */

/**
 * Everything a controllable native view hands to the deck. Nothing beyond these two methods is
 * used.
 */
export interface NativeScrollHandle {
	scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
	scrollToEnd(options?: { animated?: boolean }): void;
}

export interface NativeTextEntryHandle {
	focus(): void;
	blur(): void;
	isFocused?(): boolean;
}

/**
 * Kept narrow on purpose. Holding the whole ref would expose measure, setNativeProps and _nativeTag
 * to this file, and those would eventually be called. RN's ScrollView and TextInput refs satisfy
 * this shape.
 */
export type NativeControlHandle = NativeScrollHandle | NativeTextEntryHandle;

export interface NativeRuntimeControlDeck {
	/** Holds the batch in pending and drains it after the next render. */
	apply(batch: RuntimeCommandBatch): void;
	/**
	 * Called from HostNode's ref callback; a null handle detaches the node. The handle has no path out
	 * of this file.
	 */
	attach(nodeId: number, handle: NativeControlHandle | null): void;
	/** Called by the surface's effect, which runs after React has drawn. */
	flush(): void;
	subscribe(listener: () => void): () => void;
	getVersion(): number;
	dispose(): void;
	/** For diagnostics and tests only: the number of commands not yet drained. */
	readonly pending: number;
}

export interface NativeRuntimeControlDeckOptions {
	readonly store: NativeRuntimeTreeStore;
}

/** Scroll nodes are identified by kind. The kind is what authorizes a command. */
const SCROLL_KIND = "scroll";
const TEXT_ENTRY_KINDS: ReadonlySet<string> = new Set([
	"text-input",
	"text-area",
]);

export function createNativeRuntimeControlDeck(
	options: NativeRuntimeControlDeckOptions,
): NativeRuntimeControlDeck {
	const { store } = options;
	const handles = new Map<number, NativeControlHandle>();
	let pending: RuntimeHostCommand[] = [];
	let version = 0;
	let disposed = false;
	const listeners = new Set<() => void>();

	const notify = (): void => {
		version += 1;
		for (const listener of [...listeners]) listener();
	};

	/**
	 * Resolves a control number to its node by walking the tree, because the store keeps no index
	 * derived from props. The cost is acceptable: this runs once per command, and commands are
	 * occasional intents such as `to the latest message` or `focus the reply field`, which the per-batch command limit enforces.
	 * An index in the store would have to be updated together with props, opening a window outside the
	 * revert-log atomicity.
	 */
	const nodeFor = (control: number): number | null => {
		for (const id of store.ids())
			if (store.node(id)?.props.control === control) return id;
		return null;
	};

	function run(command: RuntimeHostCommand): void {
		const nodeId = nodeFor(command.control);
		if (nodeId === null) return;
		const node = store.node(nodeId);
		const handle = handles.get(nodeId);
		if (node === null || handle === undefined) return;
		switch (command.op) {
			case "scroll": {
				if (node.kind !== SCROLL_KIND) return;
				const scroll = handle as NativeScrollHandle;
				const { horizontal } = node.props;
				if (command.to === "end") {
					scroll.scrollToEnd({ animated: false });
					return;
				}
				const to = command.to === "offset" ? command.offset : 0;
				/** Moves one axis only, matching the web rule: the other axis is not reset to 0. */
				scroll.scrollTo(
					horizontal ? { x: to, animated: false } : { y: to, animated: false },
				);
				return;
			}
			case "focus": {
				if (!TEXT_ENTRY_KINDS.has(node.kind as string)) return;
				/**
				 * Inactive inputs do nothing. This is checked here to match the web renderer. RN's
				 * editable={false} already blocks focus, but relying on that would tie the cross-platform
				 * contract to the platform's implementation.
				 */
				if (node.props.disabled) return;
				(handle as NativeTextEntryHandle).focus();
				return;
			}
			case "blur": {
				if (!TEXT_ENTRY_KINDS.has(node.kind as string)) return;
				(handle as NativeTextEntryHandle).blur();
				return;
			}
		}
	}

	return {
		get pending() {
			return pending.length;
		},
		apply(batch) {
			if (disposed) return;
			/**
			 * A batch whose revision does not match the store's is discarded, as in the web renderer.
			 * Commands are intent, not tree state, and no one can say which node the intent of a stale batch
			 * points to.
			 */
			if (batch.revision !== store.revision) return;
			if (batch.commands.length === 0) return;
			pending.push(...batch.commands);
			notify();
		},
		attach(nodeId, handle) {
			if (disposed) return;
			if (handle === null) handles.delete(nodeId);
			else handles.set(nodeId, handle);
		},
		flush() {
			if (disposed || pending.length === 0) return;
			const queue = pending;
			pending = [];
			for (const command of queue) run(command);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getVersion() {
			return version;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			pending = [];
			handles.clear();
			listeners.clear();
		},
	};
}
