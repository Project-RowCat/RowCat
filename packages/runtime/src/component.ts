import type { AssetRef } from "./asset.ts";
import type { RuntimeColor } from "./color.ts";
import type {
	RuntimeScrollController,
	RuntimeTextEntryController,
} from "./controller.ts";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";
import { RUNTIME_HOST } from "./internal/symbols.ts";
import type { RuntimeChildren, RuntimeNode } from "./node.ts";
import type { RuntimeLength, RuntimeStyle, RuntimeTextStyle } from "./style.ts";
import type { RuntimeTransition } from "./transition.ts";

/**
 * Host primitives: what the runtime draws, not components the author assembles.
 *
 * - A plain function component cannot say what it should return. A host element tells the host
 *   what to create, and that translation (web div, RN View, future patch protocol) differs per
 *   renderer. If this package knew it, the package would already be a renderer.
 * - Primitives throw when called. The normal path never reaches the body: jsx() stores the value
 *   in element.type without calling it, and the reconciler branches on the symbol. Reaching the
 *   body means someone called e.g. Stack({}) directly, which must not pass silently.
 * - The type is callable anyway. TypeScript's JSX check only compares props when the tag type is
 *   callable, and a plain object would reject <Stack gap={12}>. Identity still rests on the symbol,
 *   not the function.
 */
export interface RuntimeHostComponent<TProps> {
	(props: TProps): RuntimeNode;
	readonly [RUNTIME_HOST]: RuntimeHostKind;
}

/**
 * The host vocabulary. These names are the VM ABI. This is a union rather than a Record because the
 * list later becomes protocol strings. Adding a value means changing both renderers together.
 */
export type RuntimeHostKind =
	| "screen"
	| "view"
	| "stack"
	| "row"
	| "scroll"
	| "text"
	| "image"
	| "button"
	| "pressable"
	| "progress"
	| "text-input"
	| "text-area"
	| "audio";

/**
 * The created function is anonymous on purpose. Its .name is empty or whatever the bundler assigns,
 * which enforces 'never judge by name': a reconciler that branched on names would never work.
 */
function host<TProps>(kind: RuntimeHostKind): RuntimeHostComponent<TProps> {
	const component = (): RuntimeNode => {
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hostComponentCalled,
			`A host component (${kind}) can't be called directly. Use it with JSX.`,
		);
	};
	Object.defineProperty(component, RUNTIME_HOST, {
		value: kind,
		enumerable: false,
		writable: false,
		configurable: false,
	});
	return Object.freeze(component) as unknown as RuntimeHostComponent<TProps>;
}

/** Whether a value is a host primitive. This is the reconciler's only decision point for this. */
export function isRuntimeHostComponent(
	value: unknown,
): value is RuntimeHostComponent<unknown> {
	return (
		typeof value === "function" &&
		typeof (value as { [RUNTIME_HOST]?: unknown })[RUNTIME_HOST] === "string"
	);
}

export function runtimeHostKindOf(value: unknown): RuntimeHostKind | null {
	return isRuntimeHostComponent(value)
		? (value as { [RUNTIME_HOST]: RuntimeHostKind })[RUNTIME_HOST]
		: null;
}

/**
 * The shared axis for props that control how a value changes. It applies only to primitives that
 * accept `style?: RuntimeStyle`, since only that style has axes that can move (opacity, translateX,
 * translateY, scale). Screen, Text, Button and Progress have no such axis, so they have no
 * transition. The transition prop is not hand-written on each prop type, because one copy would
 * eventually go missing, and the gap would show up only as 'does not animate on that one
 * primitive'.
 */
export interface RuntimeTransitionable {
	/**
	 * No transition means the value changes immediately. The first render never animates: having the
	 * prop does not make entry an animation, since entering and leaving are not part of this design
	 * yet. Motion happens only when the value of an already-rendered node changes.
	 */
	transition?: RuntimeTransition;
}

export interface ScreenProps extends RuntimeChildren {
	/** Background of the whole screen. It extends beyond the safe area. */
	background?: RuntimeColor;
}

export interface ViewProps extends RuntimeChildren, RuntimeTransitionable {
	style?: RuntimeStyle;
}

export interface StackProps extends RuntimeChildren, RuntimeTransitionable {
	gap?: number;
	style?: RuntimeStyle;
}

