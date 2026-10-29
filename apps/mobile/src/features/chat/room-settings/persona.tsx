import type { ChatPersona, ChatPersonaSnapshot, ChatRoom } from "@rowcat/chat";
import {
	chatPersonaOrigin,
	personaSnapshotOf,
	samePersonaSnapshot,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Notice, Spinner, Text } from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalPersonas } from "../../../lib/local-data/use-personas.ts";
import { PersonaChoiceRow } from "../../persona/persona-choice-row.tsx";
import {
	PERSONA_APPLY_FAILURE_MESSAGE,
	PERSONA_EMPTY_BODY,
	PERSONA_EMPTY_TITLE,
	PERSONA_NONE_LABEL,
	PERSONA_STORY_DEFAULT_LABEL,
} from "../../persona/persona-form.ts";

/** The form this pane used to export moved to `features/persona/persona-editor.tsx` (it has two consumers). */
export { PersonaEditor } from "../../persona/persona-editor.tsx";

/**
 * Pane for picking the role I play in this conversation, plus library management. Same place, list
 * and three states as web's `features/chat/room-settings/persona.tsx`; only render code differs and
 * `@rowcat/chat` answers ordering, validation and snapshot copying.
 *
 * Create/edit/delete also end here, even though `/settings/personas` now exists, so fixing a role
 * while configuring a room does not send the user to another part of the app (web does the same).
 *
 * Picking copies a value: pressing a row sends `{ name, description }` to the room, not the library
 * id (`personaSnapshotOf` -> `ChatStore.setRoomPersona`). Later edits or deletes of the row leave
 * this conversation alone, and applying an edit here requires picking again. Rationale: the
 * `persona.ts` header in `@rowcat/chat`.
 *
 * The row at the head of the list clears rather than picks: `Story's default persona` sets the room override to
 * `null` (the parent value is not copied). If the work suggests nothing it reads `Not set` and the
 * assembler uses the product default name; `User` is not faked as a library entry.
 */

export function RoomSettingsPersona({
	room,
	onEdit,
	onCreate,
	onApply,
}: {
	room: ChatRoom;
	/** Goes one pane deeper to edit this role (no new window). */
	onEdit: (persona: ChatPersona) => void;
	onCreate: () => void;
	/** `null` clears the override. */
	onApply: (persona: ChatPersonaSnapshot | null) => Promise<unknown>;
}) {
	const { value: personas, status } = useLocalPersonas();
	const [error, setError] = useState<string | null>(null);
	/** Blocks a second press in the same tick; `setState` only shows on the next render. */
	const applyingRef = useRef(false);

	const current = room.persona ?? null;
	const origin = chatPersonaOrigin(room);
	const suggested = room.seed.persona;

	const apply = (persona: ChatPersonaSnapshot | null) => {
		if (applyingRef.current) return;
		applyingRef.current = true;
		setError(null);
		void onApply(persona)
			.catch(() => setError(PERSONA_APPLY_FAILURE_MESSAGE))
			.finally(() => {
				applyingRef.current = false;
			});
	};

	return (
		<View style={styles.root}>
			{/* First row clears the override; it heads the list because it is the room's starting state, and the subtitle shows its name differs per work. */}
			<PersonaChoiceRow
				title={suggested ? PERSONA_STORY_DEFAULT_LABEL : PERSONA_NONE_LABEL}
				subtitle={suggested ? suggested.name : null}
				selected={origin !== "room"}
				onPress={() => apply(null)}
			/>

			<Text variant="caption" weight="medium" tone="muted-foreground">
				My persona
			</Text>

			{status === "loading" ? (
				<Spinner />
			) : personas.length === 0 ? (
				/* The empty state says what the feature does first; a bare "none" line leaves users closing the pane without knowing what they can create. */
				<View style={styles.empty}>
					<Text variant="body" weight="medium">
						{PERSONA_EMPTY_TITLE}
					</Text>
					<Text variant="label" tone="muted-foreground">
						{PERSONA_EMPTY_BODY}
					</Text>
				</View>
			) : (
				personas.map((persona) => (
					<PersonaChoiceRow
						key={persona.id}
						title={persona.name}
						subtitle={persona.description || null}
						/* Selection is a value comparison (`samePersonaSnapshot`): the room holds a copy with no id to trace back, and two rows with the same name and description both showing selected are genuinely indistinguishable. */
						selected={
							origin === "room" && samePersonaSnapshot(current, persona)
						}
						onPress={() => apply(personaSnapshotOf(persona))}
						onEdit={() => onEdit(persona)}
						editLabel={`Edit persona ${persona.name}`}
					/>
				))
			)}

			{error ? <Notice tone="destructive" message={error} /> : null}

			<Button
				label="New persona"
				variant="outline"
				fullWidth
				onPress={onCreate}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	empty: { gap: space.xs, paddingVertical: space.sm },
});
