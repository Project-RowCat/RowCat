import type { ChatPersona, ChatPersonaSnapshot, ChatRoom } from "@rowcat/chat";
import {
	chatPersonaOrigin,
	personaSnapshotOf,
	samePersonaSnapshot,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Link } from "@tanstack/react-router";
import { Check, ExternalLink, Pencil, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonaEditor } from "#/features/persona/persona-editor.tsx";
import {
	personaApplyFailureMessage,
	personaEmptyBody,
	personaNoneLabel,
	personaSaveFailureMessage,
	personaStoryDefaultLabel,
} from "#/features/persona/persona-form.ts";
import { usePersonaLibrary } from "#/features/persona/use-persona-library.ts";
import { useLocalPersonas } from "#/lib/local-chat/hooks.ts";

/**
 * Persona section of room settings: choose the role this user plays in the conversation.
 * - Choosing copies a value rather than linking an id. The room receives { name, description }
 *   (personaSnapshotOf → ChatStore.setRoomPersona), so later edits or deletes in the library do not
 *   affect this conversation. To apply a changed library entry, the user must choose it again. The
 *   rationale is in the header of persona.ts in @rowcat/chat.
 * - The top row, `Story's default persona`, clears the room override to null; it does not copy the inherited
 *   value. If the work proposed none, the row reads `Not set` and the assembler falls back to the
 *   product default name. That default is never stored as a fake library item.
 * - Creating a persona happens inside this window. A user creating one here wants it as this
 *   conversation's role; sending them to the library would mean create, return, and choose again.
 * - No nested dialog: the form opens as a surface of this window, like generation and info, so
 *   Escape and the focus trap stay singular.
 * - Managing the whole library (browsing and deleting entries) is out of scope. That list is an
 *   account asset under /settings/personas, and this surface only decides which copy goes into this
 *   conversation.
 */