export interface RowProps extends RuntimeChildren, RuntimeTransitionable {
	gap?: number;
	style?: RuntimeStyle;
}

export interface ScrollViewProps
	extends RuntimeChildren,
		RuntimeTransitionable {
	style?: RuntimeStyle;
	horizontal?: boolean;
	/**
	 * Handle that moves this scroll. Must come from `useScrollController()`.
	 *
	 * Neither a DOM element nor an RN ref belongs here. The value is an opaque controller issued by
	 * the host, and its internal integer cannot be named by the author (see the control.ts header). A
	 * controller binds to one live node at a time. Passing the same controller to two nodes rejects
	 * that render with `runtime_host_control_already_bound`.
	 */
	controller?: RuntimeScrollController;
}

export interface TextProps extends RuntimeChildren {
	style?: RuntimeTextStyle;
}

export interface ImageProps extends RuntimeTransitionable {
	/**
	 * What to draw: an asset reference, not a plain string. Passing through `asset()` is the author's
	 * explicit declaration that the string is an image reference, and a deterministic check runs there
	 * (see asset.ts). Plain strings are still rejected even though remote URLs are now accepted: what
	 * widened is the input to `asset()`, not this prop's type. Which bytes a reference points to is
	 * answered by the trusted host. This package does no lookup, authorization, or caching.
	 */
	source: AssetRef;
	/** Screen-reader label. Omit it for decorative images. */
	alt?: string;
	style?: RuntimeStyle;
	fit?: "cover" | "contain" | "fill";
}

/**
 * The shared axis for pressable things. The contract is `onPress(): void`, not `onClick(event)`.
 * DOM event objects belong to the web (preventDefault, currentTarget, coordinates) and have no
 * native shape. Passing an event would also require it to cross the VM boundary, exposing the
 * host's DOM to author code.
 */
export interface RuntimePressable {
	onPress?: () => void | Promise<void>;
	disabled?: boolean;
}

export interface ButtonProps extends RuntimeChildren, RuntimePressable {
	/** Visual hierarchy. Adding a value means changing both renderers together. */
	tone?: "primary" | "secondary" | "ghost";
}

export interface PressableProps
	extends RuntimeChildren,
		RuntimePressable,
		RuntimeTransitionable {
	style?: RuntimeStyle;
}

/**
 * The shared axis for text entry. It is controlled input, and that is in the type: `value` is
 * required. There is no defaultValue and no uncontrolled input, because two owners would then hold
 * 'what is written': the author's state and the platform widget's internal value. The mismatch
 * appears only when saving.
 *
 * The callback receives a string, not an event. DOM Event and RN NativeSyntheticEvent would carry
 * selection, target nodes and native references across the boundary. The renderer creates the
 * string (the whole text after the change), the same rule as onPress taking no arguments.
 */
export interface RuntimeTextEntry extends RuntimeTransitionable {
	value: string;
	placeholder?: string;
	disabled?: boolean;
	/** Called after the user edits. It receives the whole text after the change, not a delta. */
	onChangeText?: (value: string) => void | Promise<void>;
	style?: RuntimeStyle;
	textStyle?: RuntimeTextStyle;
	/**
	 * Handle that moves focus for this input. Must come from `useTextEntryController()`. It is not a
	 * ref: no `current`, no selection, no native handle. It opens only `focus()` and `blur()`.
	 */
	controller?: RuntimeTextEntryController;
}

export interface TextInputProps extends RuntimeTextEntry {
	/**
	 * Confirmed in a single-line input (Enter on web, Done on native). It is not called during IME
	 * composition: Korean, Japanese and Chinese input use Enter to confirm characters before
	 * composition ends, and treating that as a submit would send the in-progress text. The platform
	 * adapter makes that judgment; this contract only states the result.
	 */
	onSubmit?: () => void | Promise<void>;
}

export interface TextAreaProps extends RuntimeTextEntry {}

export interface ProgressProps {
	/** 0 to 1. If absent, progress is unbounded (indeterminate, an endless animation). */
	value?: number;
	style?: { width?: RuntimeLength };
}

