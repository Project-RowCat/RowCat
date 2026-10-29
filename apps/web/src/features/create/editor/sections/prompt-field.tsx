import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { useEditedValue } from "../edited-value.ts";
import { FieldFrame, fieldDescribedBy } from "../fields.tsx";
import {
	caretAtEnd,
	clampTextSelection,
	PROMPT_DIALOG_FIELD,
	PROMPT_FIELD_GROWTH,
	PROMPT_FIELD_ROWS,
	promptExpand,
	type TextSelection,
} from "./prompt-editing.ts";

/**
 * Creator-facing prompt field: the whole authoring body is one box that grows and then stops.
 *
 * The reason `TextAreaField` is not used is the reason this file exists. That field owns its value
 * (`useEditedValue`). Here two fields draw the same value, so ownership must sit one layer up. If
 * each owned it, opening the window would create two values the screen runs ahead of, and they
 * would accept auto-save's reverts at different times. The symptom is that closing the window loses
 * the sentence just typed.
 *
 * From the shared layer this file takes only layout and accessibility wiring (`FieldFrame`). The
 * prompt's cap and window are deliberately not added there, because description, lore content, and
 * scene body would then inherit this geometry.
 *
 * The field grows to a cap, then scrolls inside the box. The cap and its reasoning are in
 * `prompt-editing.ts`. Splitting the field, collapsing the section, and adding jump buttons were
 * rejected: they revert the save model, make the prompt look optional, or stack controls on the
 * symptom.
 *
 * The window is not a second state. The inline field and the window field receive the same `text`
 * and `edit`. Text typed in the window takes the same autosave path (`onChange` → `patchDraft`),
 * and autosave runs while the window is open. Closing confirms nothing, so there is no cancel.
 *
 * The caret is handed over, because the two fields are different DOM nodes. `clampTextSelection`
 * applies the rule that the value may have shrunk off-screen. This file decides only when to apply
 * it.
 */
