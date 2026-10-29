import type { NativeRuntimeTreeStore } from "@rowcat/runtime-renderer-native/tree-store";

/**
 * Interaction benchmark: **runs the product path as-is.**
 *
 * ```text
 * session.dispatchEvent(handlerId)   ← the same function a screen press calls
 *   → bridge → WebView → QuickJS handler → state → reconcile → bundle → bridge
 *   → applied to the tree store              ← the next iteration is released here
 * ```
 *
 * ## The finger is missing, and that is stated
 *
 * This loop does not measure the stretch from touch to `Pressable`'s `onPress` (gesture
 * recognition, RN event delivery). Everything after that is the same path, and **a press made by
 * hand goes through the same recorder**, so reading both numbers together is what makes this
 * useful.
 *
 * ## Re-read the handler id **every iteration**
 *
 * Handler ids change on every commit. A creator's `onPress={() => setCount(…)}` is a new function
 * per render, and the reconciler gives the changed function a **new id and releases the old one**
 * (`docs/creator-runtime/patch-protocol.md`). If the loop held the id it read first, from the
 * second press on it would point at a released id, and the VM would silently discard it as `{
 * handled: false, reason: "stale" }`. No commit would arrive, so it would time out. This defect
 * first surfaced on a real device.
 *
 * Screen presses do not have this problem, because the surface reads the store's current id on
 * every render. This loop must read the same value in the same place, or it is not measuring the
 * **same path**.
 *
 * ## Wait for one commit, then **yield the turn**
 *
 * The next iteration starts after the previous bundle has been **applied** to the store. Firing
 * without waiting would measure queue length rather than latency.
 *
 * It also does not emit the next press **from within** the application callback. That code runs
 * inside the stack that handles the message from the bridge, and re-entering the bridge from there
 * makes iOS's WebView **silently drop** the injection. This defect first surfaced on a real device:
 * only the first iteration committed, and the rest timed out. More importantly, **a press by a
 * person always arrives in a new turn**; without yielding the turn, this loop would stop measuring
 * the product path.
 */

export interface InteractionBenchmarkTarget {
	readonly store: NativeRuntimeTreeStore;
	dispatchEvent(handlerId: number): void;
}

export interface InteractionBenchmarkOptions {
	target: InteractionBenchmarkTarget;
	/** Asked again every iteration, since ids change per commit. `null` means there is nothing to press. */
	handlerFor: (target: InteractionBenchmarkTarget) => number | null;
	/** Total iterations, including warm-up. The summary discards warm-up (`metrics.ts`). */
	iterations: number;
	/** Stops if one interaction exceeds this time, so a hung bridge cannot hold the screen forever. */
	timeoutMs: number;
	/** Delay wiring. The screen passes `setTimeout`; tests pass their own. */
	delay: (ms: number) => Promise<void>;
	/**
	 * Returns control to the event loop before the next press, so the loop does not re-enter the
	 * bridge from the stack that received the message. A microtask is not enough: it is still the same
	 * turn.
	 */
	yieldTurn: () => Promise<void>;
	onProgress?: (completed: number) => void;
}

export type InteractionBenchmarkOutcome =
	| { ok: true; completed: number }
	| {
			ok: false;
			completed: number;
			reason: "timeout" | "failed" | "no-handler";
	  };

export async function runInteractionBenchmark(
	options: InteractionBenchmarkOptions,
): Promise<InteractionBenchmarkOutcome> {
	const { target, handlerFor, iterations, timeoutMs, delay, yieldTurn } =
		options;
	for (let completed = 0; completed < iterations; completed += 1) {
		await yieldTurn();
		if (target.store.failed || target.store.disposed)
			return { ok: false, completed, reason: "failed" };
		const handlerId = handlerFor(target);
		if (handlerId === null)
			return { ok: false, completed, reason: "no-handler" };
		const before = target.store.revision;
		const committed = new Promise<boolean>((resolve) => {
			const unsubscribe = target.store.subscribe(() => {
				if (target.store.revision === before) return;
				unsubscribe();
				resolve(true);
			});
			void delay(timeoutMs).then(() => {
				unsubscribe();
				resolve(false);
			});
		});
		target.dispatchEvent(handlerId);
		if (!(await committed)) return { ok: false, completed, reason: "timeout" };
		options.onProgress?.(completed + 1);
	}
	return { ok: true, completed: iterations };
}

/**
 * Handler id of the first pressable node in the current tree.
 *
 * The screen does not choose what the benchmark presses. Fixtures change and the id changes with
 * them; a hard-coded id would make a non-pressing benchmark silently report 0.
 */
export function firstPressHandler(
	store: NativeRuntimeTreeStore,
): number | null {
	for (const id of store.ids()) {
		const node = store.node(id);
		if (node === null) continue;
		if (node.props.disabled) continue;
		if (node.props.onPress !== null) return node.props.onPress;
	}
	return null;
}
