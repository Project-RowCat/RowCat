import {
	CHAT_CHARACTER_MAX_PER_ROOM,
	ChatCharacterLimitError,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { characterSaveFailureMessage } from "./character-copy.ts";
import { CharacterForm } from "./characters.tsx";

/**
 * Quick add: put a character into this conversation **without leaving the sentence being written.**
 * The composer's leading button opens it (`chat-page.tsx`).
 *
 * ## Nothing here is new except the window
 *
 * The form is the settings pane's (`CharacterForm`), the write is the same
 * `ChatStore.createCharacter`, and a failure becomes the same sentence
 * (`characterSaveFailureMessage`). So the record that lands is the one the settings pane would have
 * made: a child of this room, synced as `chat.character`, and read by the next generation's cast
 * block and by `{{char}}` (`docs/chat/CHARACTERS.md`). This file only knows when a save has really
 * finished — the same split as `PersonaFormDialog` around `PersonaEditor`.
 *
 * ## It only adds
 *
 * No list, edit or delete. Those stay in conversation settings, and the description says where. A
 * list here would make a second management screen for the same records, and the two would then have
 * to agree on ordering, the story's characters line and every failure. The story's own characters
 * are not mentioned at all: nothing here can change them.
 *
 * ## Why not room settings opened on that pane
 *
 * Settings opens on home by design (`view.ts`), and after a save its pane goes back to the list —
 * one more window between the person and the sentence they were writing. Here a save closes the
 * window, and focus returns to the field it came from (the composer's button does not take it).
 */
export function AddCharacterDialog({
	roomId,
	characterCount,
	onClose,
}: {
	/** The room whose cast grows. The screen draws this window only while that room exists. */
	roomId: string;
	/**
	 * How many characters this room holds as the window opens — from the list the conversation screen
	 * already subscribes to. It is not read again here (see `full` below).
	 */
	characterCount: number;
	onClose: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const { store, ownsStore } = useChatScope();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	/**
	 * Closes the window **if the scope closes while it is open** (sign-out, account switch), the same
	 * shape as the memory window. The save below checks ownership again; this check comes first.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: close only at the moment the scope changes.
	useEffect(() => {
		if (!store) onClose();
	}, [store]);

	/**
	 * At the cap the form is not offered at all, as the settings pane disables its add button. Letting
	 * someone write a whole card and refusing it at the end would throw that text away. The store
	 * still refuses on its own (`ChatCharacterLimitError`) — this only spares the typing.
	 *
	 * **Decided once, as the window opens.** Its own subscription would answer a frame late: the form
	 * would be drawn first and swapped for this notice, after the window had already chosen the form's
	 * field to focus — focus then stayed on the composer behind the window. Following the count live
	 * would also let another device's sync swap out a card mid-typing; a cap reached meanwhile is the
	 * store's refusal at save, with the text still in the form.
	 */
	const [full] = useState(() => characterCount >= CHAT_CHARACTER_MAX_PER_ROOM);

	const save = async (values: {
		name: string;
		prompt: string;
	}): Promise<void> => {
		/**
		 * The write goes to the store **that is still this scope's**. Swapping in whichever store is open
		 * now would let an add started on Alice's screen land in Bob's database.
		 */
		if (!store || !ownsStore(store)) {
			onClose();
			return;
		}
		setPending(true);
		setError(null);
		try {
			await store.createCharacter({ roomId, ...values });
		} catch (failure) {
			if (!(failure instanceof ChatCharacterLimitError))
				console.error("[chat] couldn't save the character", failure);
			// The window stays with the typed text, so the same card can be saved again.
			setError(characterSaveFailureMessage(failure));
			setPending(false);
			return;
		}
		onClose();
	};

	return (
		<Dialog
			open
			/**
			 * Typed text is lost on close, so only an explicit choice closes this window — never an outside
			 * press — and nothing closes it while a save is running (`lib/dialog/dismiss.ts`).
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
					<DialogTitle>{t("characters.addCharacter")}</DialogTitle>
					<DialogDescription>
						{t("characters.quickAddDescription")}
					</DialogDescription>
				</DialogHeader>
				{full ? (
					<>
						<p className="text-sm text-muted-foreground">
							{t("characters.limit", { limit: CHAT_CHARACTER_MAX_PER_ROOM })}
						</p>
						<DialogFooter>
							<Button variant="outline" onClick={onClose}>
								{t("common:actions.close")}
							</Button>
						</DialogFooter>
					</>
				) : (
					<CharacterForm
						character={null}
						/*
						 * The window puts focus on the first field itself, after recording where focus came from — the
						 * composer's input. The form's own autofocus would run first and spoil that record, and closing
						 * would then leave focus on the page rather than in the sentence being written.
						 */
						autoFocus={false}
						error={error}
						onCancel={() => {
							if (!pending) onClose();
						}}
						onSave={save}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
