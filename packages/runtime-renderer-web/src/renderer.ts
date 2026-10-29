import type { RuntimeCommandBatch } from "@rowcat/runtime-host/commands";
import {
	ROOT_HOST_NODE_ID,
	type RuntimePatch,
	type RuntimePatchBatch,
} from "@rowcat/runtime-host/patches";
import { createWebAudioController, type WebAudioMedia } from "./audio.ts";
import { applyCommandBatch } from "./commands.ts";
import {
	rendererError,
	WEB_RENDERER_ERROR_CODE,
	WebRuntimeRendererError,
} from "./errors.ts";
import {
	installEventDelegation,
	type RuntimeEventDispatcher,
} from "./events.ts";
import { applyTransitionCss } from "./motion.ts";
import { type NodeRecord, NodeRegistry } from "./nodes.ts";
import {
	createElementFor,
	removeProp,
	setProp,
	type WebRuntimeAssetResolver,
} from "./props.ts";
import { WEB_RUNTIME_BASE_CSS } from "./theme.ts";

/**
 * Web renderer: applies patch batches by imperative DOM manipulation, not React.
 * - Routing batches through React state would add a second reconciler and re-decide the Phase 4B
 *   rules (node identity, keyed moves, handler identity, atomic commit) under React.
 * - One host node is one DOM node for its whole lifetime. set-text is a single Text.data
 *   assignment.
 * - Revisions are strict: 1, then in order. Duplicates, gaps and rewinds fail, because there is
 *   no snapshot/rewind protocol and a diverged tree would silently show a wrong screen. A failed
 *   renderer takes no more batches or events; reset() starts a new session from an empty root.
 * - Host id 0 has no DOM node; the container inside the shadow root stands in for it.
 * - Creator text arrives only as Text nodes. innerHTML, outerHTML, insertAdjacentHTML and
 *   DOMParser are never used.
 */

export interface WebRuntimeRendererOptions {
	/**
	 * Element the renderer attaches its shadow root to. Everything beneath it belongs to the renderer.
	 */
	container: HTMLElement;
	/**
	 * Maps an interaction to a handler number, plus the typed string for text input. The route to the
	 * VM belongs to the caller (worker or session).
	 */
	dispatchEvent: RuntimeEventDispatcher;
	/**
	 * Maps an asset reference to an address the browser may open. null means a placeholder.
	 *
	 * A remote reference must never return the creator's own address. The player's device would reach
	 * the creator's host directly. The host builds a RowCat proxy address instead
	 * (media.runtimeAssetUrl in @rowcat/sdk). This package does not know that rule.
	 */
	resolveAsset: WebRuntimeAssetResolver;
	/** Called on failure: the host and the screen are no longer the same tree. */
	onFailure?: (error: WebRuntimeRendererError) => void;
	/**
	 * Fired when at least one sound starts or stops waiting for the user's permission. Browsers block
	 * sound before any interaction, which is a policy, not an error. The product shell draws its own
	 * prompt (for example `Tap to play sound`) and calls activateAudio() synchronously inside that tap.
	 * An async call would not count as a user gesture. The prompt is host UI: it is not drawn in the
	 * creator's tree. The tap is not dispatched as a creator event, though a creator control tapped at
	 * the same time still receives its own event.
	 */
	onAudioActivationChange?: (required: boolean) => void;
}

