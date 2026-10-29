import type {
	RuntimeMotionTarget,
	RuntimeResolvedTransition,
} from "@rowcat/runtime/transition";
import { RUNTIME_MOTION_ABSENT } from "@rowcat/runtime/transition";
import {
	assetPathOf,
	controlIdOf,
	handlerIdOf,
	type RuntimeHostNodeKind,
	type RuntimeHostValue,
} from "@rowcat/runtime-host/patches";
import { NATIVE_RENDERER_ERROR_CODE, rendererError } from "./errors.ts";
import { motionTargetOf, transitionOf } from "./motion.ts";
import {
	boxStyleOf,
	colorValue,
	type NativeBoxStyle,
	type NativeProgressStyle,
	type NativeTextStyle,
	progressStyleOf,
	textStyleOf,
} from "./styles.ts";

/**
 * Prop to render-ready value: one table per kind, one hand per prop.
 *
 * This file has no spread (`{...props}`) and no `element[name] = value`. Spreading the creator's
 * props onto RN components would give runtime props authority over all RN props: onLayout,
 * renderToHardwareTextureAndroid and source would open by name, and only the string check, not the
 * type system, would guard that. Here a kind and a name must appear in the table to have a handler;
 * otherwise it is a contract error.
 *
 * Judgment happens at apply time, not at render. This function runs where a patch is applied. A
 * single out-of-contract prop fails that batch, and the tree stays at the previous revision.
 * Throwing during render would surface as a React error with the tree already committed, leaving a
 * broken screen.
 *
 * Assets are not addresses. The logical path is taken from { "$asset": path }, and turning it into
 * something drawable is the host asset resolver's job. Even if the path looks like https://..., it
 * is an out-of-contract value, not an address.
 */

export type NativeRuntimeTone = "primary" | "secondary" | "ghost";
export type NativeRuntimeFit = "cover" | "contain" | "fill";

/** Render-ready props for one node. Slots that the node's kind does not use hold defaults. */
export interface ResolvedNodeProps {
	readonly boxStyle: NativeBoxStyle | null;
	readonly textStyle: NativeTextStyle | null;
	readonly progressStyle: NativeProgressStyle | null;
	/** RuntimeTextStyle.lines. In RN it is a prop, not a style. */
	readonly lines: number | null;
	/** Handler number. The function itself stays inside the VM. */
	readonly onPress: number | null;
	readonly disabled: boolean;
	readonly tone: NativeRuntimeTone;
	readonly horizontal: boolean;
	readonly background: string | null;
	/** Logical asset path for Image. It is not yet resolved; treat it as an unresolved value. */
	readonly asset: string | null;
	readonly alt: string;
	readonly fit: NativeRuntimeFit;
	/** Progress value. null means indeterminate (unknown extent). */
	readonly progress: number | null;
	/** Controlled value of text entry. It is always an empty string for other kinds. */
	readonly text: string;
	readonly placeholder: string;
	/**
	 * Handler number emitted when the text changes. The string itself is built by the renderer and
	 * carried across the bridge.
	 */
	readonly onChangeText: number | null;
	/**
	 * Submit handler for single-line input. text-area has none, since a newline occupies that role.
	 */
	readonly onSubmit: number | null;
	/**
	 * Logical asset path for Audio, unresolved. It is kept separate from asset because the kind
	 * differs. Sharing one slot would let images and sounds carry the same value, and then the answer
	 * to how this string is resolved would depend on the caller.
	 */
	readonly audioAsset: string | null;
	/** Whether sound is wanted, not whether it is currently playing. */
	readonly playing: boolean;
	readonly loop: boolean;
	readonly volume: number;
	readonly muted: boolean;
	/** When this value changes, playback rewinds to the start. */
	readonly restartKey: string | number | null;
	readonly onEnded: number | null;
	/**
	 * The control number attached to this node; null if none is attached.
	 *
	 * Only scroll and text entry use this slot. The deck builds a control-to-node table from this
	 * value (control-deck.ts). Incoming commands carry only a control number, not a host node id, and
	 * they go through that table.
	 */
	readonly control: number | null;
	/**
	 * The creator's transition policy. Without it, values change immediately.
	 *
	 * This slot is separate from boxStyle by design (section 17). The policy and the desired value are
	 * different axes. Folding them into one slot would make a policy-only commit look like it
	 * re-applied the value.
	 */
	readonly transition: RuntimeResolvedTransition | null;
	/**
	 * The current targets of the moving axes: a copy extracted from boxStyle.
	 *
	 * The static style holds the same values, and a node with no transition is drawn with them. A node
	 * with a transition has an Animated.Value layer on top that wins (motion.tsx).
	 */
	readonly motion: RuntimeMotionTarget;
}

