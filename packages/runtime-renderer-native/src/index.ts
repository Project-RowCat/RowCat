/**
 * @rowcat/runtime-renderer-native: a platform adapter that draws patch batches as React Native
 * primitives.
 *
 * The pipeline is runtime-host session -> RuntimePatchBatch -> NativeRuntimeTreeStore ->
 * NativeRuntimeSurface, with presses turning into handler numbers that are dispatched back.
 *
 * Shared with the web renderer: the input (patch protocol), strict revisions, atomic commit, node
 * identity, handler numbers, the style-axis vocabulary, gap precedence, and the fact that assets
 * are not addresses.
 *
 * Different: the apply target (shadow DOM versus a host tree store plus React), where text nodes
 * sit (an RN constraint), how `lines` is expressed (CSS idiom versus numberOfLines), and the tier
 * visuals.
 *
 * The reconciler is still one. This package does not turn batches into React state to rebuild an
 * element tree, because that would make React decide again what Phase 4B already fixed (node
 * identity, key moves, handler identity, atomic commit). React here only materializes a host tree
 * that this runtime has already decided.
 *
 * Not depended on: apps/mobile, @rowcat/authoring, the compiler, ui-native, Dexie/SQLite, the API
 * client, the router, conversation, or the web renderer. Only two contract shapes come in: the
 * patch vocabulary (@rowcat/runtime-host/patches) and color judgment (@rowcat/runtime/color).
 *
 * Creator JavaScript runs inside QuickJS/WASM. This package receives JSON batches and emits one
 * integer, a handler number. There is no eval, no new Function, and no execution of creator code
 * here.
 */

export {
	createNativeAudioController,
	type NativeAudioController,
	type NativeRuntimeAudioPlayer,
	type NativeRuntimeAudioPort,
} from "./audio.ts";
export {
	createNativeAudioDeck,
	type NativeAudioDeck,
	type NativeAudioDeckOptions,
	type NativeRuntimeAudioResolver,
} from "./audio-deck.ts";
export {
	createNativeRuntimeControlDeck,
	type NativeControlHandle,
	type NativeRuntimeControlDeck,
	type NativeRuntimeControlDeckOptions,
	type NativeScrollHandle,
	type NativeTextEntryHandle,
} from "./control-deck.ts";
export {
	NATIVE_RENDERER_ERROR_CODE,
	type NativeRendererErrorCode,
	NativeRuntimeRendererError,
} from "./errors.ts";
export {
	type NativeRuntimeEventDispatcher,
	type NativeRuntimeEventPayload,
	type NativeRuntimePressDispatcher,
	type NativeTextEntryBinding,
	pressHandlerOf,
	textEntryBindingOf,
} from "./events.ts";
export type { NativeRuntimeAssetResolver } from "./image.tsx";
export {
	axisTarget,
	motionTargetOf,
	type NativeMotionPlanInput,
	type NativeMotionStep,
	planNativeMotion,
	transitionOf,
} from "./motion.ts";
export { type NativeMotionStyle, useNodeMotion } from "./motion.tsx";
export type {
	NativeRuntimeFit,
	NativeRuntimeTone,
	ResolvedNodeProps,
} from "./props.ts";
export { useReducedMotion } from "./reduced-motion.ts";
export {
	NativeRuntimeSurface,
	type NativeRuntimeSurfaceProps,
} from "./renderer.tsx";
export type {
	NativeBoxStyle,
	NativeProgressStyle,
	NativeTextStyle,
} from "./styles.ts";
export {
	createNativeRuntimeTreeStore,
	type NativeHostNode,
	type NativeRuntimeTreeStore,
} from "./tree-store.ts";
