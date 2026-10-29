import { RUNTIME_MOTION_ABSENT } from "@rowcat/runtime/transition";
import {
	createContext,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useSyncExternalStore,
} from "react";
import {
	Animated,
	TextInput as NativeTextInput,
	Pressable,
	Text,
	View,
} from "react-native";
import type { NativeRuntimeControlDeck } from "./control-deck.ts";
import { controlHandleOf } from "./control-handle.ts";
import {
	type NativeRuntimeEventDispatcher,
	pressHandlerOf,
	textEntryBindingOf,
} from "./events.ts";
import { type NativeRuntimeAssetResolver, RuntimeImage } from "./image.tsx";
import { useNodeMotion } from "./motion.tsx";
import { RuntimeProgress } from "./progress.tsx";
import { RUNTIME_TONE_COLOR, runtimeStyles } from "./theme.ts";
import type { NativeHostNode, NativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * One host node maps to one React Native component. Identity is the host node id.
 *
 * key is that id, which is not reused within a session (tree-store.ts). When the creator reorders a
 * list by key, the reconciler moves the same host id, React reads the same key as moved, and the
 * same native component moves, so scroll position and focus survive. Using a positional index as
 * the key would lose that.
 *
 * Each node subscribes on its own. A commit notifies subscribers once; re-rendering the whole tree
 * at that point would walk about 5,000 nodes for one character change. Each node reads its own
 * version as a snapshot, and React bails out of the unchanged ones.
 *
 * Creator props never become RN props. There is no spread in this file. Every drawn value is a
 * ResolvedNodeProps field, and those fields are limited to the contract (props.ts).
 *
 * The component kind does not change with or without transitions. Boxes, scroll views and text
 * inputs are always Animated.*. Swapping them conditionally would remount the element whenever a
 * creator adds or removes a transition, and the focus, scroll position and audio playback would be
 * lost without an error. Animated.View renders the same as View when no transition runs, so always
 * using it costs nothing.
 *
 * The deck keeps working because Animated.createAnimatedComponent forwards the ref to the wrapped
 * component unchanged (RN's useMergeRefs). So scrollTo and focus are unaffected by this design.
 */

/**
 * Animated components are created once, at module level. Created inside render, each render would
 * yield a new component type. React cannot keep an element of a different type in the same slot, so
 * every render would remount.
 */
const AnimatedScrollView = Animated.ScrollView;
const AnimatedTextInput = Animated.createAnimatedComponent(NativeTextInput);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface RuntimeSurfaceContext {
	store: NativeRuntimeTreeStore;
	dispatch: NativeRuntimeEventDispatcher;
	resolveAsset: NativeRuntimeAssetResolver;
	/**
	 * The control deck. Without it the surface receives no scroll or focus commands. That is silence,
	 * not failure.
	 *
	 * This is the same judgment as a deployment without an audio port. Headless consumers and tests
	 * must be able to build the surface without a deck, and the creator's session then runs normally.
	 */
	controls: NativeRuntimeControlDeck | null;
}

const SurfaceContext = createContext<RuntimeSurfaceContext | null>(null);

export const RuntimeSurfaceProvider = SurfaceContext.Provider;

function useSurface(): RuntimeSurfaceContext {
	const context = useContext(SurfaceContext);
	if (context === null)
		throw new Error("runtime host node rendered outside a runtime surface");
	return context;
}

/** Subscribes to the node and returns its current value; null once the node has been removed. */
function useNode(id: number): NativeHostNode | null {
	const { store } = useSurface();
	useSyncExternalStore(
		store.subscribe,
		() => store.nodeVersion(id),
		() => store.nodeVersion(id),
	);
	return store.node(id);
}

/**
 * Children. The parent's kind decides how bare text children are drawn.
 *
 * React Native cannot draw a bare string under View (it throws). So a #text node is drawn as a
 * plain string under Text, and anywhere else as a renderer-owned Text leaf. The patch protocol did
 * not change for this. It is a platform constraint, and lifting it into the protocol would add an
 * operation the web renderer never uses.
 */
function children(
	ids: readonly number[],
	inText: boolean,
	inRow = false,
): ReactNode {
	return ids.map((id) => (
		<HostNode key={id} id={id} inText={inText} inRow={inRow} />
	));
}

export const HostNode = memo(function HostNode({
	id,
	inText,
	inRow,
}: {
	id: number;
	inText: boolean;
	/**
	 * Whether the parent is a Row. This decides whether children can shrink (runtimeStyles.rowChild).
	 *
	 * Same design as inText: the drawing depends on the parent's kind. Lifting that into the patch
	 * protocol would add a value the web renderer does not use.
	 */
	inRow: boolean;
}): ReactNode {
	const surface = useSurface();
	const node = useNode(id);
	/**
	 * The hand that gives the native handle to the deck. Its identity is stable because it is wrapped
	 * in useCallback. Written inline, React would detach (null) and reattach the handle on every
	 * render, and a command arriving between those frames would find no target.
	 */
	const attachControl = useCallback(
		(instance: unknown) => {
			surface.controls?.attach(id, controlHandleOf(instance));
		},
		[surface.controls, id],
	);
	/**
	 * The animation layer for this node. It is null when there is no transition, and the drawing is
	 * then the same as before.
	 *
	 * A default is passed when node is null, rather than returning early. Hooks cannot be called
	 * conditionally, and an early return for a removed node would change the hook count on the next
	 * render.
	 */
	const motion = useNodeMotion(
		node?.props.motion ?? RUNTIME_MOTION_ABSENT,
		node?.props.transition ?? null,
	);
	if (node === null) return null;
	const { props } = node;
	/**
	 * Only children of a row shrink. Components that have their own size (images, progress bars,
	 * buttons) are excluded (theme.ts).
	 */
	const shrink = inRow ? runtimeStyles.rowChild : null;

	switch (node.kind) {
		case "#text":
			return inText ? node.text : <Text style={shrink}>{node.text}</Text>;
		case "screen":
			return (
				<View
					style={[
						shrink,
						runtimeStyles.screen,
						props.background === null
							? null
							: { backgroundColor: props.background },
					]}
				>
					{children(node.children, false)}
				</View>
			);
		case "view":
		case "stack":
			return (
				<Animated.View
					style={[shrink, runtimeStyles.box, props.boxStyle, motion]}
				>
					{children(node.children, false)}
				</Animated.View>
			);
		case "row":
			return (
				<Animated.View
					style={[shrink, runtimeStyles.row, props.boxStyle, motion]}
				>
					{children(node.children, false, true)}
				</Animated.View>
			);
		case "scroll":
			return (
				<AnimatedScrollView
					ref={attachControl}
					horizontal={props.horizontal}
					style={[shrink, props.boxStyle, motion]}
					contentContainerStyle={
						props.horizontal
							? runtimeStyles.scrollContentHorizontal
							: runtimeStyles.scrollContent
					}
				>
					{children(node.children, false)}
				</AnimatedScrollView>
			);
		case "text":
			return (
				<Text
					style={[shrink, props.textStyle]}
					numberOfLines={props.lines ?? undefined}
				>
					{children(node.children, true)}
				</Text>
			);
		case "image":
			return (
				<RuntimeImage
					asset={props.asset}
					alt={props.alt}
					fit={props.fit}
					style={props.boxStyle}
					motion={motion}
					resolve={surface.resolveAsset}
				/>
			);
		case "button": {
			const tone = RUNTIME_TONE_COLOR[props.tone];
			const handler = pressHandlerOf(node);
			return (
				<Pressable
					accessibilityRole="button"
					accessibilityState={{ disabled: props.disabled }}
					disabled={props.disabled}
					onPress={
						handler === null ? undefined : () => surface.dispatch(handler)
					}
					/**
					 * No shrink here, matching the web exception (.rc-row > .rc-button in theme.ts).
					 *
					 * A button beside a grow:1 input that is squeezed narrower than its label would split the
					 * label, and the creator has no way to prevent it: ButtonProps has no style slot in which to
					 * set shrink: 0. Pressable has that slot and still shrinks.
					 */
					style={[
						runtimeStyles.button,
						{ backgroundColor: tone.background, borderColor: tone.border },
						props.disabled ? runtimeStyles.buttonDisabled : null,
					]}
				>
					<Text style={[runtimeStyles.buttonLabel, { color: tone.label }]}>
						{children(node.children, true)}
					</Text>
				</Pressable>
			);
		}
		case "pressable": {
			const handler = pressHandlerOf(node);
			return (
				<AnimatedPressable
					accessibilityRole="button"
					accessibilityState={{ disabled: props.disabled }}
					disabled={props.disabled}
					onPress={
						handler === null ? undefined : () => surface.dispatch(handler)
					}
					style={[
						shrink,
						runtimeStyles.box,
						props.boxStyle,
						props.disabled ? runtimeStyles.buttonDisabled : null,
						motion,
					]}
				>
					{children(node.children, false)}
				</AnimatedPressable>
			);
		}
		case "progress":
			return (
				<RuntimeProgress value={props.progress} style={props.progressStyle} />
			);
		/**
		 * A real TextInput, not a plain view imitating one. The platform supplies IME composition, caret
		 * and selection, keyboard type, and the accessibility editable semantics.
		 *
		 * Korean composition needs nothing special on this platform. onChangeText delivers the current
		 * text even during composition, and reassigning a controlled value does not break composition in
		 * RN. (The web <input> is different and needs composition tracking there.) Submit is
		 * onSubmitEditing, which does not fire during composition.
		 */
		case "text-input":
		case "text-area": {
			/**
			 * The values to pass are decided by one function (events.ts). They are not recomputed here, so
			 * that the decision (inactive; no submit for multi-line) can be checked as a value. This file
			 * cannot be built without React Native.
			 */
			const entry = textEntryBindingOf(node);
			const { changeHandler, submitHandler } = entry;
			return (
				<AnimatedTextInput
					ref={attachControl}
					value={entry.value}
					placeholder={entry.placeholder}
					editable={entry.editable}
					multiline={entry.multiline}
					/**
					 * Only single-line input has a submit action. In multi-line input, Enter inserts a newline,
					 * and blur on submit is disabled.
					 */
					blurOnSubmit={!entry.multiline}
					onChangeText={
						changeHandler === null
							? undefined
							: (value: string) => surface.dispatch(changeHandler, value)
					}
					onSubmitEditing={
						submitHandler === null
							? undefined
							: () => surface.dispatch(submitHandler)
					}
					style={[
						shrink,
						runtimeStyles.textEntry,
						entry.multiline ? runtimeStyles.textEntryMultiline : null,
						props.boxStyle,
						props.textStyle,
						props.disabled ? runtimeStyles.buttonDisabled : null,
						motion,
					]}
				/>
			);
		}
		/**
		 * Sound is not drawn. Its lifetime is held by the deck (audio-deck.ts); this layer belongs to the
		 * screen. Keeping it as a component would let the frequent parent re-renders and StrictMode
		 * double mounts recreate the player.
		 */
		case "audio":
			return null;
		case "root":
			/** The composition root is not a node. The surface draws its children directly. */
			return null;
	}
});

export { children as renderHostChildren };
