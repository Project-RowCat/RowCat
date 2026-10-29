import type { ChatPersona, ChatPersonaSnapshot } from "@rowcat/chat";
import { personaSnapshotOf, samePersonaSnapshot } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Check, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonaEditor } from "#/features/persona/persona-editor.tsx";
import {
	personaSaveFailureMessage,
	personaStoryDefaultHint,
	personaStoryDefaultLabel,
} from "#/features/persona/persona-form.ts";
import { usePersonaLibrary } from "#/features/persona/use-persona-library.ts";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { startLabel as vocabStartLabel } from "#/lib/i18n/vocab.ts";
import { useLocalPersonas } from "#/lib/local-chat/hooks.ts";

/**
 * The dialog where the user picks the persona to play before a conversation starts. Opening it
 * creates no room, and cancelling navigates nowhere. Creating the room on open would leave an empty
 * conversation in the list that the user never asked for.
 *
 * The value is decided before `startStoryChat` is called: this dialog first, then that function
 * (see step 0 in `start-story-chat.ts`). The chosen value is written in the same transaction as the
 * room. Applying it afterward would show the default persona on the first frame, so a message sent
 * in that window would go to a persona different from the one shown.
 *
 * The dialog is not opened when the persona library is empty; that check is at the call site
 * (`use-story-start.tsx`). A single-option dialog would add a step and ask nothing.
 */

export function StoryPersonaDialog({
	pending,
	onCancel,
	onStart,
}: {
	/**
	 * The start is in progress. The dialog stays open and locked until navigation finishes and the
	 * screen changes.
	 */
	pending: boolean;
	onCancel: () => void;
	/** `null` starts without an override, so the work's suggested persona applies. */
	onStart: (persona: ChatPersonaSnapshot | null) => void;
}) {
	const { t } = useTranslation(["story", "common"]);
	const { items, loading } = useLocalPersonas();
	const library = usePersonaLibrary();
	/**
	 * The selection is this dialog's state, not a saved value. `null` means the work's default and is
	 * the initial value. The first library entry is not pre-selected: the user did not choose it, and
	 * the conversation would start with a role they never picked.
	 */
	/**
	 * Name of this radio group, from `useId`, so it does not collide with radio groups on other
	 * screens.
	 */
	const groupName = useId();
	const [selected, setSelected] = useState<ChatPersonaSnapshot | null>(null);
	const [creating, setCreating] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveFailure, setSaveFailure] = useState<string | null>(null);

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onCancel();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}
			>
				<DialogHeader className="min-w-0">
					<DialogTitle>
						{creating ? t("persona.newTitle") : t("persona.chooseTitle")}
					</DialogTitle>
					<DialogDescription>
						{creating ? t("persona.newBody") : t("persona.chooseBody")}
					</DialogDescription>
				</DialogHeader>

				{creating ? (
					<PersonaEditor
						initial={null}
						submitLabel={t("persona.createAndChoose")}
						pending={saving}
						failure={saveFailure}
						onCancel={() => {
							setCreating(false);
							setSaveFailure(null);
						}}
						onSubmit={(value) => {
							setSaving(true);
							setSaveFailure(null);
							void library
								.create(value)
								.then(() => {
									/*
									 * A newly created value is selected immediately, instead of making the user find it in the
									 * list and repeat what they just did. The value is a snapshot, not the record. If creation
									 * loses its scope and returns `null`, the selection stays valid: it is simply not kept in
									 * the library, and the conversation still starts with that persona.
									 */
									setSelected(value);
									setSaving(false);
									setCreating(false);
								})
								.catch((error: unknown) => {
									console.error("[persona] could not save the persona", error);
									setSaving(false);
									setSaveFailure(personaSaveFailureMessage());
								});
						}}
					/>
				) : (
					<>
						{/*
						 * This is a real radio group (`fieldset` with `legend`). Hand-building one would
						 * require writing arrow-key movement and roving `tabindex` manually, and missing one
						 * fails silently. The room settings' choice field made the same decision.
						 */}
						<fieldset className="flex max-h-64 flex-col gap-1 overflow-y-auto">
							<legend className="sr-only">{t("persona.legend")}</legend>
							{/*
							 * The first row is the persona the work proposes, the conversation's starting state.
							 * It does not name the persona: the name lives in the playback snapshot, which arrives
							 * only after start is pressed (step 2 of `startStoryChat`). Fetching it earlier would
							 * make opening the dialog a server round trip, sent even to people who cancel. The
							 * row describes what happens instead, which is always true; the room's settings show
							 * the real name once inside.
							 */}
							<PersonaOption
								name={groupName}
								title={personaStoryDefaultLabel()}
								subtitle={personaStoryDefaultHint()}
								selected={selected === null}
								onSelect={() => setSelected(null)}
							/>
							{!loading &&
								items.map((persona: ChatPersona) => (
									<PersonaOption
										key={persona.id}
										name={groupName}
										title={persona.name}
										subtitle={persona.description || null}
										/* Compared by value. The snapshot has no id, so there is no key to match against. */
										selected={samePersonaSnapshot(selected, persona)}
										onSelect={() => setSelected(personaSnapshotOf(persona))}
									/>
								))}
						</fieldset>

						<DialogFooter className="sm:justify-between">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setCreating(true)}
								disabled={pending || !library.ready}
							>
								<Plus aria-hidden="true" />
								{t("persona.create")}
							</Button>
							<div className="flex gap-2">
								<Button variant="outline" onClick={onCancel} disabled={pending}>
									{t("common:actions.cancel")}
								</Button>
								<Button onClick={() => onStart(selected)} disabled={pending}>
									{pending ? t("persona.starting") : vocabStartLabel("chat")}
								</Button>
							</div>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

/**
 * A row in the selection list is a real radio button. Selection is shown by a check mark, not by
 * color alone. The source of truth is the `checked` state of the hidden `<input type="radio">`,
 * which lets the arrow keys move through the group.
 */
function PersonaOption({
	name,
	title,
	subtitle,
	selected,
	onSelect,
}: {
	/**
	 * Name of this group. It is the only thing that makes the radios one group: without it, each row
	 * becomes its own group, arrow-key movement disappears, and Tab stops at every row. The reasoning
	 * is also in `features/chat/room-settings/persona.tsx`.
	 */
	name: string;
	title: string;
	subtitle: string | null;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<div>
			{/*
			 * The whole row is the `<label>`, so the target is the row, not just the name. The
			 * real control is a visually hidden `<input>`, which still receives focus because
			 * `sr-only` is not `display: none`.
			 */}
			<label className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
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
		</div>
	);
}
