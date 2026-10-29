import {
	classifyRuntimeAssetValue,
	type RuntimeAssetTarget,
	type RuntimeManagedAssetKind,
} from "@rowcat/runtime/asset";
import {
	assetPathOf,
	controlIdOf,
	handlerIdOf,
	type RuntimeHostNodeKind,
	type RuntimeHostValue,
} from "@rowcat/runtime-host/patches";
import type { WebAudioController } from "./audio.ts";
import { rendererError, WEB_RENDERER_ERROR_CODE } from "./errors.ts";
import { applyTransitionCss, readTransition } from "./motion.ts";
import type { NodeRecord } from "./nodes.ts";
import {
	boxStyleCss,
	colorCss,
	progressStyleCss,
	syncInlineCss,
	textStyleCss,
} from "./styles.ts";

/**
 * Prop to DOM: one table per kind and one handler per prop. No generic setAttribute or
 * element[name] = value exists here. Those would let runtime props write any DOM attribute
 * (onclick, srcdoc, href), gated only by strings. An unknown kind or prop name is a contract error.
 *
 * Assets are never addresses, even remote ones. The value is classified by the runtime's function
 * (`classifyRuntimeAssetValue`) and turned into an address only by the host resolver
 * (`resolveAsset`), which returns RowCat's proxy address for remote URLs. Nothing here lets the
 * browser fetch the author's host directly. If the resolver returns null, or the returned address
 * fails, a placeholder appears, and an `error` event removes `src`. A missing image never breaks
 * the session.
 */

/**
 * The argument is the classified kind, not a string. If the host received a string and decided for
 * itself whether it was an address, each renderer would grow its own rule, and one of them could
 * send logical paths to the proxy. The `url` of a remote target is the author's address; only this
 * function's answer becomes `src`.
 */
export type WebRuntimeAssetResolver = (
	target: RuntimeAssetTarget,
	expect: RuntimeManagedAssetKind,
) => string | null;

export interface PropContext {
	readonly resolveAsset: WebRuntimeAssetResolver;
	/**
	 * The hand that writes and removes controllers in the registry, provided by the renderer.
	 *
	 * This file does not hold the registry directly because `reset()` swaps it out. A captured
	 * reference would send props written after a reset into a dead table.
	 */
	readonly bindControl: (record: NodeRecord, control: number) => void;
	readonly unbindControl: (record: NodeRecord) => void;
	/**
	 * Whether the viewer has reduced motion turned on, as answered by the renderer's media query.
	 *
	 * This is a function rather than a value because the setting can change during a session. A
	 * captured value would only tell nodes created after the change; nodes already on screen would
	 * keep moving.
	 */
	readonly reducedMotion: () => boolean;
	/**
	 * Adds or removes a transition-bearing node in the renderer's list.
	 *
	 * When reduced motion changes, the declarations of every node already on screen must be re-synced.
	 * Without this list, that would mean scanning the whole registry.
	 */
	readonly trackMotion: (record: NodeRecord, tracked: boolean) => void;
}

interface PropHandler {
	set(record: NodeRecord, value: RuntimeHostValue, context: PropContext): void;
	remove(record: NodeRecord, context: PropContext): void;
}

const contract = (message: string) =>
	rendererError(WEB_RENDERER_ERROR_CODE.contract, message);

const element = (record: NodeRecord): HTMLElement => record.node as HTMLElement;

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

const expectEnum = (
	name: string,
	value: RuntimeHostValue,
	allowed: readonly string[],
): string => {
	if (typeof value === "string" && allowed.includes(value)) return value;
	throw contract(`${name}: expected one of ${allowed.join(" · ")}`);
};

/** The `gap` prop of `Stack` and `Row`. When present it overrides `style.gap` (see `styles.ts`). */
const gapOverride = (record: NodeRecord): number | null => {
	const gap = record.props.get("gap");
	return typeof gap === "number" ? gap : null;
};