export interface WebRuntimeRenderer {
	/** Revision of the last applied batch. An empty root is at 0. */
	readonly revision: number;
	/** Number of live host nodes, excluding the root. */
	readonly size: number;
	readonly failed: boolean;
	readonly audioActivationRequired: boolean;
	/**
	 * Called when a real user interaction arrives. It resumes the sounds that were waiting.
	 *
	 * Creator code must not see this name. If the VM could call it, the autoplay policy could be
	 * bypassed through one prop, and the product would make sound just by opening a page.
	 */
	activateAudio(): void;
	/** Applies one batch. If it throws, this renderer enters the failed state. */
	apply(batch: RuntimePatchBatch): void;
	/**
	 * One batch of steering commands (scroll, focus). It must arrive after the apply() of the same
	 * turn.
	 *
	 * That ordering is the whole contract. The commit that grew the list has already reached the DOM,
	 * so the scrollHeight that scrollToEnd measures is the grown value.
	 *
	 * If the revision does not match, the batch is dropped silently. Commands express intent, not tree
	 * state, and intent from a stale revision may not point at the node we expect. Failing the
	 * renderer over a harmless race would kill the screen.
	 */
	applyCommands(batch: RuntimeCommandBatch): void;
	/** Returns to an empty root so that the first batch of a new session (revision 1) is accepted. */
	reset(): void;
	dispose(): void;
	/** DOM of a host node, for tests and diagnostics only. Null if absent. */
	node(id: number): Node | null;
	/** Live ids in depth-first order. Use this to check that the registry and the DOM are one tree. */
	ids(): number[];
}

/**
 * Moves a child within the same parent without losing its state.
 *
 * insertBefore detaches and reattaches the node, so the browser drops focus in between (the focus
 * fixup rule). Every keyed reorder would blur the active button, which for keyboard users means
 * starting over each time.
 *
 * Browsers with moveBefore treat the operation as a move and keep focus, selection and scroll.
 * Elsewhere, the code checks whether focus was inside the subtree before the move and restores it
 * afterwards.
 */
function moveNode(parent: HTMLElement, child: Node, before: Node | null): void {
	const movable = parent as HTMLElement & {
		moveBefore?: (node: Node, child: Node | null) => void;
	};
	if (typeof movable.moveBefore === "function") {
		movable.moveBefore(child, before);
		return;
	}
	const scope = parent.getRootNode() as Document | ShadowRoot;
	const active = scope.activeElement;
	const focused =
		active !== null && child.contains(active) ? (active as HTMLElement) : null;
	parent.insertBefore(child, before);
	if (focused !== null && scope.activeElement !== focused)
		focused.focus({ preventScroll: true });
}

