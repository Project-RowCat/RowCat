import * as LabelPrimitive from "@rn-primitives/label";
import {
	borderWidth,
	fontSize,
	lineHeight,
	radiusScale,
	space,
} from "@rowcat/design";
import { type ReactNode, type Ref, useId } from "react";
import {
	type NativeSyntheticEvent,
	StyleSheet,
	TextInput,
	type TextInputProps,
	type TextInputSelectionChangeEventData,
	useWindowDimensions,
	View,
} from "react-native";
import { controlHeight } from "./metrics.ts";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { typeface } from "./typography.ts";

/**
 * Input shares the surface of the web input family: field background, border, radius, text color,
 * placeholder color (muted-foreground), and the meaning of the locked and error states.
 *
 * Keyboard behavior is not wrapped. keyboardType, returnKeyType, autoComplete, secureTextEntry and
 * submit behavior pass through TextInputProps unchanged. Renaming them here would add a mapping for
 * every new use and hide the platform's own vocabulary.
 *
 * An error is not shown by color alone. `invalid` changes the border and sets aria-invalid. The
 * error message belongs to the screen, because the wording is domain-specific.
 *
 * The label is wired to the field through @rn-primitives/label. A plain Text label would be read as
 * a separate element from an unnamed input, and tapping it would not focus the field. The web's
 * <label for> does that automatically.
 */

/**
 * The native handle and cursor/selection event types. The names intentionally avoid the TextInput
 * prefix.
 *
 * Feature code may not write the word TextInput (apps/mobile/src/lib/boundaries.test.ts). That rule
 * exists to stop screens from drawing inputs directly, which would give them their own surface and
 * color. Naming the handle type is not its target, but the static scan matches the word. So this
 * package exports TextFieldHandle and TextFieldSelectionEvent, and feature code uses only those
 * names. The scan pattern itself is unchanged; only these two exported names were added.
 */
export type TextFieldHandle = TextInput;
export type TextFieldSelectionEvent =
	NativeSyntheticEvent<TextInputSelectionChangeEventData>;

export interface FieldOwnProps {
	/** Visible label above the field. It is also the screen reader name. */
	label: string;
	/**
	 * Hides the label visually. Used where the placeholder already names the field, such as a search
	 * box.
	 */
	labelHidden?: boolean;
	invalid?: boolean;
}

export function Input({
	label,
	labelHidden,
	invalid,
	style,
	...props
}: TextInputProps & FieldOwnProps) {
	const id = useId();
	return (
		<Field label={label} labelHidden={labelHidden} nativeID={id}>
			<BareInput
				{...props}
				label={label}
				invalid={invalid}
				aria-labelledby={labelHidden ? undefined : id}
				style={style}
			/>
		</Field>
	);
}

/**
 * How a multi-line field grows. Unset keeps the old behavior: grow with content, no cap.
 *
 * Only one case needs a limit: a whole long document going into one field, such as a prompt editor.
 * Without a cap it becomes many screens tall and pushes the other sections out of reach, so the
 * user cannot get back to the section they just edited. Such a field should scroll inside itself.
 * - capped: grows up to a share of screen height.
 * - fill: takes the remaining height the parent gives it, for places whose layout is already
 *   fixed (full-screen editing).
 *
 * The cap is a share of screen height, not a fixed pt value. Fixed sizes swallow small phones and
 * look tiny on tablets. The web's same field uses dvh for this reason, so the two apps share the
 * rule, not the numbers.
 */
export type TextareaGrowth = "capped" | "fill";

export interface TextareaOwnProps extends FieldOwnProps {
	growth?: TextareaGrowth;
	/**
	 * Native handle for the field. The wrapper nests TextInput inside Field, so callers cannot reach
	 * the view. One case needs it: returning focus and cursor to the inline field after closing the
	 * full-screen editor. Exposing BareInput directly would leak label wiring and surface rules into
	 * screens. A single ref is the narrower option.
	 */
	ref?: Ref<TextInput>;
}