const refreshBoxCss = (record: NodeRecord): void => {
	const style = (record.props.get("style") ?? null) as RuntimeHostValue;
	syncInlineCss(
		element(record),
		record.css,
		boxStyleCss(style, gapOverride(record)),
	);
};

const boxStyle: PropHandler = {
	set(record, value) {
		/** Compute first, then record. A value outside the contract must never stay in the record. */
		const css = boxStyleCss(value, gapOverride(record));
		record.props.set("style", value);
		syncInlineCss(element(record), record.css, css);
	},
	remove(record) {
		record.props.delete("style");
		refreshBoxCss(record);
	},
};

const gap: PropHandler = {
	set(record, value) {
		const number = expectNumber("gap", value);
		record.props.set("gap", number);
		refreshBoxCss(record);
	},
	remove(record) {
		record.props.delete("gap");
		refreshBoxCss(record);
	},
};

const textStyle: PropHandler = {
	set(record, value) {
		const css = textStyleCss(value);
		record.props.set("style", value);
		syncInlineCss(element(record), record.css, css);
	},
	remove(record) {
		record.props.delete("style");
		syncInlineCss(element(record), record.css, new Map());
	},
};

const progressStyle: PropHandler = {
	set(record, value) {
		const css = progressStyleCss(value);
		record.props.set("style", value);
		syncInlineCss(element(record), record.css, css);
	},
	remove(record) {
		record.props.delete("style");
		syncInlineCss(element(record), record.css, new Map());
	},
};

const onPress: PropHandler = {
	set(record, value) {
		const handler = handlerIdOf(value);
		if (handler === null)
			throw contract("onPress: expected a handler reference");
		record.handlers.set("onPress", handler);
	},
	remove(record) {
		record.handlers.delete("onPress");
	},
};

const disabled: PropHandler = {
	set(record, value) {
		const flag = expectBoolean("disabled", value);
		record.disabled = flag;
		(element(record) as HTMLButtonElement).disabled = flag;
	},
	remove(record) {
		record.disabled = false;
		(element(record) as HTMLButtonElement).disabled = false;
	},
};

const TONES = ["primary", "secondary", "ghost"] as const;

const tone: PropHandler = {
	set(record, value) {
		element(record).dataset.rcTone = expectEnum("tone", value, TONES);
	},
	remove(record) {
		delete element(record).dataset.rcTone;
	},
};

const background: PropHandler = {
	set(record, value) {
		const css = new Map([["background-color", colorCss("background", value)]]);
		syncInlineCss(element(record), record.css, css);
	},
	remove(record) {
		syncInlineCss(element(record), record.css, new Map());
	},
};

/**
 * `horizontal` is a data attribute the stylesheet reads, and it is also stored on the record.
 *
 * The record copy matters for control commands: `scrollToEnd` takes its measuring axis from this
 * value. If it re-read the `dataset` string, protocol state would have two owners.
 */
const horizontal: PropHandler = {
	set(record, value) {
		const on = expectBoolean("horizontal", value);
		record.props.set("horizontal", on);
		element(record).dataset.rcHorizontal = String(on);
	},
	remove(record) {
		record.props.delete("horizontal");
		delete element(record).dataset.rcHorizontal;
	},
};

const markMissing = (image: HTMLImageElement): void => {
	image.removeAttribute("src");
	image.dataset.rcMissing = "";
	image.setAttribute("role", "img");
};

const source: PropHandler = {
	set(record, value, context) {
		const path = assetPathOf(value);
		if (path === null) throw contract("source: expected an asset reference");
		const image = element(record) as HTMLImageElement;
		/**
		 * Only the resolver's answer becomes an address. Asset strings never sit in `src`, even when the
		 * value is an `https://` URL, since that is still the author's address rather than one the
		 * browser may open. A corrupted value (a shape the runtime could not have sealed) classifies as
		 * null and becomes a placeholder.
		 */
		const target = classifyRuntimeAssetValue(path);
		const url = target === null ? null : context.resolveAsset(target, "image");
		if (url === null) {
			markMissing(image);
			return;
		}
		delete image.dataset.rcMissing;
		image.removeAttribute("role");
		image.src = url;
	},
	remove(record) {
		markMissing(element(record) as HTMLImageElement);
	},
};

