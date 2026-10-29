import type { ChatCharacter, ChatRoom } from "@rowcat/chat";
import {
	CHAT_CHARACTER_MAX_PER_ROOM,
	CHAT_CHARACTER_NAME_MAX_LENGTH,
	CHAT_CHARACTER_PROMPT_MAX_LENGTH,
	ChatCharacterLimitError,
	checkCharacterName,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Icon, Input, Notice, Text, Textarea } from "@rowcat/ui-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * The characters pane of room settings; same decisions as the web's pane of the same name. Story
 * characters are absent from the list, the form splits on the same pane, and saving is explicit;
 * rationale is in the header of `apps/web/src/features/chat/room-settings/characters.tsx`. Only the
 * container differs.
 */
export function RoomSettingsCharacters({
	room,
	characters,
	loading,
	onCreate,
	onUpdate,
	onDelete,
}: {
	room: ChatRoom;
	/** List from the subscription; ordering is the store's (`sortCharacters`). */
	characters: readonly ChatCharacter[];
	loading: boolean;
	onCreate: (values: { name: string; prompt: string }) => Promise<unknown>;
	onUpdate: (
		id: string,
		values: { name: string; prompt: string },
	) => Promise<unknown>;
	onDelete: (id: string) => Promise<unknown>;
}) {
	const [editing, setEditing] = useState<ChatCharacter | "new" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const seedCount = room.seed.characters.length;
	const full = characters.length >= CHAT_CHARACTER_MAX_PER_ROOM;

	const run = async (task: () => Promise<unknown>): Promise<boolean> => {
		setError(null);
		try {
			await task();
			return true;
		} catch (failure) {
			setError(
				failure instanceof ChatCharacterLimitError
					? `Up to ${failure.limit} characters can be added.`
					: "Couldn't save the character. Please try again.",
			);
			return false;
		}
	};

	if (editing)
		return (
			<CharacterForm
				character={editing === "new" ? null : editing}
				error={error}
				onCancel={() => {
					setError(null);
					setEditing(null);
				}}
				onSave={async (values) => {
					const ok = await run(() =>
						editing === "new" ? onCreate(values) : onUpdate(editing.id, values),
					);
					if (ok) setEditing(null);
				}}
			/>
		);

	return (
		<View style={styles.root}>
			<Text variant="caption" tone="muted-foreground">
				Characters who appear only in this conversation. They don't affect other
				conversations or the original story.
			</Text>

			{/* Story characters are stated by count only; mixed into the list they would be rows that cannot be deleted. */}
			{seedCount > 0 ? (
				<Text variant="caption" tone="muted-foreground">
					The story's {seedCount} characters keep appearing separately from this
					list.
				</Text>
			) : null}

			{error ? <Notice message={error} tone="destructive" /> : null}

			{loading ? (
				<Text variant="caption" tone="muted-foreground">
					Loading…
				</Text>
			) : characters.length === 0 ? (
				<Text variant="caption" tone="muted-foreground">
					No characters added yet.
				</Text>
			) : (
				<View>
					{characters.map((character) => (
						<View key={character.id} style={styles.row}>
							{/* The whole row is the edit target; delete stands apart so the irreversible action is not hit by accident. */}
							<Pressable
								style={styles.rowBody}
								accessibilityRole="button"
								accessibilityLabel={`Edit ${character.name}`}
								onPress={() => setEditing(character)}
							>
								<Text variant="body" numberOfLines={1}>
									{character.name}
								</Text>
								{character.prompt ? (
									<Text
										variant="caption"
										tone="muted-foreground"
										numberOfLines={2}
									>
										{character.prompt}
									</Text>
								) : null}
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Delete ${character.name}`}
								onPress={() => void run(() => onDelete(character.id))}
								style={styles.rowAction}
							>
								<Icon name="delete" size="sm" />
							</Pressable>
						</View>
					))}
				</View>
			)}

			<Button
				label="Add character"
				variant="secondary"
				disabled={full}
				onPress={() => setEditing("new")}
			/>
			{full ? (
				<Text variant="caption" tone="muted-foreground">
					You can add up to {CHAT_CHARACTER_MAX_PER_ROOM} characters.
				</Text>
			) : null}
		</View>
	);
}

/** One character's form: two fields, not five, for the same reason as the web. */
function CharacterForm({
	character,
	error,
	onCancel,
	onSave,
}: {
	character: ChatCharacter | null;
	error: string | null;
	onCancel: () => void;
	onSave: (values: { name: string; prompt: string }) => Promise<void>;
}) {
	const [name, setName] = useState(character?.name ?? "");
	const [prompt, setPrompt] = useState(character?.prompt ?? "");
	const [saving, setSaving] = useState(false);

	/** The store re-checks the name rule; here it only decides whether to lock the button. */
	const nameOk = checkCharacterName(name).ok;

	return (
		<View style={styles.root}>
			<Input
				label="Name"
				value={name}
				maxLength={CHAT_CHARACTER_NAME_MAX_LENGTH}
				autoFocus
				onChangeText={setName}
			/>
			<Textarea
				label="Description"
				value={prompt}
				maxLength={CHAT_CHARACTER_PROMPT_MAX_LENGTH}
				placeholder="Write freely about anything you want to say about this character, such as looks, personality, speech, or their relationship with {{user}}."
				onChangeText={setPrompt}
			/>
			{/* Empty is a complete value: a name-only character is still a line on the cast list. */}
			<Text variant="caption" tone="muted-foreground">
				Leave it empty and only the name goes on the cast list.
			</Text>

			{error ? <Notice message={error} tone="destructive" /> : null}

			<View style={styles.actions}>
				<Button label="Cancel" variant="ghost" onPress={onCancel} />
				<Button
					label={character ? "Save" : "Add"}
					disabled={!nameOk}
					busy={saving}
					onPress={() => {
						if (!nameOk || saving) return;
						setSaving(true);
						void onSave({ name, prompt }).finally(() => setSaving(false));
					}}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	row: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
	rowBody: { flex: 1, gap: space.px, paddingVertical: space.xs },
	rowAction: { padding: space.xs },
	actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm },
});