export function createWebRuntimeRenderer(
	options: WebRuntimeRendererOptions,
): WebRuntimeRenderer {
	const { container } = options;
	const document = container.ownerDocument;
	const shadow =
		container.shadowRoot ?? container.attachShadow({ mode: "open" });
	/** A host reused by a second attach (the same element mounted twice) is emptied entirely first. */
	while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

	const style = document.createElement("style");
	style.textContent = WEB_RUNTIME_BASE_CSS;
	shadow.appendChild(style);

	const root = document.createElement("div");
	root.className = "rc-root";
	root.dataset.rc = "root";
	shadow.appendChild(root);

	let registry = new NodeRegistry(ROOT_HOST_NODE_ID, root);
	let revision = 0;
	let failure: WebRuntimeRendererError | null = null;
	let disposed = false;

	/**
	 * Nodes that carry a transition policy. This is the list to re-sync when reduced motion changes.
	 *
	 * Same reason as audioNodes: a list avoids scanning the registry, whose cost grows with node
	 * count. The event is rare, but a 5,000-node scan on it is what this renderer avoids.
	 */
	const motionNodes = new Set<NodeRecord>();

	/**
	 * Whether the viewer has reduced motion turned on. This is a question for the trusted host; the
	 * creator cannot read it.
	 *
	 * Where matchMedia is missing (old jsdom, some embeddings) this is false. Reading a missing query
	 * as 'on' would silently remove every transition in that deployment, with no error to show for it.
	 */
	const reduceQuery =
		typeof (container.ownerDocument.defaultView as Window | null)
			?.matchMedia === "function"
			? (container.ownerDocument.defaultView as Window).matchMedia(
					"(prefers-reduced-motion: reduce)",
				)
			: null;
	const reducedMotion = (): boolean => reduceQuery?.matches === true;

	/**
	 * The setting changed: re-sync the declarations of every live node.
	 *
	 * When reduced motion switches on, a transition in progress ends at its target value as soon as
	 * its declaration is removed, so no node is left stuck mid-way.
	 *
	 * When it switches off, values that already arrived are not replayed. Those nodes already sit at
	 * their target, and only the next change moves them.
	 */
	const handleReduceChange = (): void => {
		const reduced = reducedMotion();
		for (const record of motionNodes)
			applyTransitionCss(record.node as HTMLElement, record.motion, reduced);
	};
	reduceQuery?.addEventListener("change", handleReduceChange);

	const context = {
		resolveAsset: options.resolveAsset,
		/**
		 * Look the registry up at call time, not captured as a value. reset() replaces the registry, so a
		 * captured value would write props into a dead table after a reset.
		 */
		bindControl: (record: NodeRecord, control: number) =>
			registry.bindControl(record, control),
		unbindControl: (record: NodeRecord) => registry.unbindControl(record),
		reducedMotion,
		trackMotion: (record: NodeRecord, tracked: boolean): void => {
			if (tracked) motionNodes.add(record);
			else motionNodes.delete(record);
		},
	};

	/**
	 * Nodes created in this batch. They are armed when the batch ends (see motion.ts).
	 *
	 * Creation, prop assignment and insertion all happen inside one batch, so assignments in between
	 * pass without transition declarations. A node's first drawn value therefore does not animate.
	 */
	const created: NodeRecord[] = [];

	const armCreated = (): void => {
		if (created.length === 0) return;
		const reduced = reducedMotion();
		for (const record of created) {
			record.motion.armed = true;
			/** Nodes removed in the meantime are left alone; the registry has already released them. */
			if (!registry.has(record.id)) continue;
			if (record.motion.transition === null) continue;
			applyTransitionCss(record.node as HTMLElement, record.motion, reduced);
		}
		created.length = 0;
	};

	/**
	 * Sounds waiting for permission. This is a set, not a count.
	 *
	 * With a count, a commit in which the same controller enters the wait twice would drift. The drift
	 * appears as a prompt that stays visible while nothing is waiting. A set cannot represent that
	 * mistake.
	 */
	const awaitingActivation = new Set<object>();
	let activationRequired = false;

	const syncActivation = (): void => {
		const next = awaitingActivation.size > 0;
		if (next === activationRequired) return;
		activationRequired = next;
		options.onAudioActivationChange?.(next);
	};

	/** Every sound this renderer created. Visibility changes and disposal walk this list. */
	const audioNodes = new Set<NodeRecord>();

	/**
	 * Pauses when the document is hidden and resumes when it becomes visible. The desired state is
	 * left untouched.
	 *
	 * Music that keeps playing in a background tab is something the user never started, and there is
	 * no good way to tell which tab it came from. Setting playing to false would still be a decision
	 * the creator did not make. So only the actual playback is stopped; the intent to play stays.
	 */
	const handleVisibility = (): void => {
		const hidden = document.visibilityState === "hidden";
		for (const record of audioNodes) {
			if (hidden) record.audio?.suspend();
			else record.audio?.resume();
		}
	};
	document.addEventListener("visibilitychange", handleVisibility);

	/**
	 * Creates the audio controller for one sound node. It is attached where the node is created, not
	 * later.
	 */
	const attachAudio = (record: NodeRecord): void => {
		const token = {};
		record.audio = createWebAudioController({
			media: record.node as unknown as WebAudioMedia,
			onEnded: () => {
				/**
				 * The handler number is read at call time. If it were captured as a value, a creator who later
				 * passed a different function would still fire the old number, and that event would be dropped
				 * silently.
				 */
				const handler = record.handlers.get("onEnded");
				if (handler === undefined) return;
				if (failure !== null || disposed) return;
				options.dispatchEvent(handler, undefined);
			},
			onPendingChange: (pending) => {
				if (pending) awaitingActivation.add(token);
				else awaitingActivation.delete(token);
				syncActivation();
			},
		});
		audioNodes.add(record);
	};

	/**
	 * A node left the tree. The registry disposes its controllers, and this function prunes the lists.
	 *
	 * Sounds and transitions are cleared in one walk. Two walks would traverse the subtree twice, and
	 * each new list would be another chance to forget one of them.
	 */
	const forgetNode = (record: NodeRecord): void => {
		const walk = (node: NodeRecord): void => {
			audioNodes.delete(node);
			motionNodes.delete(node);
			for (const child of node.children) walk(child);
		};
		walk(record);
	};

	const clearAudio = (): void => {
		audioNodes.clear();
		motionNodes.clear();
		created.length = 0;
		awaitingActivation.clear();
		syncActivation();
	};

	const uninstall = installEventDelegation(
		root,
		(node) => registry.fromNode(node),
		(handler, payload) => {
			/**
			 * Interactions after a failure or disposal never reach the VM. The handler number they carry can
			 * no longer be trusted.
			 */
			if (failure !== null || disposed) return;
			options.dispatchEvent(handler, payload);
		},
	);

	const fail = (error: WebRuntimeRendererError): never => {
		if (failure === null) {
			failure = error;
			options.onFailure?.(error);
		}
		throw error;
	};

	const assertUsable = (): void => {
		if (disposed)
			throw rendererError(
				WEB_RENDERER_ERROR_CODE.disposed,
				"renderer is disposed",
			);
		if (failure !== null)
			throw rendererError(
				WEB_RENDERER_ERROR_CODE.failed,
				`renderer failed earlier: ${failure.message}`,
			);
	};

	const applyPatch = (patch: RuntimePatch): void => {
		switch (patch.op) {
			case "create": {
				const node =
					patch.kind === "#text"
						? document.createTextNode("")
						: createElementFor(document, patch.kind);
				if (node instanceof HTMLElement) node.dataset.rcNode = String(patch.id);
				const record = registry.create(patch.id, patch.kind, node);
				if (patch.kind === "audio") attachAudio(record);
				created.push(record);
				return;
			}
			case "remove": {
				const record = registry.get(patch.id);
				const parent = record.parent;
				if (parent !== null) {
					const at = parent.children.indexOf(record);
					parent.children.splice(at, 1);
					record.parent = null;
				}
				record.node.parentNode?.removeChild(record.node);
				/**
				 * Remove from the list first. release disposes the subtree's controllers, and that disposal
				 * emits onPendingChange(false), so the waiting set cleans itself up.
				 */
				forgetNode(record);
				registry.release(record);
				return;
			}
			case "insert": {
				const parent = registry.get(patch.parent);
				const child = registry.get(patch.child);
				if (child.parent !== null)
					throw rendererError(
						WEB_RENDERER_ERROR_CODE.topology,
						`host node ${patch.child} is already inserted`,
					);
				if (patch.index > parent.children.length)
					throw rendererError(
						WEB_RENDERER_ERROR_CODE.topology,
						`insert index ${patch.index} is past the end of ${patch.parent}`,
					);
				const before = parent.children[patch.index]?.node ?? null;
				parent.children.splice(patch.index, 0, child);
				child.parent = parent;
				parent.node.insertBefore(child.node, before);
				return;
			}
			case "move": {
				const parent = registry.get(patch.parent);
				const child = registry.get(patch.child);
				if (child.parent !== parent)
					throw rendererError(
						WEB_RENDERER_ERROR_CODE.topology,
						`host node ${patch.child} is not a child of ${patch.parent}`,
					);
				const at = parent.children.indexOf(child);
				parent.children.splice(at, 1);
				if (patch.index > parent.children.length)
					throw rendererError(
						WEB_RENDERER_ERROR_CODE.topology,
						`move index ${patch.index} is past the end of ${patch.parent}`,
					);
				const before = parent.children[patch.index]?.node ?? null;
				parent.children.splice(patch.index, 0, child);
				/**
				 * Move the same DOM node. Do not delete and recreate it, so focus, scroll and identity survive.
				 */
				moveNode(parent.node as HTMLElement, child.node, before);
				return;
			}
			case "set-prop":
				setProp(registry.get(patch.id), patch.name, patch.value, context);
				return;
			case "remove-prop":
				removeProp(registry.get(patch.id), patch.name, context);
				return;
			case "set-text": {
				const record = registry.get(patch.id);
				if (record.kind !== "#text")
					throw rendererError(
						WEB_RENDERER_ERROR_CODE.topology,
						`set-text on a ${record.kind} node ${patch.id}`,
					);
				(record.node as Text).data = patch.value;
				return;
			}
		}
	};

	return {
		get revision() {
			return revision;
		},
		get size() {
			return registry.size;
		},
		get failed() {
			return failure !== null;
		},
		get audioActivationRequired() {
			return activationRequired;
		},
		activateAudio() {
			if (disposed) return;
			/**
			 * Try all of them synchronously. Browsers allow playback only inside the call stack created by
			 * the user gesture. If this loop ran asynchronously, only the first sound would pass and the
			 * rest would go back to waiting.
			 */
			for (const record of audioNodes) record.audio?.activate();
		},
		apply(batch) {
			assertUsable();
			if (batch.revision !== revision + 1)
				fail(
					rendererError(
						WEB_RENDERER_ERROR_CODE.revisionMismatch,
						`patch batch revision ${batch.revision} does not follow ${revision}`,
					),
				);
			try {
				for (const patch of batch.patches) applyPatch(patch);
				armCreated();
			} catch (error) {
				created.length = 0;
				fail(
					error instanceof WebRuntimeRendererError
						? error
						: rendererError(
								WEB_RENDERER_ERROR_CODE.topology,
								error instanceof Error ? error.message : String(error),
							),
				);
			}
			revision = batch.revision;
		},
		applyCommands(batch) {
			if (disposed || failure !== null) return;
			if (batch.revision !== revision) return;
			try {
				applyCommandBatch(registry, batch);
			} catch (error) {
				/**
				 * A contract error fails the renderer but is not rethrown. Commands are a channel with no
				 * reply, so there is nowhere to return the error.
				 *
				 * Rethrowing into the message loop would let one harmless mistake drop every later message on
				 * that worker. onFailure already reports the failure.
				 */
				try {
					fail(
						error instanceof WebRuntimeRendererError
							? error
							: rendererError(
									WEB_RENDERER_ERROR_CODE.contract,
									error instanceof Error ? error.message : String(error),
								),
					);
				} catch {
					/* fail() always throws; that fact is the whole reason for this catch. */
				}
			}
		},
		reset() {
			if (disposed) return;
			/** The registry disposes the controllers, and that disposal empties the waiting set. */
			registry.clear();
			clearAudio();
			while (root.firstChild) root.removeChild(root.firstChild);
			registry = new NodeRegistry(ROOT_HOST_NODE_ID, root);
			revision = 0;
			failure = null;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			uninstall();
			document.removeEventListener("visibilitychange", handleVisibility);
			/** If a disposed session keeps the media query, its listener lives forever. */
			reduceQuery?.removeEventListener("change", handleReduceChange);
			/**
			 * Clearing the registry is what silences the sounds. A disposed session's sound still playing
			 * over the next session's screen is not something this one line expresses.
			 */
			registry.clear();
			clearAudio();
			while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
		},
		node(id) {
			if (id === ROOT_HOST_NODE_ID) return root;
			return registry.has(id) ? registry.get(id).node : null;
		},
		ids() {
			return registry.ids();
		},
	};
}

export type { NodeRecord };
