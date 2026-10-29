import type { ChatRoom } from "@rowcat/chat";
import {
	CHAT_USER_NOTE_MAX_LENGTH,
	ChatUserNoteError,
	checkChatUserNote,
	roomUserNote,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Notice, Text, Textarea } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	USER_NOTE_COUNTER_THRESHOLD,
	USER_NOTE_DESCRIPTION,
	USER_NOTE_PLACEHOLDER,
	USER_NOTE_SAVE_FAILURE_MESSAGE,
	USER_NOTE_TOO_LONG_MESSAGE,
	userNoteLength,
} from "./user-note-copy.ts";

/**
 * User-note pane of room settings; draws the same decisions as web. Saving is explicit, there is no
 * separate clear button (empty and save clears), and the limit blocks instead of truncating;
 * rationale in the header of `apps/web/src/features/chat/room-settings/user-note.tsx`. Only the
 * container differs.
 *
 * It does not hold the store: `useRoomManagement` is the single place that asks "is this store
 * still the active scope's" before an irreversible write, and repeating that per pane lets one miss
 * it (persona, narration and characters pass the same gate).
 */
export function RoomSettingsUserNote({
	room,
	onApply,
}: {
	room: ChatRoom;
	/** Empty is `null`, which clears the note. */
	onApply: (userNote: string | null) => Promise<unknown>;
}) {
	const stored = roomUserNote(room) ?? "";
	const [draft, setDraft] = useState(stored);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const checked = checkChatUserNote(draft);
	const length = userNoteLength(draft);
	/** Compares normalized values; raw comparison would count adding then removing a trailing newline as a change, and saving it would issue a revision and ride into sync. */
	const dirty = checked.ok && (checked.note ?? "") !== stored;

	return (
		<View style={styles.root}>
			<Text variant="caption" tone="muted-foreground">
				{USER_NOTE_DESCRIPTION}
			</Text>

			<Textarea
				label="User note"
				value={draft}
				placeholder={USER_NOTE_PLACEHOLDER}
				autoFocus
				onChangeText={setDraft}
			/>

			{/* Counter only near the limit (same rule and margin as web). */}
			{length >= USER_NOTE_COUNTER_THRESHOLD ? (
				<Text
					variant="caption"
					tone={checked.ok ? "muted-foreground" : "destructive"}
					style={styles.counter}
				>
					{length.toLocaleString("en-US")} /{" "}
					{CHAT_USER_NOTE_MAX_LENGTH.toLocaleString("en-US")}
				</Text>
			) : null}

			{/* Emptying clears; the screen must say so because there is no clear button. */}
			<Text variant="caption" tone="muted-foreground">
				Saving it empty clears this conversation's user note.
			</Text>

			{!checked.ok ? (
				<Notice message={USER_NOTE_TOO_LONG_MESSAGE} tone="destructive" />
			) : null}
			{error ? <Notice message={error} tone="destructive" /> : null}

			<View style={styles.actions}>
				<Button
					label="Save"
					disabled={!dirty}
					busy={saving}
					onPress={() => {
						if (!dirty || saving) return;
						setSaving(true);
						setError(null);
						void onApply(checked.ok ? checked.note : null)
							.catch((failure: unknown) => {
								/* The form already blocks over-limit, but the store does not trust the screen, so this branch keeps the same sentence. */
								setError(
									failure instanceof ChatUserNoteError
										? USER_NOTE_TOO_LONG_MESSAGE
										: USER_NOTE_SAVE_FAILURE_MESSAGE,
								);
							})
							.finally(() => setSaving(false));
					}}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	counter: { textAlign: "right" },
	actions: { flexDirection: "row", justifyContent: "flex-end" },
});
