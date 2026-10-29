import type { NativeHostNode } from "./tree-store.ts";

/**
 * Events: what goes out is one integer.
 *
 * PressEvent, coordinates, nativeEvent and NativeSyntheticEvent do not cross this boundary. onPress
 * fires without arguments; the handler number crosses, and the function it refers to stays in the
 * QuickJS VM.
 *
 * Only text entry carries a value, and that value is a string the renderer builds, not RN's event
 * object, since onChangeText already supplies a string.
 *
 * Inactive nodes emit no events. RN's Pressable does not emit press when disabled, but the check is
 * repeated here because the disabled prop is often misused as visual-only. Either way, an inactive
 * node's number never crosses.
 */

export type NativeRuntimeEventPayload = string | null;

export type NativeRuntimeEventDispatcher = (
	handlerId: number,
	payload?: NativeRuntimeEventPayload,
) => void;

/** Legacy alias from when only presses existed. It is the same function. */
export type NativeRuntimePressDispatcher = NativeRuntimeEventDispatcher;

/**
 * The handler number to emit when this node is pressed; null if absent or disabled.
 *
 * A pressable without a handler is not disabled. It is pressed, but emits no number. The web
 * renderer delegates the press so outer handlers receive it. RN has no such pass-through, so here a
 * press stops at this node. The difference is only observable for a pressable nested inside another
 * pressable.
 */
export function pressHandlerOf(node: NativeHostNode): number | null {
	if (node.props.disabled) return null;
	return node.props.onPress;
}

/**
 * Everything a text input hands to its native component; this list is the contract.
 *
 * The mapping is a separate function for two reasons. It makes the mapping testable: the native
 * test setup has no React Native runtime, so mapping inside JSX could only be checked through the
 * prop table, which answers what is received, not what is passed. It also fixes the meaning of
 * disabled. RN's editable={false} already blocks typing, but since the prop is often misused as
 * visual-only, the web renderer checks again at this point, and so does this function (section 7).
 *
 * It returns handler numbers and values only. NativeSyntheticEvent and nativeEvent.text are not
 * part of the contract: onChangeText already provides the string, and reaching into the event
 * object would make RN's event shape part of the runtime contract.
 */
export interface NativeTextEntryBinding {
	/** Whether the input is multi-line. text-area is, and that kind has no submit. */
	readonly multiline: boolean;
	/** Controlled value. The owner is the creator's state. */
	readonly value: string;
	readonly placeholder: string;
	/** Inactivity, expressed in RN's vocabulary: editable rather than disabled. */
	readonly editable: boolean;
	/**
	 * Handler number emitted when the text changes. It is null when inactive, so no wiring is set up.
	 */
	readonly changeHandler: number | null;
	/** Handler number emitted on submit. It is null when the input is multi-line or inactive. */
	readonly submitHandler: number | null;
}

export function textEntryBindingOf(
	node: NativeHostNode,
): NativeTextEntryBinding {
	const multiline = node.kind === "text-area";
	const disabled = node.props.disabled;
	return {
		multiline,
		value: node.props.text,
		placeholder: node.props.placeholder,
		editable: !disabled,
		changeHandler: disabled ? null : node.props.onChangeText,
		submitHandler: disabled || multiline ? null : node.props.onSubmit,
	};
}