const alt: PropHandler = {
	set(record, value) {
		element(record).setAttribute("alt", expectString("alt", value));
	},
	remove(record) {
		element(record).setAttribute("alt", "");
	},
};

const FITS = ["cover", "contain", "fill"] as const;

const fit: PropHandler = {
	set(record, value) {
		const css = new Map([["object-fit", expectEnum("fit", value, FITS)]]);
		/**
		 * `fit` is a separate declaration from `style`, managed on its own. Style sync does not remove
		 * it.
		 */
		element(record).style.setProperty(
			"object-fit",
			css.get("object-fit") as string,
		);
	},
	remove(record) {
		element(record).style.removeProperty("object-fit");
	},
};

const entryElement = (
	record: NodeRecord,
): HTMLInputElement | HTMLTextAreaElement =>
	record.node as HTMLInputElement | HTMLTextAreaElement;

/**
 * Box style and text style share one element, so they are computed together.
 *
 * `syncInlineCss` makes the inline declarations equal to the complete target set it is given. If
 * each handler passed only its own set, whichever wrote last would erase the other's declarations.
 * That is why `gap` and `style` are also computed together.
 */
const refreshEntryCss = (record: NodeRecord): void => {
	const box = boxStyleCss(
		(record.props.get("style") ?? null) as RuntimeHostValue,
		null,
	);
	const text = textStyleCss(
		(record.props.get("textStyle") ?? null) as RuntimeHostValue,
	);
	for (const [name, value] of text) box.set(name, value);
	syncInlineCss(element(record), record.css, box);
};

const entryBoxStyle: PropHandler = {
	set(record, value) {
		boxStyleCss(value, null);
		record.props.set("style", value);
		refreshEntryCss(record);
	},
	remove(record) {
		record.props.delete("style");
		refreshEntryCss(record);
	},
};

const entryTextStyle: PropHandler = {
	set(record, value) {
		textStyleCss(value);
		record.props.set("textStyle", value);
		refreshEntryCss(record);
	},
	remove(record) {
		record.props.delete("textStyle");
		refreshEntryCss(record);
	},
};

/**
 * Applies the controlled value to the DOM. It does nothing in three cases.
 *
 * While composing: writing would break the IME composition at that point. When the value is already
 * equal: an unneeded assignment resets the caret and selection. While answers are pending: that
 * commit is older than the screen, so writing it would undo text the user just typed (see
 * `pendingSends` in `nodes.ts`).
 */
export function syncEntryValue(record: NodeRecord): void {
	if (record.composing) return;
	if (record.pendingSends > 0) return;
	const desired = record.props.get("value");
	const next = typeof desired === "string" ? desired : "";
	const input = entryElement(record);
	if (input.value !== next) input.value = next;
}

/**
 * Settles one sent text against one arriving commit.
 *
 * If the value equals the most recently sent text, no answer remains to wait for, so everything
 * settles at once. Most controlled inputs (`value={v} onChangeText={setV}`) take this path.
 * Otherwise the count goes down by one. This matters when the author trims text on the way back
 * (cap, filter): the answer then never equals what was sent. Settling on equality alone would leave
 * that input stuck forever.
 */
function settleEntryValue(record: NodeRecord, next: string): void {
	if (next === record.sentText) record.pendingSends = 0;
	else if (record.pendingSends > 0) record.pendingSends -= 1;
	/**
	 * Once all answers have arrived, the controlled value becomes the basis for duplicate detection.
	 *
	 * While `sentText` was only the last text sent, a pasted `hello` could be followed by the author
	 * clearing the field to an empty string. If the user then pasted `hello` again, it was discarded as
	 * already sent. The screen showed the text while the author's state was empty, and Enter submitted
	 * an empty value. Native has no such duplicate check, so this mismatch never appeared there.
	 */
	if (record.pendingSends === 0) record.sentText = next;
	record.props.set("value", next);
	syncEntryValue(record);
}