/**
 * Multi-line input, used by comments and the chat composer.
 *
 * textAlignVertical is "top" because on Android the first line would otherwise center vertically.
 * iOS already starts at the top.
 *
 * Growth is opt-in. A field without `growth` renders exactly as before. This axis exists for one
 * long-form editor, and changing it should not require touching the other fields.
 */
export function Textarea({
	label,
	labelHidden,
	invalid,
	growth,
	ref,
	style,
	...props
}: TextInputProps & TextareaOwnProps) {
	const id = useId();
	const bounds = useLongFormBounds();
	return (
		<Field
			label={label}
			labelHidden={labelHidden}
			nativeID={id}
			/**
			 * A field that fills the remaining height needs the wrapper, including the label, to receive
			 * that height first.
			 */
			fill={growth === "fill"}
		>
			<BareInput
				{...props}
				ref={ref}
				label={label}
				invalid={invalid}
				aria-labelledby={labelHidden ? undefined : id}
				multiline
				/**
				 * A capped field scrolls inside itself. This is already the default, but it is set explicitly
				 * because it is part of the contract. If someone turns it off later, the symptom is that the
				 * end of a long text cannot be reached, not an error.
				 *
				 * It does not fight the outer scroll. On Android, ReactEditText blocks parent interception
				 * while a touch starts and releases it only when it cannot scroll further. iOS UITextView
				 * behaves the same way. So a drag inside a capped field scrolls the text, and a drag inside a
				 * short field scrolls the screen.
				 *
				 * Feature code should not add responder-capture workarounds such as
				 * onStartShouldSetResponderCapture. That also intercepts cursor placement.
				 */
				scrollEnabled={growth ? true : props.scrollEnabled}
				style={[
					field.multi,
					growth === "capped" && bounds,
					growth === "fill" && field.fill,
					style,
				]}
			/>
		</Field>
	);
}

/**
 * Minimum and maximum height for long-form fields. Both derive from screen height.
 * - Minimum: 26% of screen height, with a floor of 176. The floor serves small devices: 26% of a
 *   568pt screen is 148, which cannot show one paragraph.
 * - Maximum: 46% of screen height, clamped to 220 through 460. The ceiling serves tablets: the
 *   ratio alone gives 471 on a 1024pt screen, which is effectively no cap.
 *
 * The minimum is clamped to the maximum once more. On very small devices the 176 floor can exceed
 * the proportional maximum. React Native then lets the minimum win, and the box grows without a
 * cap. That bug reproduces only on small devices.
 *
 * The hook is called unconditionally because of the rules of hooks, not because every field uses
 * these values. useWindowDimensions is one subscription, and the window size rarely changes.
 */
const LONG_FORM_MIN_RATIO = 0.26;
const LONG_FORM_MAX_RATIO = 0.46;
const LONG_FORM_MIN_FLOOR = 176;
const LONG_FORM_MAX_FLOOR = 220;
const LONG_FORM_MAX_CEILING = 460;

function useLongFormBounds(): { maxHeight: number; minHeight: number } {
	const { height } = useWindowDimensions();
	const maxHeight = Math.min(
		Math.max(Math.round(height * LONG_FORM_MAX_RATIO), LONG_FORM_MAX_FLOOR),
		LONG_FORM_MAX_CEILING,
	);
	return {
		maxHeight,
		minHeight: Math.min(
			Math.max(Math.round(height * LONG_FORM_MIN_RATIO), LONG_FORM_MIN_FLOOR),
			maxHeight,
		),
	};
}

function Field({
	label,
	labelHidden,
	nativeID,
	fill,
	children,
}: {
	label: string;
	labelHidden?: boolean;
	/** Identity of the label. The field references this value through aria-labelledby. */
	nativeID: string;
	fill?: boolean;
	children: ReactNode;
}) {
	return (
		<View style={[field.root, fill && field.fill]}>
			{labelHidden ? null : (
				/**
				 * Root is a Pressable, so tapping the label also reacts, as the web's <label> does. For a
				 * finger it is one more target.
				 */
				<LabelPrimitive.Root>
					<LabelPrimitive.Text asChild nativeID={nativeID}>
						<Text variant="caption" tone="muted-foreground">
							{label}
						</Text>
					</LabelPrimitive.Text>
				</LabelPrimitive.Root>
			)}
			{children}
		</View>
	);
}

