import { updateNoteTextSpans } from "@rowcat/domain";
import { Text, type TextVariant } from "@rowcat/ui-native";
import { Fragment } from "react";

/**
 * The inside of one line of announcement text: names the author wrapped in backticks are set off as
 * words.
 *
 * The splitting rule belongs to `@rowcat/domain` (`updateNoteTextSpans`, which the web calls too).
 * What is decided here is the shape of a name: a darker color than the surrounding text and **one
 * weight step above it**. The step depends on the variant: `body` is normally `medium` (the web's
 * `font-medium` position), and `label` is already `medium`, so it must become `semibold` to show
 * any difference. It is not drawn as a code chip, for the same reason as on the web
 * (`apps/web/.../update-note-text.tsx`).
 *
 * This is used as a child of an outer `Text`. A nested `Text` resets `variant` to the default
 * (`body`), so it must receive the outer variant; otherwise a name inside a `label`-sized intro
 * grows one step larger (`markdown-view.tsx` passes `ctx.variant` for the same reason).
 */
export function UpdateNoteText({
	text,
	variant,
}: {
	text: string;
	variant?: TextVariant;
}) {
	return updateNoteTextSpans(text).map((span, index) =>
		span.label ? (
			<Text
				// biome-ignore lint/suspicious/noArrayIndexKey: the order of pieces within one sentence never changes
				key={index}
				variant={variant}
				weight={variant === "label" ? "semibold" : "medium"}
				leading="reading"
			>
				{span.text}
			</Text>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: the order of pieces within one sentence never changes
			<Fragment key={index}>{span.text}</Fragment>
		),
	);
}
