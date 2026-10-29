import type { ChatRole } from "@rowcat/chat";
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
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	editDialogDescription,
	editFailureMessage,
	editWarningCopy,
	planMessageEdit,
} from "./actions.ts";

/**
 * Edits one saved message, whether a user utterance or an assistant response.
 *
 * - The input box is not reused: it holds the draft, composition state and send/stop, and lending
 *   it to editing would make it unclear what remains when an edit is cancelled. The dialog opens
 *   and closes on its own.
 * - It edits the saved original (the record's `content`), not the rendered text. Editing a
 *   rendered result would drop the original on save.
 * - The warning sits under the input, not next to the save button, so what the action deletes is
 *   read before pressing.
 * - It does not close before the save finishes. IndexedDB writes can fail (quota, a connection
 *   closed during an account switch), and a failure after closing would make an undeleted
 *   conversation look deleted.
 */

export function EditMessageDialog({
	content,
	role,
	later,
	onClose,
	onSave,
}: {
	/** Saved original text, as it was when the dialog opened. */
	content: string;
	/**
	 * Role of the message being edited. Only the copy reads it: the form and validation are the same
	 * for both (`planMessageEdit` ignores role), and choosing what to save is the caller's job, so
	 * this component stays unaware of storage. The story test reuses the same form.
	 */
	role: ChatRole;
	/** Number of messages after this one that saving will delete. */
	later: number;
	onClose: () => void;
	/** Resolves on success. A failure propagates and becomes the message shown below. */
	onSave: (next: string) => Promise<void>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	/**
	 * One id per dialog instance: a module-level constant would make `aria-describedby` read a
	 * neighbouring dialog's text when two overlap (see `rename-room-dialog.tsx`).
	 */
	const errorId = useId();
	const warningId = useId();
	const [draft, setDraft] = useState(content);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	/**
	 * Blocks a second submit in the same tick (Enter and click can overlap). `setState` lands too late
	 * to stop it, so both calls would see `pending === false`.
	 */
	const pendingRef = useRef(false);

	/**
	 * Places the caret at the end, not a full selection as rename does: edits usually touch one part,
	 * and a full selection would make the first keystroke erase the message.
	 */
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	const warning = editWarningCopy(later);

	const submit = async (): Promise<void> => {
		if (pendingRef.current) return;
		/**
		 * A pure function decides what to do (`message-actions.ts`). Writing the three branches (rule
		 * violation, no change, save) inline in the form would make them impossible to check without
		 * rendering.
		 */
		const plan = planMessageEdit(draft, content, later);
		if (plan.kind === "invalid") {
			setError(plan.message);
			inputRef.current?.focus();
			return;
		}
		if (plan.kind === "unchanged") {
			onClose();
			return;
		}

		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onSave(plan.content);
		} catch (failure) {
			// Keep the dialog open on failure; if it closed first, the user would have nowhere to see the
			// result.
			console.error("[chat] couldn't edit the message", failure);
			setError(editFailureMessage());
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			/**
			 * Checks why it is closing. A dialog opened from a menu item closes right away: the menu returns
			 * focus to its trigger, which looks like an outside press (`lib/dialog/dismiss.ts`).
			 */
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}
			>
				<DialogHeader>
					<DialogTitle>{t("editDialog.editMessage")}</DialogTitle>
					{/*
					 * The copy is chosen by role (`editDialogDescription`). A single sentence would make someone editing an assistant response read "I am editing my message".
					 */}
					<DialogDescription>{editDialogDescription(role)}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1.5">
					<Textarea
						ref={inputRef}
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							// Typing clears the previous failure message, which no longer describes the current state.
							if (error) setError(null);
						}}
						/*
						 * Enter does not save. The text is multi-line and Enter was the newline key; changing its
						 * meaning only here would make a hand splitting paragraphs trigger an irreversible action.
						 */
						aria-label={t("editDialog.messageContent")}
						aria-invalid={error !== null}
						aria-describedby={error ? errorId : warning ? warningId : undefined}
						disabled={pending}
						rows={4}
						className="max-h-64 min-h-24 resize-none overflow-y-auto"
					/>
					{error ? (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : (
						warning && (
							<p id={warningId} className="text-sm text-muted-foreground">
								{warning}
							</p>
						)
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button onClick={() => void submit()} disabled={pending}>
						{pending ? t("saving") : t("common:actions.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