const entryValue: PropHandler = {
	set(record, value) {
		settleEntryValue(record, expectString("value", value));
	},
	remove(record) {
		settleEntryValue(record, "");
	},
};

const placeholder: PropHandler = {
	set(record, value) {
		entryElement(record).placeholder = expectString("placeholder", value);
	},
	remove(record) {
		entryElement(record).placeholder = "";
	},
};

const entryDisabled: PropHandler = {
	set(record, value) {
		const flag = expectBoolean("disabled", value);
		record.disabled = flag;
		entryElement(record).disabled = flag;
	},
	remove(record) {
		record.disabled = false;
		entryElement(record).disabled = false;
	},
};

const handlerProp = (name: string): PropHandler => ({
	set(record, value) {
		const handler = handlerIdOf(value);
		if (handler === null)
			throw contract(`${name}: expected a handler reference`);
		record.handlers.set(name, handler);
	},
	remove(record) {
		record.handlers.delete(name);
	},
});

const onChangeText = handlerProp("onChangeText");
const onSubmit = handlerProp("onSubmit");

const progressValue: PropHandler = {
	set(record, value) {
		const number = expectNumber("value", value);
		const progress = element(record) as HTMLProgressElement;
		progress.max = 1;
		progress.value = Math.min(1, Math.max(0, number));
	},
	remove(record) {
		/**
		 * With no value the progress is indeterminate. In HTML that state is the absence of the `value`
		 * attribute.
		 */
		element(record).removeAttribute("value");
	},
};

/**
 * The hand for a sound node. A missing controller is a contract error.
 *
 * The controller is created together with the node (`renderer.ts`), so seeing null here is a
 * renderer defect, not a protocol one. Skipping silently would leave that node never making sound,
 * and that silence would look the same as "the author did not upload a file".
 */
const audioProp = (
	name: string,
	set: (audio: WebAudioController, value: RuntimeHostValue) => void,
	clear: (audio: WebAudioController) => void,
): PropHandler => ({
	set(record, value) {
		const audio = record.audio;
		if (audio === null) throw contract(`${name}: this node has no audio`);
		set(audio, value);
	},
	remove(record) {
		const audio = record.audio;
		if (audio === null) throw contract(`${name}: this node has no audio`);
		clear(audio);
	},
});

/**
 * The sound source. Only the resolver's answer becomes `src`.
 *
 * This follows the same rule as pictures, with one addition: the resolver is asked for sound
 * ("audio"), and that argument is the most important value on this line. If a name bound to an
 * image were resolved as sound, `<audio>` would download the image bytes, fail to decode them, and
 * play nothing, silently. By then the request has already gone out, and it could point at media
 * this session may not open.
 *
 * The check lives in the binding layer (`bindRuntimeAssetResolver`), not in the renderer. On
 * mismatch the answer here is null. Remote URLs also become null on this path, since sound in this
 * version is managed assets only.
 */
const audioSource: PropHandler = {
	set(record, value, context) {
		const audio = record.audio;
		if (audio === null) throw contract("source: this node has no audio");
		const path = assetPathOf(value);
		if (path === null) throw contract("source: expected an asset reference");
		const target = classifyRuntimeAssetValue(path);
		audio.setSource(
			target === null ? null : context.resolveAsset(target, "audio"),
		);
	},
	remove(record) {
		const audio = record.audio;
		if (audio === null) throw contract("source: this node has no audio");
		audio.setSource(null);
	},
};

const audioPlaying = audioProp(
	"playing",
	(audio, value) => audio.setPlaying(expectBoolean("playing", value)),
	(audio) => audio.setPlaying(false),
);

const audioLoop = audioProp(
	"loop",
	(audio, value) => audio.setLoop(expectBoolean("loop", value)),
	(audio) => audio.setLoop(false),
);

