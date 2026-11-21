import {
	activeScene,
	type ChatCharacter,
	type ChatMessage,
	type ChatRoom,
	type ChatScene,
	type ChatStore,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button } from "@rowcat/ui-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalLive } from "../../../lib/local-data/live.ts";
import { chatGutter } from "../chat-rhythm.ts";
import { latestMessage, SCENE_COPY } from "./copy.ts";
import { SceneDialog } from "./dialog.tsx";

/**
 * Who is present right now, as one quiet line above the composer, and the door to the scene
 * controls (web's `scene/chip.tsx` is the pair).
 *
 * **It is not in the header.** The open room's header carries exactly two actions, find and
 * conversation settings, and a static scan holds that (`lib/boundaries.test.ts`). The scene is also
 * a fact about what is about to be said, so it reads best next to where it is said.
 *
 * In a room with no scene it says only "Scene" — neutral, not a call to action. With a scene it
 * names who is present (`activeScene` from `@rowcat/chat`).
 *
 * The scene list is subscribed here (it is small) and handed to the window, so the line and the
 * window never disagree about the scene in effect. The whole history is read only while the window
 * is open (`SceneDialog`).
 */
export function SceneBar({
	room,
	store,
	characters,
	messages,
	generating,
}: {
	room: ChatRoom;
	store: ChatStore;
	characters: readonly ChatCharacter[];
	/** The screen's message window; only its newest stored message is read. */
	messages: readonly ChatMessage[];
	generating: boolean;
}) {
	const load = useMemo(() => () => store.listScenes(room.id), [store, room.id]);
	const scenes = useLocalLive<ChatScene[]>(load, NO_SCENES);
	const [open, setOpen] = useState(false);
	const last = latestMessage(messages);
	const lastMessage = last ? { id: last.id, createdAt: last.createdAt } : null;
	const ready = scenes.status === "ready";
	const active = ready
		? activeScene(
				scenes.value,
				{ seed: room.seed, persona: room.persona, characters },
				lastMessage,
			)
		: null;

	const state = !active
		? SCENE_COPY.chipNone
		: active.audience.kind === "room"
			? SCENE_COPY.chipEveryone
			: active.audience.kind === "narrator"
				? SCENE_COPY.chipNarrator
				: active.names.join(", ") || SCENE_COPY.unknownNames;

	return (
		<View style={bar.root}>
			<Button
				label={state}
				icon="account"
				variant="ghost"
				size="sm"
				accessibilityLabel={SCENE_COPY.chipLabel(state)}
				// Not before scenes answer: a line that changes its words a moment later reads as an event.
				disabled={!ready}
				onPress={() => setOpen(true)}
				style={bar.trigger}
			/>
			{open ? (
				<SceneDialog
					room={room}
					characters={characters}
					scenes={scenes.value}
					active={active}
					lastMessage={lastMessage}
					generating={generating}
					store={store}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</View>
	);
}

/** Stable empty array; a fresh one per render would redraw every time. */
const NO_SCENES: ChatScene[] = [];

const bar = StyleSheet.create({
	// Same horizontal axis as the list and the composer (`chat-rhythm.ts`).
	root: {
		alignItems: "flex-start",
		paddingBottom: space.xs,
		paddingHorizontal: chatGutter,
	},
	trigger: { maxWidth: "100%" },
});
