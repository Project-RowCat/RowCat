import {
	activeScene,
	type ChatCharacter,
	type ChatMessage,
	type ChatRoom,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalScenes } from "#/lib/local-chat/hooks.ts";
import { latestMessage } from "./copy.ts";
import { SceneDialog } from "./dialog.tsx";

/**
 * Who is present right now, as one quiet chip above the composer, and the door to the scene
 * controls.
 *
 * **It is not in the header.** The header carries exactly two room triggers (find and conversation
 * settings, `chat-header-context.tsx`), and a third would blur what each one is. The scene is also a
 * fact about what is about to be said, so it reads best next to where it is said.
 *
 * In a room with no scene it says only "Scene" — neutral, not a call to action: most conversations
 * never need one and nothing about them changes. With a scene it names who is present (`activeScene`
 * from `@rowcat/chat`; "everyone" after a scene ended, "no character" for a narrator-only scene).
 *
 * The scene list is subscribed here (it is small) and handed to the window, so the chip and the
 * window never disagree about the scene in effect. The whole history is read only while the window
 * is open (`SceneDialog`).
 */
export function SceneChip({
	room,
	characters,
	messages,
	generating,
}: {
	room: ChatRoom;
	characters: readonly ChatCharacter[];
	/** The screen's message window; only its newest stored message is read. */
	messages: readonly ChatMessage[];
	generating: boolean;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const scenes = useLocalScenes(room.id);
	const [open, setOpen] = useState(false);
	const last = latestMessage(messages);
	const lastMessage = last ? { id: last.id, createdAt: last.createdAt } : null;
	const active = scenes.loading
		? null
		: activeScene(
				scenes.items,
				{ seed: room.seed, persona: room.persona, characters },
				lastMessage,
			);

	const state = !active
		? t("scene.chip.none")
		: active.audience.kind === "room"
			? t("scene.chip.everyone")
			: active.audience.kind === "narrator"
				? t("scene.chip.narrator")
				: t("scene.chip.participants", {
						names: active.names.join(", ") || t("scene.unknownNames"),
					});

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				className="max-w-full min-w-0 rounded-full px-2 text-muted-foreground"
				aria-label={t("scene.chipLabel", { state })}
				// Not before scenes answer: a chip that changes its words a frame later reads as an event.
				disabled={scenes.loading}
				onClick={() => setOpen(true)}
			>
				<Users aria-hidden="true" />
				<span className="truncate">{state}</span>
			</Button>
			{open && (
				<SceneDialog
					room={room}
					characters={characters}
					scenes={scenes.items}
					active={active}
					lastMessage={lastMessage}
					generating={generating}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}
