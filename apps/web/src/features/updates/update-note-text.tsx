import { updateNoteTextSpans } from "@rowcat/domain";
import { Fragment } from "react";

/**
 * One line of announcement copy. A screen name the author wraps in backticks is set as a word. The
 * split rule is in `@rowcat/domain` (`updateNoteTextSpans`, which mobile calls too); this file
 * decides only how the word looks.
 *
 * No code chip (background box). This dialog is prose that relies on type hierarchy and spacing,
 * and the word is a name users look for on screen, not code. It is one step darker than the
 * surrounding text (`text-foreground`) and one weight heavier.
 */
export function UpdateNoteText({ text }: { text: string }) {
	return updateNoteTextSpans(text).map((span, index) =>
		span.label ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: the order of pieces within one sentence never changes
			<span key={index} className="font-medium text-foreground">
				{span.text}
			</span>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: the order of pieces within one sentence never changes
			<Fragment key={index}>{span.text}</Fragment>
		),
	);
}