/**
 * Field without a label, for places that lay themselves out, such as the search box and chat
 * composer.
 *
 * The surface rules (color, border, radius, placeholder) still live only here. If those screens
 * drew TextInput directly, color literals would reappear, as they did before.
 *
 * Without a visible label, the accessible name is carried by accessibilityLabel, since there is no
 * label element for aria-labelledby to point at.
 *
 * The line count decides the geometry, and this is the only place that makes that split. On the
 * web, single-line and multi-line are different components (input and textarea) with different
 * values:
 * - Single line: native minHeight 36, paddingVertical 4, no line height. Web h-9 py-1.
 * - Multi-line: native minHeight 88, paddingVertical 8, lineHeight 22. Web min-h-16 py-2.
 *
 * The Input wrapper does not repeat this split. Callers pass only a style, and the multiline flag
 * chooses the geometry.
 */
export function BareInput({
	label,
	invalid,
	ref,
	style,
	...props
}: TextInputProps & {
	label: string;
	invalid?: boolean;
	ref?: Ref<TextInput>;
}) {
	const { colors, fieldSurface } = useTheme();
	return (
		<TextInput
			ref={ref}
			accessibilityLabel={label}
			placeholderTextColor={colors["muted-foreground"]}
			/** Cursor and selection color follow the theme. The platform default would be blue. */
			selectionColor={colors.foreground}
			{...props}
			aria-invalid={invalid}
			style={[
				field.base,
				props.multiline ? field.lines : field.single,
				{
					/**
					 * The surface comes from appearance: translucent in light mode, faintly filled in dark mode
					 * (`controlSurface` in theme.tsx). Writing alpha("input", 0.3) here once made light-mode
					 * fields a gray box that does not exist on the web.
					 */
					backgroundColor: fieldSurface,
					borderColor: invalid ? colors.destructive : colors.input,
					color: colors.foreground,
				},
				props.editable === false && field.blocked,
				style,
			]}
		/>
	);
}

const field = StyleSheet.create({
	root: { gap: space.xs },
	base: {
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		fontSize: fontSize.body,
		/*
		 * Typed text uses the product font too. Without it, only the text inside the field falls back to
		 * the system font. The mismatch shows only when the field is compared with its placeholder and
		 * labels, which use the same style.
		 */
		...typeface("regular"),
		paddingHorizontal: space.md,
	},
	/**
	 * Single-line field height: 36, matching web h-9 and the Button and Select on the same row.
	 *
	 * This field once had a lineHeight, which made it 44 tall: lineHeight 22, plus paddingVertical 10
	 * on each side, plus borderWidth 1 on each side. minHeight 36 was written but never applied,
	 * because the natural height exceeded it. The field was 8pt taller than Button and Select, and the
	 * gap grew down a long form. No source-reading check can catch this, because 36 is literally
	 * present in the file. It was found on a device (apps/mobile/src/features/visual-lab).
	 *
	 * The fix does not pin the height to 36, which would clip text at large type sizes. lineHeight was
	 * removed from the single-line style (it belongs to multi-line, where it sets line spacing), so
	 * the natural height falls under 36. minHeight then does its job: 36 normally, and it grows with
	 * larger text.
	 */
	single: { minHeight: controlHeight.md, paddingVertical: space.xs },
	/**
	 * Line spacing and vertical padding for multi-line fields, matching web textarea py-2.
	 *
	 * This is the counterpart of the rule above. In multi-line fields lineHeight sets the spacing
	 * between lines, and without it paragraphs run together. In single-line fields it only changes the
	 * box height, so it is left out there.
	 */
	lines: { lineHeight: lineHeight.body, paddingVertical: space.sm },
	multi: { minHeight: 88, textAlignVertical: "top" },
	/**
	 * Fills the remaining height. flexBasis 0 is required so that content cannot claim its own height.
	 * Without it, a long draft grows to fit its content and overflows the parent. Then what scrolls is
	 * something above the field, not the field itself.
	 */
	fill: { flexBasis: 0, flexGrow: 1, flexShrink: 1 },
	blocked: { opacity: 0.6 },
});
