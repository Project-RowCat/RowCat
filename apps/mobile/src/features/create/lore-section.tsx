import type { DraftLoreEntry, DraftLoreEntryPatch } from "@rowcat/authoring";
import type { ChatLorePosition } from "@rowcat/contracts";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	Button,
	IconButton,
	Input,
	Notice,
	Panel,
	Select,
	SelectOption,
	Switch,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import {
	LORE,
	LORE_POSITION_LABEL,
	LORE_POSITION_OPTIONS,
	LORE_RUNTIME_LOCK,
	SECTION,
	SECTION_SUMMARY_NOUN,
	sectionSummary,
	splitLoreKeys,
} from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "./runtime-lock.tsx";
import { movedOrder } from "./use-draft-actions.ts";

/**
 * Lore: settings injected into the prompt only when a keyword matches. It stays out of the v2
 * prompt fold because folding it in would send it every turn (`StoryDraft.prompt` header in
 * `@rowcat/authoring`).
 *
 * - Up/down buttons pass the desired id order; the store renumbers positions in one transaction
 *   (`reorderLore`). Writing `positionIndex` one by one would let a process death leave two entries
 *   in the same slot.
 * - No drag-and-drop: the app has no gesture reorder primitive, and adding one is a build
 *   pipeline change. Buttons work the same for touch and assistive technology.
 * - An entry with no keywords that is not constant is saved but never fires in playback. Publish
 *   validation reports it (`loreNeverTriggers`), but only after the press, so the hint appears
 *   here.
 * - With the runtime on, this section locks: lore is injected into the conversation prompt, while
 *   a runtime work's AI requests come from the creator's `useGeneration()`, which reads neither
 *   seed nor lore. Judgment goes through `useConversationAuthoringMode`, shared by the four
 *   sections.
 */
export function LoreSection({
	draftId,
	entries,
	onPatch,
	onAdd,
	onRemove,
	onReorder,
}: {
	/** Draft whose runtime project the mode hook reads; the hook owns its subscription. */
	draftId: string;
	entries: readonly DraftLoreEntry[];
	onPatch: (id: string, patch: DraftLoreEntryPatch) => void;
	onAdd: () => void;
	onRemove: (id: string) => void;
	onReorder: (orderedIds: string[]) => void;
}) {
	const mode = useConversationAuthoringMode(draftId);

	const ids = entries.map((entry) => entry.id);
	const over = entries.length > STORY_PUBLISH_LIMITS.lore;

	if (mode !== "editable")
		return (
			<RuntimeLockedSection
				mode={mode}
				title={SECTION.lore.title}
				description={SECTION.lore.description}
				lock={LORE_RUNTIME_LOCK}
			/>
		);

	return (
		<EditorSection
			title={SECTION.lore.title}
			description={SECTION.lore.description}
			/**
			 * Collapsed by default: lore grows longest (five fields per card) and is empty for new users.
			 * The closed row states the count.
			 */
			summary={sectionSummary(SECTION_SUMMARY_NOUN.lore, entries.length)}
			/** The over-limit notice must show while collapsed; inside the body it would stay hidden until publish. */
			alert={
				over ? (
					<Notice
						message={`Lore can't exceed ${STORY_PUBLISH_LIMITS.lore} entries.`}
						tone="destructive"
					/>
				) : null
			}
			action={
				<Button
					label={LORE.add}
					icon="add"
					variant="outline"
					size="sm"
					onPress={onAdd}
				/>
			}
		>
			{entries.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{LORE.empty}
				</Text>
			) : null}
			{/**
			 * `enter={false}`: a card moving on reorder would replay its entrance and look newly added. The
			 * web cards make the same choice (`lore-editor-card.tsx`, `start-scene-editor-card.tsx`: `exit`
			 * and `layout` only).
			 */}
			{entries.map((entry, index) => (
				<MotionRow key={entry.id} enter={false} exit={entries.length > 1}>
					<LoreCard
						entry={entry}
						first={index === 0}
						last={index === entries.length - 1}
						onPatch={(patch) => onPatch(entry.id, patch)}
						onRemove={() => onRemove(entry.id)}
						onMove={(direction) =>
							onReorder(movedOrder(ids, entry.id, direction))
						}
					/>
				</MotionRow>
			))}
		</EditorSection>
	);
}

function LoreCard({
	entry,
	first,
	last,
	onPatch,
	onRemove,
	onMove,
}: {
	entry: DraftLoreEntry;
	first: boolean;
	last: boolean;
	onPatch: (patch: DraftLoreEntryPatch) => void;
	onRemove: () => void;
	onMove: (direction: -1 | 1) => void;
}) {
	/**
	 * Saved but inert in the conversation. It does not block publishing: an entry is often briefly
	 * empty while editing, and rejecting saves would block writing keywords later.
	 */
	const neverTriggers = !entry.constant && entry.keys.length === 0;
	const headline = entry.keys.length > 0 ? entry.keys.join(", ") : LORE.noKeys;

	return (
		<Panel style={lore.card}>
			<View style={lore.head}>
				<Text
					variant="label"
					weight="semibold"
					numberOfLines={1}
					style={lore.headline}
				>
					{headline}
				</Text>
				<IconButton
					icon="chevron-up"
					label={`${headline} ${LORE.moveUp}`}
					tone="muted-foreground"
					disabled={first}
					onPress={() => onMove(-1)}
				/>
				<IconButton
					icon="chevron-down"
					label={`${headline} ${LORE.moveDown}`}
					tone="muted-foreground"
					disabled={last}
					onPress={() => onMove(1)}
				/>
				<IconButton
					icon="delete"
					label={`${headline} ${LORE.remove}`}
					tone="destructive"
					onPress={onRemove}
				/>
			</View>

			<Input
				label={LORE.keys}
				value={entry.keys.join(", ")}
				placeholder={LORE.keysHint}
				/**
				 * Splits the one-line keywords into the stored array, dropping empty pieces: `"library, "` becomes
				 * `["library"]`, since an empty keyword matches nothing.
				 */
				onChangeText={(value) => onPatch({ keys: splitLoreKeys(value) })}
			/>
			<Textarea
				label={LORE.content}
				value={entry.content}
				invalid={entry.content.length > STORY_PUBLISH_LIMITS.loreContent}
				onChangeText={(content) => onPatch({ content })}
			/>

			<View style={lore.toggle}>
				<Text variant="body" style={lore.toggleText}>
					{LORE.constant}
				</Text>
				<Switch
					label={LORE.constant}
					value={entry.constant}
					onValueChange={(constant) => onPatch({ constant })}
				/>
			</View>

			<Select
				label="Insertion position"
				value={LORE_POSITION_LABEL[entry.position]}
			>
				{LORE_POSITION_OPTIONS.map((option) => (
					<SelectOption
						key={option.value}
						label={option.label}
						selected={option.value === entry.position}
						onSelect={() =>
							onPatch({ position: option.value as ChatLorePosition })
						}
					/>
				))}
			</Select>

			{neverTriggers ? <Notice message={LORE.neverTriggers} /> : null}
		</Panel>
	);
}

const lore = StyleSheet.create({
	card: { gap: space.sm, padding: space.md },
	head: { alignItems: "center", flexDirection: "row", gap: space.xs },
	headline: { flex: 1, minWidth: 0 },
	toggle: { alignItems: "center", flexDirection: "row", gap: space.md },
	toggleText: { flex: 1, minWidth: 0 },
});