export function RoomSettingsPersona({
	room,
	onLeave,
}: {
	/** The currently saved room record, from the subscription, not a copy the menu captured. */
	room: ChatRoom;
	/** Navigates to the persona screen in settings. The caller closes the settings dialog. */
	onLeave: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const { items, loading } = useLocalPersonas();
	const library = usePersonaLibrary();
	/**
	 * The name of this radio group. It is not a shared constant: if the same name matched another
	 * radio group on screen, the two would merge, and choosing in one would clear the other's
	 * selection. The work-detail selection dialog has the same line, so the same concern applies
	 * there.
	 */
	const groupName = useId();
	/** The form's target while open: a persona, or "new" for creating one. */
	const [editing, setEditing] = useState<ChatPersona | "new" | null>(null);
	const [applyFailure, setApplyFailure] = useState<string | null>(null);
	const [saveFailure, setSaveFailure] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/**
	 * Blocks a second press within the same tick, since setState is not visible until the next render.
	 */
	const applyingRef = useRef(false);

	const current = room.persona ?? null;
	const origin = chatPersonaOrigin(room);
	const suggested = room.seed.persona;

	const apply = (persona: ChatPersonaSnapshot | null): void => {
		if (applyingRef.current) return;
		applyingRef.current = true;
		setApplyFailure(null);
		void library
			.applyToRoom(room.id, persona)
			.catch((error: unknown) => {
				console.error(
					"[persona] couldn't change the conversation's persona",
					error,
				);
				setApplyFailure(personaApplyFailureMessage());
			})
			.finally(() => {
				applyingRef.current = false;
			});
	};

	if (editing !== null)
		return (
			<PersonaEditor
				initial={editing === "new" ? null : editing}
				submitLabel={
					editing === "new"
						? t("persona.createAndApply")
						: t("persona.saveAndApply")
				}
				pending={pending}
				failure={saveFailure}
				onCancel={() => {
					setEditing(null);
					setSaveFailure(null);
				}}
				onSubmit={(value) => {
					setPending(true);
					setSaveFailure(null);
					const save =
						editing === "new"
							? library.create(value)
							: library.update(editing.id, value);
					/*
					 * Saving applies the value to this conversation immediately. Making the user choose again
					 * would repeat what they just did and add one more surface with nothing happening on it.
					 *
					 * What gets passed to apply is the value, not the id of the record just created. The room
					 * holds a copy, and that rule holds here too.
					 */
					void save
						.then(() => library.applyToRoom(room.id, value))
						.then(() => {
							setPending(false);
							setEditing(null);
						})
						.catch((error: unknown) => {
							console.error("[persona] couldn't save the persona", error);
							setPending(false);
							setSaveFailure(personaSaveFailureMessage());
						});
				}}
			/>
		);

	return (
		<div className="flex flex-col gap-4">
			{/*
			 * This is a single-select group, so it uses a true radio group (fieldset + legend). role="radio" on
			 * buttons would
			 * look the same but behave differently from the keyboard: native radios move between options with
			 * arrow keys and
			 * leave the group with a single Tab. Hand-rolling that requires writing the wiring yourself (roving
			 * tabindex, arrow
			 * key handling), and missing any piece fails silently. The list (ul) does not get role="radiogroup"
			 * either: that would
			 * replace the list's semantics, and a radio group already has its own element.
			 */}
			<fieldset className="flex flex-col gap-1">
				<legend className="sr-only">
					{t("persona.thisConversationSPersona")}
				</legend>
				{/*
				 * The first row clears the room's override. It sits at the top because it is the room's starting
				 * state. Its label
				 * differs per work, which the subtitle explains.
				 */}
				<PersonaChoice
					name={groupName}
					title={suggested ? personaStoryDefaultLabel() : personaNoneLabel()}
					subtitle={suggested ? suggested.name : null}
					selected={origin !== "room"}
					onSelect={() => apply(null)}
				/>

				{loading ? (
					<Skeleton className="h-12 bg-muted/40" aria-busy="true" />
				) : (
					items.map((persona) => (
						<PersonaChoice
							key={persona.id}
							name={groupName}
							title={persona.name}
							subtitle={persona.description || null}
							/*
							 * Selection compares values (samePersonaSnapshot). The room holds a snapshot rather than an
							 * id, so there is no key to trace back to a library row. Two rows with the same name and
							 * description would both look selected, and that state cannot actually be told apart.
							 */
							selected={
								origin === "room" && samePersonaSnapshot(current, persona)
							}
							onSelect={() => apply(personaSnapshotOf(persona))}
							onEdit={() => setEditing(persona)}
						/>
					))
				)}
			</fieldset>

			{!loading && items.length === 0 && (
				<p className="text-muted-foreground text-sm">{personaEmptyBody()}</p>
			)}

			{applyFailure && (
				<p role="alert" className="text-destructive text-sm">
					{applyFailure}
				</p>
			)}

			<div className="flex flex-wrap items-center justify-between gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setEditing("new")}
					disabled={!library.ready}
				>
					<Plus aria-hidden="true" />
					{t("persona.newPersona")}
				</Button>
				{/*
				 * Managing the whole library is that screen's job. Adding list management here would create a
				 * second screen inside
				 * the settings dialog, and the global settings page at /settings/personas already has one.
				 */}
				<Button
					variant="ghost"
					size="sm"
					onClick={onLeave}
					render={<Link to="/settings/personas" />}
				>
					{t("persona.managePersonas")}
					<ExternalLink aria-hidden="true" />
				</Button>
			</div>
		</div>
	);
}

/**
 * One real radio button per row. Selection is not conveyed by color alone: a check mark appears
 * too, and the authoritative state is the `checked` of the hidden `<input type="radio">`, so arrow
 * keys move within the group. The edit trigger is a sibling of the label, not a child. A button
 * inside `<label>` would make pressing it select the radio (a label forwards clicks to its
 * control), and screen readers would announce a different action (see the same rule for sidebar
 * rows).
 */
function PersonaChoice({
	name,
	title,
	subtitle,
	selected,
	onSelect,
	onEdit,
}: {
	/**
	 * The group name. It is the only thing that makes these radios one group: browsers group radios
	 * only when they share a name. Without it, each row is its own group, so arrow keys have nowhere
	 * to move and Tab stops on every row, since each one is the only member of its group. Because
	 * `checked` comes from React state, the display still looked correct, which is why mouse testing
	 * did not reproduce the defect.
	 */
	name: string;
	title: string;
	subtitle: string | null;
	selected: boolean;
	onSelect: () => void;
	/** Only library rows have this. The work default is not an item to edit. */
	onEdit?: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	return (
		<div className="flex items-center gap-1">
			{/*
			 * The whole row is a `<label>`. Fingers and the mouse target the row, not the name; making only the
			 * radio clickable would
			 * shrink the target below finger size. The real control is the hidden `<input>`, which still
			 * receives focus (`sr-only` is
			 * not `display: none`).
			 */}
			<label className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
				<input
					type="radio"
					name={name}
					className="sr-only"
					checked={selected}
					onChange={onSelect}
				/>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium text-sm">{title}</span>
					{subtitle && (
						<span className="line-clamp-1 text-muted-foreground text-xs">
							{subtitle}
						</span>
					)}
				</span>
				{selected && <Check aria-hidden="true" className="size-4 shrink-0" />}
			</label>
			{onEdit && (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("persona.edit", { title })}
					onClick={onEdit}
				>
					<Pencil aria-hidden="true" />
				</Button>
			)}
		</div>
	);
}