/**
 * Volume is not clamped here.
 *
 * Out-of-range values are already rejected inside the VM (`runtime_invalid_host_prop`). Clamping
 * again would make that rejection pointless, and two platforms would each start clamping, so the
 * same value would sound at different levels on different devices. Finiteness is still checked,
 * because this value can arrive in a corrupted bundle, and then a contract error is correct.
 */
const audioVolume = audioProp(
	"volume",
	(audio, value) => {
		const number = expectNumber("volume", value);
		if (number < 0 || number > 1)
			throw contract("volume: expected a number between 0 and 1");
		audio.setVolume(number);
	},
	(audio) => audio.setVolume(1),
);

const audioMuted = audioProp(
	"muted",
	(audio, value) => audio.setMuted(expectBoolean("muted", value)),
	(audio) => audio.setMuted(false),
);

const audioRestartKey = audioProp(
	"restartKey",
	(audio, value) => {
		if (typeof value !== "string" && typeof value !== "number")
			throw contract("restartKey: expected a string or a number");
		audio.setRestartKey(value);
	},
	(audio) => audio.setRestartKey(null),
);

const onEnded = handlerProp("onEnded");

/**
 * `controller` records a controller number in the registry and adds nothing to the DOM.
 *
 * This handler is the entire authorization for control commands. A later command carries only a
 * controller number, and only the table written here says which node it refers to. Numbers the
 * author invented are not in the table, and trusted shell elements never enter this registry.
 */
const controller: PropHandler = {
	set(record, value, context) {
		const id = controlIdOf(value);
		if (id === null) throw contract("controller: expected a control reference");
		context.bindControl(record, id);
	},
	remove(record, context) {
		context.unbindControl(record);
	},
};

/**
 * `transition` records the policy only. It does not touch the style.
 *
 * Not rewriting the style is the answer to §18. When a commit changes only the policy and the value
 * stays the same, the browser starts nothing. An in-progress transition keeps the duration and
 * curve it started with, which is how CSS transitions behave. The new policy applies from the next
 * value change.
 *
 * The order also matters. If `transition` applies before `style` within one batch, that batch's
 * value change uses the new policy, which is the same statement as "the next change uses the new
 * policy".
 */
const transition: PropHandler = {
	set(record, value, context) {
		const resolved = readTransition(value);
		record.motion.transition = resolved;
		context.trackMotion(record, true);
		applyTransitionCss(element(record), record.motion, context.reducedMotion());
	},
	remove(record, context) {
		record.motion.transition = null;
		context.trackMotion(record, false);
		/**
		 * Removing the declarations ends the transition in progress, because the browser draws the target
		 * value at once. Keeping them would make the next change animate even after the author has
		 * removed the transition.
		 */
		applyTransitionCss(element(record), record.motion, context.reducedMotion());
	},
};

type PropTable = Readonly<Record<string, PropHandler>>;

/**
 * `transition` is accepted exactly where `style: boxStyle` is accepted (`RuntimeTransitionable`).
 *
 * Text, button, progress, and screen do not accept it, matching the contract. A batch that sets
 * `transition` on those kinds is rejected here as an unknown prop.
 */
const PROPS: Readonly<Record<RuntimeHostNodeKind, PropTable>> = {
	screen: { background },
	view: { style: boxStyle, transition },
	stack: { gap, style: boxStyle, transition },
	row: { gap, style: boxStyle, transition },
	scroll: { horizontal, style: boxStyle, controller, transition },
	text: { style: textStyle },
	image: { source, alt, style: boxStyle, fit, transition },
	button: { onPress, disabled, tone },
	pressable: { onPress, disabled, style: boxStyle, transition },
	progress: { value: progressValue, style: progressStyle },
	"text-input": {
		value: entryValue,
		placeholder,
		disabled: entryDisabled,
		onChangeText,
		onSubmit,
		style: entryBoxStyle,
		textStyle: entryTextStyle,
		controller,
		transition,
	},
	"text-area": {
		value: entryValue,
		placeholder,
		disabled: entryDisabled,
		onChangeText,
		style: entryBoxStyle,
		textStyle: entryTextStyle,
		controller,
		transition,
	},
	audio: {
		source: audioSource,
		playing: audioPlaying,
		loop: audioLoop,
		volume: audioVolume,
		muted: audioMuted,
		restartKey: audioRestartKey,
		onEnded,
	},
	/** Text nodes take no props. The validator already rejects any prop on them. */
	"#text": {},
};

