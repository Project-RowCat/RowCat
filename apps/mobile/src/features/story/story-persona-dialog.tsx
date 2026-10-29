import type { ChatPersona, ChatPersonaSnapshot } from "@rowcat/chat";
import { personaSnapshotOf, samePersonaSnapshot } from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Dialog, DialogActions, Notice, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalPersonas } from "../../lib/local-data/use-personas.ts";
import { PersonaChoiceRow } from "../persona/persona-choice-row.tsx";
import { PersonaEditor } from "../persona/persona-editor.tsx";
import {
	PERSONA_SAVE_FAILURE_MESSAGE,
	PERSONA_STORY_DEFAULT_HINT,
	PERSONA_STORY_DEFAULT_LABEL,
} from "../persona/persona-form.ts";
import { usePersonaLibrary } from "../persona/use-persona-library.ts";

/**
 * The dialog where the user **picks the role they will play** before starting a conversation (the
 * counterpart of the web's `story-persona-dialog.tsx`).
 *
 * ## This dialog does not create a room
 *
 * Opening and starting are different actions, and that is all this component is about. Cancelling
 * creates no room and no navigation. If merely opening the picker left an empty room in the
 * conversation list, the user would have to clean up a conversation they never created.
 *
 * So `startStoryChat` still receives a **value that is already decided**. The order is this dialog,
 * then that function, never the reverse.
 *
 * ## The chosen value is not applied after the room is created
 *
 * The picked value is written in the **same transaction** as the room (an argument to
 * `createRoom`). If it were applied later, the story's default role would stand on the first frame
 * where the opening is drawn, and a user who sent a first turn in that gap would start a
 * conversation where the name differs from what the screen showed.
 *
 * ## If the library is empty, this dialog does not open
 *
 * The check lives at the call site (`use-story-start.tsx`). A dialog with only one thing to pick
 * adds a step and asks nothing — for someone who has never created a role, `Start conversation` starts
 * immediately, **exactly** as before this feature existed.
 *
 * ## Not stacked dialogs — two faces of one dialog
 *
 * Pressing `New persona` **changes this dialog's content** (the web made the same call). Showing the
 * form as a second dialog would give accessibility focus two owners, and Android back would become
 * unpredictable about which one it closes — `Dialog`'s `onBack` is where that face switch is
 * handled.
 */
export function StoryPersonaDialog({
	pending,
	onCancel,
	onStart,
}: {
	/** Starting is in progress — the dialog stays open and locked (the screen changes once navigation finishes). */
	pending: boolean;
	onCancel: () => void;
	/** `null` starts without an override (the story's suggestion applies). */
	onStart: (persona: ChatPersonaSnapshot | null) => void;
}) {
	const { value: personas } = useLocalPersonas();
	const library = usePersonaLibrary();
	/**
	 * The picked value — **the dialog's state, not a stored value.**
	 *
	 * `null` means "story default", so it is the initial value. The first library row is not
	 * pre-selected because that would be a choice the user never made — starting as-is would begin a
	 * conversation in a role they did not pick.
	 */
	const [selected, setSelected] = useState<ChatPersonaSnapshot | null>(null);
	const [creating, setCreating] = useState(false);
	const [saveFailure, setSaveFailure] = useState<string | null>(null);

	return (
		<Dialog
			title={creating ? "New persona" : "In this conversation, I am"}
			description={
				creating
					? "Once created, it's applied to this conversation right away."
					: "The chosen role's name becomes the speaker of your lines, and its description goes into the setting the model reads."
			}
			open
			/** Does not close while starting — the screen changes entirely once navigation finishes. */
			onOpenChange={(next) => {
				if (!next && !pending) onCancel();
			}}
			onBack={creating ? () => setCreating(false) : undefined}
			backLabel="Back to choosing"
			placement="adaptive"
			scroll
			bodyKey={creating ? "create" : "pick"}
		>
			{creating ? (
				<PersonaEditor
					persona={null}
					onCancel={() => {
						setCreating(false);
						setSaveFailure(null);
					}}
					onSave={async (value) => {
						setSaveFailure(null);
						const outcome = await library.create(value);
						/**
						 * **The created value is selected on the spot.** Making the user find it again in the list
						 * after saving would have them repeat what they just did. What is passed is a value, not a
						 * record (`ChatPersonaSnapshot`), so even if creation lost its scope (`foreign`), the
						 * selected value stays valid — it just does not persist in the library, and this conversation
						 * still starts with that role.
						 */
						setSelected(value);
						setCreating(false);
						if (outcome === "foreign")
							setSaveFailure(PERSONA_SAVE_FAILURE_MESSAGE);
					}}
				/>
			) : (
				<View style={picker.root}>
					{/**
					 * The first row is **the role the work suggests**, and it is the conversation's starting state.
					 *
					 * The name of that role is **not stated here**, because it is not known yet: the value lives
					 * in the play snapshot, which is fetched only after pressing start (step 2 of `startStoryChat`).
					 * Fetching it in advance would turn opening this dialog into a server round trip, and the
					 * request would go out even for someone who cancels.
					 */}
					<PersonaChoiceRow
						title={PERSONA_STORY_DEFAULT_LABEL}
						subtitle={PERSONA_STORY_DEFAULT_HINT}
						selected={selected === null}
						onPress={() => setSelected(null)}
					/>
					{personas.map((persona: ChatPersona) => (
						<PersonaChoiceRow
							key={persona.id}
							title={persona.name}
							subtitle={persona.description || null}
							/** A value comparison — the snapshot has no id, so there is no key to look it up by. */
							selected={samePersonaSnapshot(selected, persona)}
							onPress={() => setSelected(personaSnapshotOf(persona))}
						/>
					))}

					{saveFailure ? (
						<Notice tone="destructive" message={saveFailure} />
					) : null}

					<Button
						label="New persona"
						variant="ghost"
						fullWidth
						disabled={pending || library.store === null}
						onPress={() => setCreating(true)}
					/>

					<DialogActions>
						<Button
							label="Cancel"
							variant="outline"
							fullWidth
							disabled={pending}
							onPress={onCancel}
							style={picker.action}
						/>
						<Button
							label="Start conversation"
							fullWidth
							busy={pending}
							disabled={pending}
							onPress={() => onStart(selected)}
							style={picker.action}
						/>
					</DialogActions>
					<Text variant="caption" tone="muted-foreground">
						You can change this later in conversation settings.
					</Text>
				</View>
			)}
		</Dialog>
	);
}

const picker = StyleSheet.create({
	root: { gap: space.sm },
	/** Fills the row in a vertically stacked action group — replaces `flex: 1` from a horizontal row. */
	action: { alignSelf: "stretch" },
});
