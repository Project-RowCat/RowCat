import type { ChatRoom } from "@rowcat/chat";
import {
	narrationBlockedReason,
	promptPackCapabilityFor,
	resolveAllAges,
	roomChatIntensity,
	roomSettingsRowAvailable,
	roomUserNote,
} from "@rowcat/chat";
import { PROMPT_PACKS_AVAILABLE } from "@rowcat/prompt-packs";
import { generationModelsQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { reasoningEffortLabel } from "#/features/generation/reasoning-effort-field.tsx";
import { responseLengthLabel } from "#/features/generation/response-length-field.tsx";
import { personaRowSummary } from "#/features/persona/persona-form.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { useLocalCharacters } from "#/lib/local-chat/hooks.ts";
import { useRoomGenerationState } from "#/lib/local-generation/hooks.ts";
import { useConnectedProviders } from "#/lib/local-provider/hooks.ts";
import { useViewerCapability } from "#/lib/query/viewer-capability.ts";
import { roomGenerationSummary } from "../room/generation-summary.ts";
import { characterRowSummary } from "./character-copy.ts";
import { intensityRowSummary } from "./intensity-copy.ts";
import { narrationRowSummary } from "./narration-copy.ts";
import { RoomSettingsGroup, RoomSettingsRow } from "./parts.tsx";
import { userNoteRowSummary } from "./user-note-copy.ts";
import type { RoomSettingsView } from "./view.ts";

/**
 * The first screen of room settings: a list that shows at a glance what can be done. The earlier
 * version showed every control on one page, which answered 'how long is this document?' rather than
 * 'what can I do here?'. Each row now completes its own task on its own surface.
 *
 * This screen owns no values. Summaries read the priority resolver's result
 * (useRoomGenerationState().effective), and every action is a trigger. That boundary is unchanged
 * from the earlier dialog; only layout and navigation changed, and no product capability was added
 * or removed.
 *
 * The memory count is not shown. Counting would need this screen to subscribe to the memory table,
 * so opening settings would open a subscription nobody reads. Memory is read only by the memory
 * window and the generation start point.
 */

export function RoomSettingsHome({
	room,
	autoFocusRow,
	onOpenView,
	onOpenMemory,
	onRename,
	onDelete,
}: {
	/**
	 * The currently saved room record, from the subscription. Widened from a room id because the
	 * persona row summary reads directly from the record (personaRowSummary). Generation settings
	 * differ: they need device preferences joined with the catalog, hence a subscription. The persona
	 * role is answered by a value this dialog already holds, so no extra subscription is needed.
	 */
	room: ChatRoom;
	/**
	 * Returned from a detail view: focus goes back to that row. Without this, keyboard users are moved
	 * back to the top of the list after every detail visit, and some browsers let focus escape the
	 * dialog. The value is null on first mount, so the primitive's initial focus is not overridden.
	 */
	autoFocusRow: RoomSettingsView | null;
	onOpenView: (view: RoomSettingsView) => void;
	/** Trigger that opens the memory window. This screen does not own memory. */
	onOpenMemory: () => void;
	onRename: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const { effective, loading } = useRoomGenerationState(room.id);
	const { items: characters } = useLocalCharacters(room.id);
	/**
	 * The catalog uses the same query key as the detail screen (ModelTargetField). Calling it here
	 * adds no request (identical keys are merged), and the list the detail screen needs is pre-warmed
	 * while home is open.
	 */
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const { providers: connected, loading: connectionsLoading } =
		useConnectedProviders();
	const capability = useViewerCapability();

	const summary = roomGenerationSummary({
		reasoningEffortLabel,
		loading:
			loading || catalog.isPending || connectionsLoading || capability.loading,
		effective,
		models: catalog.data ?? [],
		catalogLoaded: catalog.isSuccess,
		connected,
		byoAllowed: capability.byo,
		responseLengthLabel: responseLengthLabel(effective.responseLength),
	});

	const generationRef = useRef<HTMLButtonElement>(null);
	const personaRef = useRef<HTMLButtonElement>(null);
	const infoRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (autoFocusRow === "generation") generationRef.current?.focus();
		if (autoFocusRow === "persona") personaRef.current?.focus();
		if (autoFocusRow === "info") infoRef.current?.focus();
	}, [autoFocusRow]);

	return (
		/*
		 * Spacing between groups belongs to the group (RoomSettingsGroup's `mt-3 border-t pt-4`). Adding
		 * `gap` here would float each divider between two margins, so which group a divider belongs to
		 * would depend only on the margin sizes above and below it.
		 */
		<div className="flex flex-col">
			<RoomSettingsGroup title={t("home.generation")}>
				<RoomSettingsRow
					ref={generationRef}
					title={t("home.generationSettings")}
					summary={summary.text}
					/*
					 * The unusable-target fact has to stay visible here. The old window stated it as soon as it
					 * opened. If the control moves one level deeper and this warning is hidden with it, the user
					 * closes settings without knowing why the conversation is blocked.
					 */
					warning={summary.blocked ? t("home.notAvailableOnThisDevice") : null}
					navigational
					onClick={() => onOpenView("generation")}
				/>
			</RoomSettingsGroup>

			{/*
			 * `Memory` is grouped with `Conversation info` because both are about what this conversation is. It differs from
			 * generation (how it is produced) and from management (what is done to the conversation itself).
			 */}
			<RoomSettingsGroup title={t("home.conversation")}>
				{/*
				 * `Personas` comes before `Memory`. The order is defined by ROOM_SETTINGS_IA in @rowcat/chat, which the
				 * mobile app
				 * reads too. The persona is checked as soon as the conversation opens, since the speaker name
				 * appears on every
				 * message. Memory is edited after the conversation has grown.
				 */}
				<RoomSettingsRow
					ref={personaRef}
					title={t("home.persona")}
					/*
					 * The summary states the role currently in effect. The three states are not folded into one
					 * sentence, because a name alone does not show whether the user picked it or the work
					 * suggested it (personaRowSummary).
					 */
					summary={personaRowSummary(room)}
					navigational
					onClick={() => onOpenView("persona")}
				/>
				{/*
				 * `Narration` comes right after `Personas`. The order is defined by ROOM_SETTINGS_IA, which mobile reads
				 * too. The
				 * two rows answer one question in two halves (who the character is / who narrates them), and
				 * separating them
				 * would hide that relation on screen.
				 *
				 * The row stands only in a build that carries pack bodies (the public release ships none). Without
				 * them the setting would change nothing, so it is absent rather than drawn; mobile asks the same
				 * predicate through `roomSettingsGroups`.
				 */}
				{roomSettingsRowAvailable("narration", {
					narration: PROMPT_PACKS_AVAILABLE,
				}) ? (
					<RoomSettingsRow
						title={t("home.narration")}
						summary={narrationRowSummary(
							room.narration,
							narrationBlockedReason({
								settings: room.narration ?? null,
								capability: promptPackCapabilityFor({
									models: catalog.data ?? [],
									catalogLoaded: catalog.isSuccess,
									target: effective.target,
								}),
							}),
						)}
						navigational
						onClick={() => onOpenView("narration")}
					/>
				) : null}
				{/*
				 * `Intensity` comes right after `Narration`. The order is defined by ROOM_SETTINGS_IA. The narration row
				 * says who
				 * writes; this row says how explicit the content is. They are two axes of the same question.
				 */}
				<RoomSettingsRow
					title={t("home.intensity")}
					/*
					 * The summary states the value currently in effect, not just the one chosen. A name alone does
					 * not distinguish the two: in a room where adult verification has lapsed, a label reading `Intense`
					 * would describe a state that is not true.
					 */
					summary={intensityRowSummary(
						roomChatIntensity(room),
						capability.loading
							? null
							: resolveAllAges(room, { adultAllowed: capability.adult }),
					)}
					navigational
					onClick={() => onOpenView("intensity")}
				/>
				{/*
				 * `Characters` comes before `Memory`. The order is defined by ROOM_SETTINGS_IA. The cast is set when starting
				 * a
				 * conversation; memory is edited after it grows.
				 */}
				<RoomSettingsRow
					title={t("home.characters")}
					summary={characterRowSummary(
						characters.length,
						room.seed.characters.length,
					)}
					navigational
					onClick={() => onOpenView("characters")}
				/>
				<RoomSettingsRow
					title={t("home.memory")}
					summary={t("home.manageWhatThisConversationRemembers")}
					navigational
					onClick={onOpenMemory}
				/>
				{/*
				 * `User note` comes right after `Memory`. The order is defined by ROOM_SETTINGS_IA. These two rows hold all
				 * the text the
				 * user types directly into this conversation's prompt, and the prompt places them in the same
				 * order.
				 */}
				<RoomSettingsRow
					title={t("home.userNote")}
					/*
					 * The summary does not show a cut-off piece of the body. Instructions can read backwards when
					 * cut (for example `Don't use formal speech…`, 'do not use honorifics…'), and that mistake is common at
					 * this row width.
					 */
					summary={userNoteRowSummary(roomUserNote(room))}
					navigational
					onClick={() => onOpenView("userNote")}
				/>
				<RoomSettingsRow
					ref={infoRef}
					title={t("home.conversationInfo")}
					summary={t("home.originalStoryAndConversationDetails")}
					navigational
					onClick={() => onOpenView("info")}
				/>
			</RoomSettingsGroup>

			{/*
			 * Management actions. None of them run here: each row only opens its own confirmation dialog, and
			 * the actual write
			 * is performed by useRoomManagement. It is the same code the list row menu uses, so confirmation
			 * wording and failure
			 * handling cannot diverge.
			 */}
			<RoomSettingsGroup title={t("home.manage")}>
				<RoomSettingsRow
					title={t("home.rename")}
					navigational
					onClick={onRename}
				/>
				<RoomSettingsRow
					title={t("home.deleteConversation")}
					destructive
					onClick={onDelete}
				/>
			</RoomSettingsGroup>
		</div>
	);
}
