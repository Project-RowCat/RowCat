import type { ChatRoom, RoomSettingsRowId } from "@rowcat/chat";
import {
	narrationBlockedReason,
	promptPackCapabilityFor,
	ROOM_SETTINGS_DESTRUCTIVE_ROWS,
	ROOM_SETTINGS_NAVIGATIONAL_ROWS,
	resolveAllAges,
	roomChatIntensity,
	roomSettingsGroups,
	roomUserNote,
} from "@rowcat/chat";
import { PROMPT_PACKS_AVAILABLE } from "@rowcat/prompt-packs";
import { generationModelsQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import { useLocalCharacters } from "../../../lib/local-data/use-characters.ts";
import { useProviderConnections } from "../../../lib/local-data/use-provider-connections.ts";
import { useViewerCapability } from "../../../lib/viewer-capability.ts";
import { personaRowSummary } from "../../persona/persona-form.ts";
import { useRoomGenerationState } from "../generation/use-room-generation.ts";
import { roomGenerationSummary } from "../room/generation-summary.ts";
import { characterRowSummary } from "./character-copy.ts";
import { intensityRowSummary } from "./intensity-copy.ts";
import { narrationRowSummary } from "./narration-copy.ts";
import { RoomSettingsGroup, RoomSettingsRow } from "./parts.tsx";
import { userNoteRowSummary } from "./user-note-copy.ts";
import {
	ROOM_SETTINGS_BLOCKED_WARNING,
	ROOM_SETTINGS_GROUP_TITLE,
	ROOM_SETTINGS_ROW_SUMMARY,
	ROOM_SETTINGS_ROW_TITLE,
} from "./view.ts";

/**
 * The first screen of room settings: a list that reads in seconds as "what can be done here".
 *
 * An overflow menu used to stand here with five unclassified rows (`Search conversations`, `Rename`, `Conversation info`, `Memory`,
 * `Delete conversation`). It could not answer "what can I configure here": actions, navigation and values were
 * one lump, and generation settings, present on the web, were absent.
 *
 * - Structure is not decided here. Groups, rows and their order come from `ROOM_SETTINGS_IA` in
 *   `@rowcat/chat`, which the web reads too; re-writing it in JSX lets order flip in one app only,
 *   visible just side by side. This file draws that table and decides what each row opens.
 * - It owns no value: summaries read the precedence resolver's result
 *   (`useRoomGenerationState().effective`) and every action is a trigger.
 * - Memory is not counted: counting would subscribe to the memory table, making opening settings
 *   open a subscription for a decorative number.
 */

export interface RoomSettingsHomeActions {
	/** What one row requests; what opens is decided outside this screen. */
	onOpenRow: (row: RoomSettingsRowId) => void;
}

export function RoomSettingsHome({
	room,
	onOpenRow,
}: { room: ChatRoom } & RoomSettingsHomeActions) {
	const { effective, loading } = useRoomGenerationState(room.id);
	/** Only the count is needed; the detail pane subscribes to the list (`useRoomManagement`), and holding it here too would be two subscriptions. */
	const { value: characters } = useLocalCharacters(room.id);
	const characterCount = characters.length;
	/** Same query key as the generation detail (`@rowcat/query`): no extra request (same keys merge), and the list the detail needs is warmed while home is open. */
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const capability = useViewerCapability();
	/** Same store the generation detail and runtime read, so the warning and the fact cannot diverge. */
	const connections = useProviderConnections();

	const summary = roomGenerationSummary({
		loading:
			loading || catalog.isPending || capability.loading || connections.loading,
		effective,
		models: catalog.data ?? [],
		catalogLoaded: catalog.isSuccess,
		connected: connections.providers,
		byoAllowed: capability.byo,
	});

	/**
	 * The line under a row is one of three: a sentence built from the currently effective value
	 * (generation, persona), fixed copy (memory, info), or nothing (rename, delete). Persona comes
	 * straight from the room record unlike generation, which must overlay device preferences and the
	 * catalogue; the window already holds that room, so no extra subscription.
	 */
	const summaryOf = (row: RoomSettingsRowId): string | null => {
		if (row === "generation") return summary.text;
		if (row === "persona") return personaRowSummary(room);
		/** Narration needs the room record and the catalogue together: naming only the scope on a model that takes no pack states something untrue (same decision as the web row). */
		if (row === "characters")
			return characterRowSummary(characterCount, room.seed.characters.length);
		if (row === "narration")
			return narrationRowSummary(
				room.narration,
				narrationBlockedReason({
					settings: room.narration ?? null,
					capability: promptPackCapabilityFor({
						models: catalog.data ?? [],
						catalogLoaded: catalog.isSuccess,
						target: effective.target,
					}),
				}),
			);
		/** Intensity needs the room record and this turn's effective rating together: writing only `Intense` for a room whose entitlement lapsed is untrue (same as the web row). If the viewer is not read yet, claim nothing. */
		if (row === "intensity")
			return intensityRowSummary(
				roomChatIntensity(room),
				capability.loading
					? null
					: resolveAllAges(room, { adultAllowed: capability.adult }),
			);
		/* The summary never truncates the body: a cut instruction can read as its opposite (`Don't use formal speech…`), common at this width. Same function as the web row. */
		if (row === "userNote") return userNoteRowSummary(roomUserNote(room));
		return ROOM_SETTINGS_ROW_SUMMARY[row];
	};

	return (
		<View>
			{/* The narration row stands only in a build that carries pack bodies; the web home asks the same predicate. */}
			{roomSettingsGroups({ narration: PROMPT_PACKS_AVAILABLE }).map(
				(group, index) => (
					<RoomSettingsGroup
						key={group.id}
						title={ROOM_SETTINGS_GROUP_TITLE[group.id]}
						first={index === 0}
					>
						{group.rows.map((row) => (
							<RoomSettingsRow
								key={row}
								title={ROOM_SETTINGS_ROW_TITLE[row]}
								summary={summaryOf(row)}
								/** The unusable-target fact must stay here: hiding it while moving the control one level in leaves the user not knowing why the conversation is blocked. The web settings home does the same. */
								warning={
									row === "generation" && summary.blocked
										? ROOM_SETTINGS_BLOCKED_WARNING
										: null
								}
								navigational={ROOM_SETTINGS_NAVIGATIONAL_ROWS.has(row)}
								destructive={ROOM_SETTINGS_DESTRUCTIVE_ROWS.has(row)}
								onPress={() => onOpenRow(row)}
							/>
						))}
					</RoomSettingsGroup>
				),
			)}
		</View>
	);
}
