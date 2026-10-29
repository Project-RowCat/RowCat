import type { ChatCharacter, ChatRoom } from "@rowcat/chat";
import {
	CHAT_CHARACTER_MAX_PER_ROOM,
	CHAT_CHARACTER_NAME_MAX_LENGTH,
	CHAT_CHARACTER_PROMPT_MAX_LENGTH,
	ChatCharacterLimitError,
	checkCharacterName,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalCharacters } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";

/**
 * The **characters** surface of room settings: add characters to this conversation.
 *
 * ## Characters the story gave are not listed here
 *
 * The list shows **only characters added in this conversation.** The playback snapshot
 * (`room.seed.characters`) is immutable and cannot be edited (`ROOM_IMMUTABLE` in `sync-codec.ts`).
 * Mixing it in read-only would make the screen lie: a row beside it can be deleted, this one
 * cannot, and the user cannot see why. Instead, when the story has characters, the screen states
 * **only how many** in one line.
 *
 * Seed characters are always empty for v2 stories (the publication assembler always sends an empty
 * array), so that line actually appears only for rooms migrated from legacy.
 *
 * ## The form ends inside the same window
 *
 * No nested dialog is opened: the persona surface made the same call. The list and the form split
 * on the same surface, so Escape still has one target and the focus trap is still one.
 *
 * ## Saving is explicit
 *
 * This diverges from the generation and narration settings. Those write on each pick (the choices
 * are finite and reverting costs nothing), but what is written here is **text the user typed**.
 * Writing per keystroke would create one revision per character, and all of them would be synced.
 */
export function RoomSettingsCharacters({ room }: { room: ChatRoom }) {
	const { t } = useTranslation(["chat", "common"]);
	const { store } = useChatScope();
	const { items: characters, loading } = useLocalCharacters(room.id);
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
			if (failure instanceof ChatCharacterLimitError)
				setError(t("characters.limit", { limit: failure.limit }));
			else {
				console.error("[chat] couldn't save the character", failure);
				setError(t("characters.couldnTSaveTheCharacter"));
			}
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
					if (!store) return;
					const ok = await run(() =>
						editing === "new"
							? store.createCharacter({ roomId: room.id, ...values })
							: store.updateCharacter(editing.id, values),
					);
					if (ok) setEditing(null);
				}}
			/>
		);

	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">
				{t("characters.theseCharactersAppearOnlyIn")}
			</p>

			{/*
			 * Characters the story gave are **only counted.** Mixing them into the list would place a row
			 * that cannot be deleted among rows that can, and the user could not see the reason on screen.
			 */}
			{seedCount > 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("characters.seedCount", { count: seedCount })}
				</p>
			) : null}

			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}

			{loading ? (
				<p className="text-sm text-muted-foreground">
					{t("common:state.loading")}
				</p>
			) : characters.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("characters.noCharactersAddedYet")}
				</p>
			) : (
				<ul className="flex flex-col">
					{characters.map((character) => (
						<li
							key={character.id}
							className="-mx-2 flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{character.name}</p>
								{character.prompt ? (
									<p className="line-clamp-2 text-sm text-muted-foreground">
										{character.prompt}
									</p>
								) : null}
							</div>
							{/*
							 * The two buttons are **siblings of the row.** Wrapping the whole row in a button would put
							 * buttons inside a button, which is markup the browser rewrites.
							 */}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={t("characters.edit", { name: character.name })}
								onClick={() => setEditing(character)}
							>
								<Pencil className="size-4" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={t("characters.delete", { name: character.name })}
								onClick={() => {
									if (!store) return;
									void run(() => store.deleteCharacter(character.id));
								}}
							>
								<Trash2 className="size-4" />
							</Button>
						</li>
					))}
				</ul>
			)}

			<Button
				type="button"
				variant="outline"
				className="self-start"
				disabled={full}
				onClick={() => setEditing("new")}
			>
				<Plus className="size-4" /> {t("characters.addCharacter")}
			</Button>
			{full ? (
				<p className="text-sm text-muted-foreground">
					{t("characters.limit", { limit: CHAT_CHARACTER_MAX_PER_ROOM })}
				</p>
			) : null}
		</div>
	);
}

/**
 * The form for one character: two fields.
 *
 * Not reviving legacy's five fields (appearance, personality, speech, example lines) is the **same
 * judgment** v2 made when it folded the draft body into one field. When a field cannot answer its
 * question, it becomes an obstacle rather than a classification, and the user writes anywhere.
 */
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
	const { t } = useTranslation(["chat", "common"]);
	const nameId = useId();
	const promptId = useId();
	const [name, setName] = useState(character?.name ?? "");
	const [prompt, setPrompt] = useState(character?.prompt ?? "");
	const [saving, setSaving] = useState(false);

	/** The store checks the name rule again; here it is used only as the basis for locking the button. */
	const nameOk = checkCharacterName(name).ok;

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!nameOk || saving) return;
				setSaving(true);
				void onSave({ name, prompt }).finally(() => setSaving(false));
			}}
		>
			<div className="flex flex-col gap-1.5">
				<label htmlFor={nameId} className="text-sm font-medium">
					{t("characters.name")}
				</label>
				<Input
					id={nameId}
					value={name}
					maxLength={CHAT_CHARACTER_NAME_MAX_LENGTH}
					autoFocus
					onChange={(event) => setName(event.target.value)}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor={promptId} className="text-sm font-medium">
					{t("characters.description")}
				</label>
				<Textarea
					id={promptId}
					value={prompt}
					rows={8}
					maxLength={CHAT_CHARACTER_PROMPT_MAX_LENGTH}
					placeholder={t("characters.promptPlaceholder", { user: "{{user}}" })}
					onChange={(event) => setPrompt(event.target.value)}
				/>
				{/* Empty is still a complete value: a character with only a name is still a line on the cast list. */}
				<p className="text-xs text-muted-foreground">
					{t("characters.ifLeftEmptyOnlyThe")}
				</p>
			</div>

			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}

			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel}>
					{t("common:actions.cancel")}
				</Button>
				<Button type="submit" disabled={!nameOk || saving}>
					{character ? t("common:actions.save") : t("characters.add")}
				</Button>
			</div>
		</form>
	);
}