const EMPTY: ResolvedNodeProps = Object.freeze({
	boxStyle: null,
	textStyle: null,
	progressStyle: null,
	lines: null,
	onPress: null,
	disabled: false,
	tone: "primary",
	horizontal: false,
	background: null,
	asset: null,
	alt: "",
	fit: "cover",
	progress: null,
	text: "",
	placeholder: "",
	onChangeText: null,
	onSubmit: null,
	audioAsset: null,
	playing: false,
	loop: false,
	volume: 1,
	muted: false,
	restartKey: null,
	onEnded: null,
	control: null,
	transition: null,
	motion: RUNTIME_MOTION_ABSENT,
});

const contract = (message: string) =>
	rendererError(NATIVE_RENDERER_ERROR_CODE.contract, message);

/**
 * transition is accepted only where style is a RuntimeStyle (RuntimeTransitionable). text, button,
 * progress and screen do not accept it, so a batch that sets it on these four is rejected as an
 * unknown prop, matching the contract. The web renderer's table must have the same list. If they
 * diverge, the same creator work fails on only one platform.
 */
const PROPS: Readonly<Record<RuntimeHostNodeKind, readonly string[]>> = {
	screen: ["background"],
	view: ["style", "transition"],
	stack: ["gap", "style", "transition"],
	row: ["gap", "style", "transition"],
	scroll: ["horizontal", "style", "controller", "transition"],
	text: ["style"],
	image: ["source", "alt", "style", "fit", "transition"],
	button: ["onPress", "disabled", "tone"],
	pressable: ["onPress", "disabled", "style", "transition"],
	progress: ["value", "style"],
	"text-input": [
		"value",
		"placeholder",
		"disabled",
		"onChangeText",
		"onSubmit",
		"style",
		"textStyle",
		"controller",
		"transition",
	],
	"text-area": [
		"value",
		"placeholder",
		"disabled",
		"onChangeText",
		"style",
		"textStyle",
		"controller",
		"transition",
	],
	audio: [
		"source",
		"playing",
		"loop",
		"volume",
		"muted",
		"restartKey",
		"onEnded",
	],
	/** Text nodes take no props. The host validator already rejects them. */
	"#text": [],
};

const TONES: readonly NativeRuntimeTone[] = ["primary", "secondary", "ghost"];
const FITS: readonly NativeRuntimeFit[] = ["cover", "contain", "fill"];

const expectBoolean = (name: string, value: RuntimeHostValue): boolean => {
	if (typeof value !== "boolean") throw contract(`${name}: expected a boolean`);
	return value;
};

const expectString = (name: string, value: RuntimeHostValue): string => {
	if (typeof value !== "string") throw contract(`${name}: expected a string`);
	return value;
};

const expectNumber = (name: string, value: RuntimeHostValue): number => {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw contract(`${name}: expected a finite number`);
	return value;
};

function expectOneOf<T extends string>(
	name: string,
	value: RuntimeHostValue,
	allowed: readonly T[],
): T {
	if (
		typeof value === "string" &&
		(allowed as readonly string[]).includes(value)
	)
		return value as T;
	throw contract(`${name}: expected one of ${allowed.join(" · ")}`);
}