export function PromptField({
	value,
	onChange,
	hint,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	hint?: string;
	placeholder?: string;
}) {
	const { t } = useTranslation(["create", "common"]);
	const id = useId();
	const hintId = `${id}-hint`;
	const overflowId = `${id}-overflow`;
	/** This layer owns the value, because both fields draw it. */
	const [text, edit] = useEditedValue(value, onChange);
	const [expanded, setExpanded] = useState(false);
	const inline = useRef<HTMLTextAreaElement>(null);
	const surface = useRef<HTMLTextAreaElement>(null);
	/**
	 * The caret positions to hand over: one for opening and one for closing. They are refs on purpose.
	 * Stored as state, the component would re-render on every caret move, which is every keystroke.
	 */
	const entering = useRef<TextSelection | null>(null);
	const returning = useRef<TextSelection | null>(null);

	/**
	 * Read at the moment of opening. Reading after the window has appeared is too late: focus has
	 * already moved, and without a saved position the caret goes to the end. The body is usually long,
	 * so that end is not where the user was. This is why `autoFocus` alone is not used.
	 */
	const open = (): void => {
		entering.current = readSelection(inline.current) ?? caretAtEnd(text);
		setExpanded(true);
	};

	/**
	 * All three close paths (done, the close button, Esc) come here. If only one of them had its own
	 * handling, only users taking that path would lose the caret. The position is read while the
	 * window's field is still mounted. Reading after unmount would require keeping a copy of the value
	 * somewhere, and that copy would run on every keystroke.
	 */
	const close = (): void => {
		returning.current = readSelection(surface.current);
		setExpanded(false);
	};

	/**
	 * Hands the caret over: to the window's field when opening, and back to the inline field when
	 * closing. The frame delay is needed in both directions. On open, the window is not yet attached
	 * to its portal, so the target node does not exist. On close, it would collide with the point
	 * where Base UI returns focus (`finalFocus`). Focus and caret are independent, since a textarea
	 * remembers its selection after losing focus, so the order of the two would not change the result.
	 * The delay just avoids drawing twice. The stored position is cleared after applying, or the next
	 * open would apply the old one again.
	 */
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const slot = expanded ? entering : returning;
			const target = expanded ? surface : inline;
			applySelection(target.current, slot.current);
			slot.current = null;
		});
		return () => cancelAnimationFrame(frame);
	}, [expanded]);

	return (
		<>
			<FieldFrame
				label={t("promptField.storySetup")}
				hint={hint}
				htmlFor={id}
				hintId={hintId}
				overflowId={overflowId}
				/*
				 * No character count is shown. The body goes to the world slot on publish
				 * (`buildStoryPublication`), and that field has no cap. Showing a count would make the number
				 * read as a limit.
				 */
				action={
					<Button type="button" variant="ghost" size="sm" onClick={open}>
						{promptExpand().open}
					</Button>
				}
			>
				<Textarea
					ref={inline}
					id={id}
					rows={PROMPT_FIELD_ROWS}
					value={text}
					placeholder={placeholder}
					aria-describedby={fieldDescribedBy([hint && hintId])}
					className={PROMPT_FIELD_GROWTH}
					onChange={(event) => edit(event.target.value)}
				/>
			</FieldFrame>

			{expanded && (
				<Dialog
					open
					/**
					 * Checks why the dialog is closing. Outside clicks and focus loss are not something the user
					 * said to this window (`lib/dialog/dismiss.ts`). Nothing is lost here, since autosave is
					 * already running. But this window is where the manuscript is written, so a stray gesture that
					 * makes the editing surface vanish is itself a problem.
					 */
					onOpenChange={(next, details) => {
						if (!next && shouldCloseDialog(details.reason, false)) close();
					}}
				>
					{/*
					 * The geometry is not moved into a constant. `dialog-geometry.test.ts` reads the characters of the
					 * opening
					 * tag to confirm that the box caps its own height, and a box hidden behind a constant would escape
					 * that
					 * check. The failure it guards against is silent: short content shows nothing, and once content
					 * overflows,
					 * a `fixed` box clips and its bottom edge can no longer be reached.
					 *
					 * On narrow screens the dialog fills the screen (`h-dvh`, no corners). From `sm` up it is a large
					 * box with
					 * margins, so the page behind stays visible and it reads as a window rather than a screen. `dvh`
					 * instead of
					 * `vh` for the same keyboard reason (`routes/__root.tsx`). `flex flex-col` replaces the default
					 * grid
					 * (`grid gap-6`), because the inner textarea must take all remaining height, which a grid cannot
					 * express.
					 */}
					<DialogContent
						className="flex h-dvh w-full max-w-full flex-col gap-4 rounded-none p-4 sm:h-[88dvh] sm:max-w-3xl sm:rounded-xl sm:p-6"
						/**
						 * Returns focus to the inline field when the window closes, so editing continues there. This
						 * pairs with the caret hand-over effect above.
						 */
						finalFocus={inline}
					>
						<DialogHeader>
							<DialogTitle>{promptExpand().title}</DialogTitle>
							<DialogDescription>
								{promptExpand().description}
							</DialogDescription>
						</DialogHeader>

						{/*
						 * The same value and the same `edit` as the inline field. Keeping out a second draft state is the
						 * whole point
						 * of this window, so there is no `useState` and no `Save` (save) here.
						 */}
						<Textarea
							ref={surface}
							aria-label={promptExpand().title}
							value={text}
							placeholder={placeholder}
							className={PROMPT_DIALOG_FIELD}
							onChange={(event) => edit(event.target.value)}
						/>

						<DialogFooter>
							<Button type="button" onClick={close}>
								{promptExpand().close}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

function readSelection(node: HTMLTextAreaElement | null): TextSelection | null {
	if (!node) return null;
	return { start: node.selectionStart, end: node.selectionEnd };
}

/**
 * Applies the handed-over caret position and gives focus. The value may have shrunk in the
 * meantime, so the position is clamped to the node's current length. The browser folds an
 * out-of-range position to the end rather than erroring, and that end is not where the user was.
 */
function applySelection(
	node: HTMLTextAreaElement | null,
	selection: TextSelection | null,
): void {
	if (!node || !selection) return;
	const at = clampTextSelection(selection, node.value.length);
	if (!at) return;
	node.focus();
	node.setSelectionRange(at.start, at.end);
}
