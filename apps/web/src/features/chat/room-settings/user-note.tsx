import type { ChatRoom } from "@rowcat/chat";
import {
	CHAT_USER_NOTE_MAX_LENGTH,
	ChatUserNoteError,
	checkChatUserNote,
	roomUserNote,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "#/lib/i18n/format.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import {
	USER_NOTE_COUNTER_THRESHOLD,
	userNoteDescription,
	userNoteLength,
	userNotePlaceholder,
	userNoteSaveFailureMessage,
	userNoteTooLongMessage,
} from "./user-note-copy.ts";

/**
 * The user-note section of room settings: the user writes how this conversation should proceed.
 *
 * Saving is explicit. Generation settings and narration save on selection, because their choices
 * are finite and reverting costs nothing. Typed text would create one synced revision per keystroke
 * if saved per character. There is also no debounced autosave: the draft editor has one because
 * that screen is hours of work, whereas this window closes, and whether closing saves must not
 * depend on timing.
 *
 * Emptying the field and saving removes the note. There is no separate clear button; that empty
 * save is the only representation of 'none' (applyRoomUserNote). A second button would be a second
 * path to the same result, with only one of them confirmed. There is no confirmation dialog either,
 * because the text stays visible on screen as editable content, and a dialog would appear on every
 * typo fix.
 *
 * The limit blocks rather than truncates: silent truncation on paste would hide lost text. The form
 * shows the over-limit state and locks save (checkChatUserNote; the store checks again).
 */
export function RoomSettingsUserNote({ room }: { room: ChatRoom }) {
	const { t } = useTranslation(["chat", "common"]);
	const { store } = useChatScope();
	const noteId = useId();
	const stored = roomUserNote(room) ?? "";
	const [draft, setDraft] = useState(stored);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const checked = checkChatUserNote(draft);
	const length = userNoteLength(draft);
	/**
	 * Compare what would be saved in normalized form. Comparing raw text would count adding and
	 * removing a trailing newline as a change, and that save would issue a revision that gets synced.
	 * The stored value is normalized anyway, so equal normalized values mean nothing actually changed.
	 */
	const dirty = checked.ok && (checked.note ?? "") !== stored;

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!store || !dirty || saving) return;
				setSaving(true);
				setError(null);
				void store
					.setRoomUserNote(room.id, draft)
					.catch((failure: unknown) => {
						/*
						 * The form already blocks over-limit input, so this should not happen. If it does, the same
						 * sentence is shown: the store does not trust the screen, and this branch is where that
						 * shows.
						 */
						if (failure instanceof ChatUserNoteError)
							setError(userNoteTooLongMessage());
						else {
							console.error("[chat] couldn't save the user note", failure);
							setError(userNoteSaveFailureMessage());
						}
					})
					.finally(() => setSaving(false));
			}}
		>
			<p className="text-sm text-muted-foreground">{userNoteDescription()}</p>

			<div className="flex flex-col gap-1.5">
				<label htmlFor={noteId} className="text-sm font-medium">
					{t("userNote.userNote")}
				</label>
				<Textarea
					id={noteId}
					value={draft}
					rows={10}
					autoFocus
					placeholder={userNotePlaceholder()}
					onChange={(event) => setDraft(event.target.value)}
				/>
				{/*
				 * The count appears only when the limit is near (same rule as the memory form). Once the limit is
				 * passed, the sentence below
				 * states it, so only the color changes here.
				 */}
				{length >= USER_NOTE_COUNTER_THRESHOLD ? (
					<p
						className={
							checked.ok
								? "text-right text-xs text-muted-foreground"
								: "text-right text-xs text-destructive"
						}
					>
						{formatNumber(length)} / {formatNumber(CHAT_USER_NOTE_MAX_LENGTH)}
					</p>
				) : null}
				{/* The screen says that emptying the field means deleting, because there is no button for it. */}
				<p className="text-xs text-muted-foreground">
					{t("userNote.savingItEmptyClearsThis")}
				</p>
			</div>

			{!checked.ok ? (
				<p className="text-sm text-destructive" role="alert">
					{userNoteTooLongMessage()}
				</p>
			) : null}

			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}

			<div className="flex justify-end">
				<Button type="submit" disabled={!dirty || saving}>
					{t("common:actions.save")}
				</Button>
			</div>
		</form>
	);
}