/**
 * `{ "$control": n }` to a number. A value that is present but not in that shape is a contract
 * error.
 *
 * It is not silently mapped to null, because that state would be invisible on screen. A scroll view
 * with no control attached would never receive commands, and the creator would have no place to
 * read why.
 */
function readControl(value: RuntimeHostValue | undefined): number | null {
	if (value === undefined) return null;
	const id = controlIdOf(value);
	if (id === null) throw contract("controller: expected a control reference");
	return id;
}

/** Whether this kind accepts a prop by that name. It is checked before set-prop is applied. */
export function assertKnownProp(kind: RuntimeHostNodeKind, name: string): void {
	const allowed = PROPS[kind];
	if (!allowed.includes(name)) throw contract(`${kind} has no prop "${name}"`);
}

/**
 * Converts all of a node's props into render-ready values. Recomputed in full on each prop change,
 * because the axes read each other: the gap prop and style.gap, and style and fit. Partial updates
 * per axis would let a remove-prop on one axis run another axis's calculation on stale values.
 */
export function resolveProps(
	kind: RuntimeHostNodeKind,
	props: ReadonlyMap<string, RuntimeHostValue>,
): ResolvedNodeProps {
	if (props.size === 0) return EMPTY;
	for (const name of props.keys()) assertKnownProp(kind, name);

	const read = (name: string): RuntimeHostValue | undefined => props.get(name);
	const next: {
		-readonly [K in keyof ResolvedNodeProps]: ResolvedNodeProps[K];
	} = { ...EMPTY };

	const gap = read("gap");
	const gapOverride = gap === undefined ? null : expectNumber("gap", gap);
	const style = read("style");

	/**
	 * Transition and moving axes are read only for kinds that accept style: RuntimeStyle.
	 *
	 * They are not written out per kind, because one of the copies would eventually be left out. The
	 * missing spot would show as a box that silently does not move, with no error. For a kind absent
	 * from the table, assertKnownProp already rejects a transition.
	 */
	const readMotion = (): void => {
		next.motion = motionTargetOf(style === undefined ? null : style);
		const transition = read("transition");
		if (transition !== undefined) next.transition = transitionOf(transition);
	};

	switch (kind) {
		case "screen": {
			const background = read("background");
			if (background !== undefined)
				next.background = colorValue("background", background);
			break;
		}
		case "text": {
			const text = textStyleOf(style === undefined ? null : style);
			next.textStyle = text.style;
			next.lines = text.lines;
			break;
		}
		case "progress": {
			next.progressStyle = progressStyleOf(style === undefined ? null : style);
			const value = read("value");
			next.progress =
				value === undefined
					? null
					: Math.min(1, Math.max(0, expectNumber("value", value)));
			break;
		}
		case "button": {
			const onPress = read("onPress");
			if (onPress !== undefined) {
				const handler = handlerIdOf(onPress);
				if (handler === null)
					throw contract("onPress: expected a handler reference");
				next.onPress = handler;
			}
			const disabled = read("disabled");
			if (disabled !== undefined)
				next.disabled = expectBoolean("disabled", disabled);
			const tone = read("tone");
			if (tone !== undefined) next.tone = expectOneOf("tone", tone, TONES);
			break;
		}
		case "pressable": {
			next.boxStyle = boxStyleOf(
				style === undefined ? null : style,
				gapOverride,
			);
			readMotion();
			const onPress = read("onPress");
			if (onPress !== undefined) {
				const handler = handlerIdOf(onPress);
				if (handler === null)
					throw contract("onPress: expected a handler reference");
				next.onPress = handler;
			}
			const disabled = read("disabled");
			if (disabled !== undefined)
				next.disabled = expectBoolean("disabled", disabled);
			break;
		}
		case "image": {
			next.boxStyle = boxStyleOf(
				style === undefined ? null : style,
				gapOverride,
			);
			readMotion();
			const source = read("source");
			if (source !== undefined) {
				const path = assetPathOf(source);
				if (path === null)
					throw contract("source: expected an asset reference");
				next.asset = path;
			}
			const alt = read("alt");
			if (alt !== undefined) next.alt = expectString("alt", alt);
			const fit = read("fit");
			if (fit !== undefined) next.fit = expectOneOf("fit", fit, FITS);
			break;
		}
		case "text-input":
		case "text-area": {
			/**
			 * Only text entry takes two style axes together: the box (style) and the text (textStyle), since
			 * both are layered onto one component. The web renderer merges them at the same point, for the
			 * same reason.
			 */
			next.boxStyle = boxStyleOf(style === undefined ? null : style, null);
			readMotion();
			const entryText = textStyleOf(
				read("textStyle") === undefined
					? null
					: (read("textStyle") as RuntimeHostValue),
			);
			next.textStyle = entryText.style;
			const value = read("value");
			if (value !== undefined) next.text = expectString("value", value);
			const placeholder = read("placeholder");
			if (placeholder !== undefined)
				next.placeholder = expectString("placeholder", placeholder);
			const disabled = read("disabled");
			if (disabled !== undefined)
				next.disabled = expectBoolean("disabled", disabled);
			const onChangeText = read("onChangeText");
			if (onChangeText !== undefined) {
				const handler = handlerIdOf(onChangeText);
				if (handler === null)
					throw contract("onChangeText: expected a handler reference");
				next.onChangeText = handler;
			}
			const onSubmit = read("onSubmit");
			if (onSubmit !== undefined) {
				const handler = handlerIdOf(onSubmit);
				if (handler === null)
					throw contract("onSubmit: expected a handler reference");
				next.onSubmit = handler;
			}
			next.control = readControl(read("controller"));
			break;
		}
		case "scroll": {
			next.boxStyle = boxStyleOf(
				style === undefined ? null : style,
				gapOverride,
			);
			readMotion();
			const horizontal = read("horizontal");
			if (horizontal !== undefined)
				next.horizontal = expectBoolean("horizontal", horizontal);
			next.control = readControl(read("controller"));
			break;
		}
		case "view":
		case "stack":
		case "row":
			next.boxStyle = boxStyleOf(
				style === undefined ? null : style,
				gapOverride,
			);
			readMotion();
			break;
		case "audio": {
			const source = read("source");
			if (source !== undefined) {
				const path = assetPathOf(source);
				if (path === null)
					throw contract("source: expected an asset reference");
				next.audioAsset = path;
			}
			const playing = read("playing");
			if (playing !== undefined)
				next.playing = expectBoolean("playing", playing);
			const loopValue = read("loop");
			if (loopValue !== undefined) next.loop = expectBoolean("loop", loopValue);
			const volume = read("volume");
			if (volume !== undefined) {
				/**
				 * Does not clamp here. Out-of-range values are already rejected inside the VM
				 * (runtime_invalid_host_prop), and clamping again here would let each platform start clamping,
				 * so the same value would sound at a different level on each device. The range is still checked
				 * because of corrupted batches, where a contract error is the right response.
				 */
				const number = expectNumber("volume", volume);
				if (number < 0 || number > 1)
					throw contract("volume: expected a number between 0 and 1");
				next.volume = number;
			}
			const muted = read("muted");
			if (muted !== undefined) next.muted = expectBoolean("muted", muted);
			const restart = read("restartKey");
			if (restart !== undefined) {
				if (typeof restart !== "string" && typeof restart !== "number")
					throw contract("restartKey: expected a string or a number");
				next.restartKey = restart;
			}
			const onEnded = read("onEnded");
			if (onEnded !== undefined) {
				const handler = handlerIdOf(onEnded);
				if (handler === null)
					throw contract("onEnded: expected a handler reference");
				next.onEnded = handler;
			}
			break;
		}
		case "#text":
			break;
	}
	return next;
}

export const EMPTY_PROPS = EMPTY;