function handlerFor(record: NodeRecord, name: string): PropHandler {
	if (record.kind === "root")
		throw contract(`the root container has no props (got ${name})`);
	const table = PROPS[record.kind];
	if (!Object.hasOwn(table, name))
		throw contract(`${record.kind} has no prop "${name}"`);
	return table[name] as PropHandler;
}

export function setProp(
	record: NodeRecord,
	name: string,
	value: RuntimeHostValue,
	context: PropContext,
): void {
	handlerFor(record, name).set(record, value, context);
}

export function removeProp(
	record: NodeRecord,
	name: string,
	context: PropContext,
): void {
	handlerFor(record, name).remove(record, context);
}

/**
 * Maps a node kind to a DOM element. Text does not come here; it uses `document.createTextNode`.
 *
 * `button` and `pressable` are real `<button type="button">` elements, and that is half their
 * accessibility. Keyboard activation, focus, and disabled semantics come from the browser. A `<div
 * role="button">` would have to rebuild all three by hand, and missing one raises no error.
 */
export function createElementFor(
	document: Document,
	kind: Exclude<RuntimeHostNodeKind, "#text">,
): HTMLElement {
	let node: HTMLElement;
	switch (kind) {
		case "text":
			node = document.createElement("span");
			break;
		case "image": {
			const image = document.createElement("img");
			image.setAttribute("alt", "");
			image.decoding = "async";
			image.loading = "lazy";
			/** No referrer is sent. The asset host has no reason to know the viewer's origin. */
			image.referrerPolicy = "no-referrer";
			/**
			 * An image that fails to load collapses to a placeholder. A broken-image icon explains nothing,
			 * and the failure never reaches the author's code, so one picture cannot act as a network probe.
			 */
			image.addEventListener("error", () => markMissing(image));
			markMissing(image);
			node = image;
			break;
		}
		case "button":
		case "pressable": {
			const button = document.createElement("button");
			button.type = "button";
			node = button;
			break;
		}
		case "progress": {
			const progress = document.createElement("progress");
			progress.max = 1;
			node = progress;
			break;
		}
		/**
		 * Real `<input>` and `<textarea>` elements, not imitations built from `<div contenteditable>`.
		 * The browser provides for free: IME composition, caret and selection, autocomplete suppression,
		 * the mobile keyboard type, the screen reader's editable semantics, and `disabled`. A screen that
		 * misses one of these raises no error.
		 */
		case "text-input": {
			const input = document.createElement("input");
			input.type = "text";
			/**
			 * Stops the browser's form autocomplete from filling in values the author does not know about.
			 */
			input.autocomplete = "off";
			node = input;
			break;
		}
		case "text-area":
			node = document.createElement("textarea");
			break;
		/**
		 * A real `<audio>` element, not an `AudioContext` imitation. The browser provides streaming and
		 * range requests, format negotiation, decoding, and consistent media policy. A hand-built version
		 * raises no error and goes silent only on certain devices.
		 *
		 * `controls` is not set, so nothing is drawn and the node stays out of the accessibility tree. It
		 * is part of the sound lifetime, not the screen. `preload` is `none` so no bytes are fetched
		 * until the sound is actually requested.
		 */
		case "audio": {
			const audio = document.createElement("audio");
			audio.preload = "none";
			audio.setAttribute("aria-hidden", "true");
			node = audio;
			break;
		}
		default:
			node = document.createElement("div");
	}
	node.className = `rc-${kind}`;
	node.dataset.rc = kind;
	return node;
}