/**
 * Audio: sound that is played, not drawn.
 *
 * - Why a node and not a `useAudio()` handle: an imperative handle can keep playing after the
 *   component that made it is gone, and then nothing owns stopping the sound. A forgotten cleanup
 *   gives no error, only music that never stops. As a node the question disappears: it stops when
 *   it leaves the tree or the session ends, the same rule as the rest of the screen.
 * - `playing` means 'wants to play', not 'is playing'. Whether sound actually comes out is also
 *   up to the platform's media policy.
 * - No style and no layout. It takes no space, so toggling it conditionally does not shift
 *   layout.
 */
export interface AudioProps {
	/**
	 * Same shape as Image, but the accepted values are narrower: remote HTTPS addresses do not play
	 * here. `asset('https://...')` still builds, but the trusted host does not resolve it to sound, so
	 * no request is ever sent. Reason: an image is fetched once and drawn, and failures fold into a
	 * placeholder. Sound keeps flowing, so range requests, buffering, abort and resume all become a
	 * conversation with the remote host. A single IP-masking proxy would not fold that into one step,
	 * and opening that surface is not a decision of this slice.
	 */
	source: AssetRef;
	/**
	 * Whether sound is wanted, not whether it is playing now. Browsers block sound until the user has
	 * interacted with the page. That is normal platform policy, not an error, so `playing={true}` does
	 * not guarantee sound: the host remembers the wish and starts when it is allowed. Defaults to
	 * `false`.
	 */
	playing?: boolean;
	/**
	 * When the sound ends, it starts over from the beginning. Defaults to `false`; then the end is
	 * reported by `onEnded`.
	 */
	loop?: boolean;
	/**
	 * Between 0 and 1, finite. Defaults to 1. Out-of-range values are rejected, not silently clamped.
	 * Clamping `volume={5}` to 1 would make authors believe their value is used, and the
	 * misunderstanding would surface later in computed values. Rejecting there is more honest (the
	 * same decision as `asset()` not trimming whitespace).
	 */
	volume?: number;
	/** Mutes the sound. A separate axis from `volume`: it mutes while remembering the level. */
	muted?: boolean;
	/**
	 * Changing this value rewinds to the beginning. A name is needed because `playing` cannot express
	 * it: on a second press of a sound effect, `playing` is already true, the commit has no change,
	 * and nothing plays. It only rewinds; it does not change whether the sound plays. The value is a
	 * string or number because it crosses the wire, and object identity does not survive that
	 * boundary.
	 */
	restartKey?: string | number;
	/**
	 * Called when playback has finished. Not called while `loop` is set: calling it per cycle would
	 * turn 'ended' into 'went around once', and handling attached to repeating music would run every
	 * cycle. It does not change state: the host never sets `playing` to false on the author's behalf.
	 * To play again, change `restartKey`.
	 */
	onEnded?: () => void | Promise<void>;
	/**
	 * Accepts no children, enforced by the type. Sound is played, not contained, so there is no place
	 * to draw children. Drawing them elsewhere would split what the author wrote from the screen.
	 */
	children?: never;
}

export const Screen: RuntimeHostComponent<ScreenProps> =
	host<ScreenProps>("screen");

export const View: RuntimeHostComponent<ViewProps> = host<ViewProps>("view");

export const Stack: RuntimeHostComponent<StackProps> =
	host<StackProps>("stack");

export const Row: RuntimeHostComponent<RowProps> = host<RowProps>("row");

export const ScrollView: RuntimeHostComponent<ScrollViewProps> =
	host<ScrollViewProps>("scroll");

export const Text: RuntimeHostComponent<TextProps> = host<TextProps>("text");

export const Image: RuntimeHostComponent<ImageProps> =
	host<ImageProps>("image");

export const Button: RuntimeHostComponent<ButtonProps> =
	host<ButtonProps>("button");

export const Pressable: RuntimeHostComponent<PressableProps> =
	host<PressableProps>("pressable");

export const Progress: RuntimeHostComponent<ProgressProps> =
	host<ProgressProps>("progress");

/** Single-line text input. Confirmation (Enter or Done) is `onSubmit`. */
export const TextInput: RuntimeHostComponent<TextInputProps> =
	host<TextInputProps>("text-input");

/** Multi-line text input. No formatting or rich text: it carries plain strings. */
export const TextArea: RuntimeHostComponent<TextAreaProps> =
	host<TextAreaProps>("text-area");

/**
 * A sound. It takes no space: it is alive while it is in the tree, and stops when it is removed.
 */
export const Audio: RuntimeHostComponent<AudioProps> =
	host<AudioProps>("audio");
