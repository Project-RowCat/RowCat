import { ROOT_HOST_NODE_ID } from "@rowcat/runtime-host/patches";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import type { NativeRuntimeControlDeck } from "./control-deck.ts";
import type { NativeRuntimeEventDispatcher } from "./events.ts";
import {
	HostNode,
	RuntimeSurfaceProvider,
	renderHostChildren,
} from "./host-node.tsx";
import type { NativeRuntimeAssetResolver } from "./image.tsx";
import type { NativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * Runtime surface: materializes a tree that is already decided.
 * - Pipeline: QuickJS reconciler → RuntimePatchBatch → NativeRuntimeTreeStore → this component →
 *   RN primitives.
 * - Nothing is decided here. Node identity, child order and handler numbers are fixed inside the
 *   VM and written to the store. React is only the platform device that draws them.
 * - Host id 0 has no component. Top-level nodes sit directly under the View this component
 *   provides. That View belongs to the surface, not the creator; the creator's Screen goes beneath
 *   it.
 */

export interface NativeRuntimeSurfaceProps {
	store: NativeRuntimeTreeStore;
	/**
	 * Maps a press to a handler number. Getting that call into the VM is the caller's job (the bridge
	 * and session).
	 */
	dispatchEvent: NativeRuntimeEventDispatcher;
	resolveAsset: NativeRuntimeAssetResolver;
	/**
	 * Control deck: makes scroll and focus commands reach the real views. Without it those commands do
	 * nothing, silently. That is not a failure.
	 *
	 * Subscribing to the deck is this slice's ordering guarantee. When a command arrives, the deck's
	 * version rises, this component re-renders, and the effect below runs after React has materialized
	 * the tree and attached refs. So it measures the content that just grew.
	 */
	controls?: NativeRuntimeControlDeck | null;
	style?: StyleProp<ViewStyle>;
}

export function NativeRuntimeSurface({
	store,
	dispatchEvent,
	resolveAsset,
	controls = null,
	style,
}: NativeRuntimeSurfaceProps) {
	const context = useMemo(
		() => ({ store, dispatch: dispatchEvent, resolveAsset, controls }),
		[store, dispatchEvent, resolveAsset, controls],
	);
	useSyncExternalStore(
		store.subscribe,
		() => store.nodeVersion(ROOT_HOST_NODE_ID),
		() => store.nodeVersion(ROOT_HOST_NODE_ID),
	);
	/**
	 * The deck's version. It rises when a command arrives. This subscription is what re-runs the
	 * effect below.
	 */
	useSyncExternalStore(
		controls === null ? EMPTY_SUBSCRIBE : controls.subscribe,
		controls === null ? ZERO : controls.getVersion,
		controls === null ? ZERO : controls.getVersion,
	);
	/**
	 * Runs after every commit (no dependency array). By then React has rendered new children and
	 * attached refs, so scrollToEnd measures the content after it grew.
	 */
	useEffect(() => {
		controls?.flush();
	});
	const top = store.children(ROOT_HOST_NODE_ID);
	return (
		<RuntimeSurfaceProvider value={context}>
			<View style={style}>{renderHostChildren(top, false)}</View>
		</RuntimeSurfaceProvider>
	);
}

export { HostNode };

/**
 * Constant for the no-deck case. A new function per render would make useSyncExternalStore
 * resubscribe every time.
 */
const EMPTY_SUBSCRIBE = (): (() => void) => () => {};
const ZERO = (): number => 0;
