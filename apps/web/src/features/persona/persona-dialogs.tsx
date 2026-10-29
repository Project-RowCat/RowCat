import type { ChatPersona } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { PersonaEditor } from "./persona-editor.tsx";
import {
	personaDeleteFailureMessage,
	personaDeleteNotice,
	personaSaveFailureMessage,
} from "./persona-form.ts";

/**
 * The two library dialogs: create or edit, and delete confirmation. The form itself is
 * PersonaEditor, which room settings also use. This file provides the container and knows when a
 * save has actually finished.
 */

export function PersonaFormDialog({
	persona,
	onClose,
	onSave,
}: {
	persona: ChatPersona | null;
	onClose: () => void;
	/** On success the dialog closes. If onSave throws, the error stays inside this dialog. */
	onSave: (value: { name: string; description: string }) => Promise<unknown>;
}) {
	const { t } = useTranslation("persona");
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const submit = (value: { name: string; description: string }): void => {
		setPending(true);
		setFailure(null);
		void onSave(value)
			.then(onClose)
			.catch((error: unknown) => {
				console.error("[persona] could not save the persona", error);
				setPending(false);
				setFailure(personaSaveFailureMessage());
			});
	};

	return (
		<Dialog
			open
			/**
			 * Checks why the dialog is closing. A dialog opened from a menu item would close right away:
			 * when the menu returns focus to its trigger, that looks like an outside click.
			 * shouldCloseDialog(reason, pending) decides, and the same function blocks closing while a save
			 * is pending (lib/dialog/dismiss.ts).
			 */
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}
			>
				<DialogHeader className="min-w-0">
					<DialogTitle>
						{persona ? t("dialog.editTitle") : t("dialog.newTitle")}
					</DialogTitle>
					<DialogDescription>
						{t("dialog.description", { userToken: "{{user}}" })}
					</DialogDescription>
				</DialogHeader>
				<PersonaEditor
					initial={persona}
					submitLabel={persona ? t("dialog.save") : t("dialog.create")}
					pending={pending}
					failure={failure}
					onCancel={onClose}
					onSubmit={submit}
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The delete confirmation says what does not disappear. Deleting a persona from the library does
 * not affect conversations already started, because a room keeps its own copy of the value. Without
 * saying so, some users would not delete for fear of breaking chats, and others would see a working
 * chat after deletion and conclude the deletion failed.
 */
export function PersonaDeleteDialog({
	persona,
	onClose,
	onDelete,
}: {
	persona: Pick<ChatPersona, "name">;
	onClose: () => void;
	onDelete: () => Promise<void>;
}) {
	const { t } = useTranslation(["persona", "common"]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/**
	 * One confirmation performs one deletion. Even if the operation is idempotent, a screen that runs
	 * twice is confusing. pendingRef blocks a second run.
	 */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onDelete();
			onClose();
		} catch (failure) {
			console.error("[persona] could not delete the persona", failure);
			setError(personaDeleteFailureMessage());
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader className="min-w-0">
					{/* The title says what the dialog does. Color alone does not convey the action. */}
					<DialogTitle>{t("dialog.deleteTitle")}</DialogTitle>
					<DialogDescription className="break-words">
						<Trans
							t={t}
							i18nKey="dialog.deleteBody"
							values={{ name: persona.name, notice: personaDeleteNotice() }}
							components={{
								name: <span className="font-medium text-foreground" />,
							}}
						/>
					</DialogDescription>
				</DialogHeader>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => void confirm()}
						disabled={pending}
					>
						{pending ? t("dialog.deleting") : t("common:actions.delete")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Which dialog is open. The library screen and the picker use this same shape. */
export type PersonaDialogTarget =
	| { kind: "create" }
	| { kind: "edit"; persona: ChatPersona }
	| { kind: "delete"; persona: ChatPersona };
