import {
	CHAT_MEMORY_CONTENT_MAX_LENGTH,
	type ChatCharacter,
	type ChatMemory,
	type ChatMemoryStatus,
	type ChatRoom,
	type ChatScene,
	type ChatSceneAudience,
	type ChatStore,
	chatTextLength,
	groupMemories,
	isAutoMemory,
	type MemoryVisibility,
	type MemoryVisibilityOption,
	memoryVisibility,
	memoryVisibilityOptions,
	promoteMemoryPatch,
	requireSceneAudience,
	type SceneCastMember,
	sceneCast,
	unresolvedMemoryCount,
} from "@rowcat/chat";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import {
	Button,
	controlHeight,
	Dialog,
	DialogActions,
	Icon,
	Notice,
	Spinner,
	Text,
	Textarea,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalLive } from "../../../lib/local-data/live.ts";
import { AnimatedCount } from "../../../lib/motion/animated-count.tsx";
import { AnimatedIconSwap } from "../../../lib/motion/animated-icon-swap.tsx";
import { MotionRow } from "../../../lib/motion/list-motion.tsx";
import { AudiencePicker } from "../scene/audience-picker.tsx";
import {
	CHOOSE_AUDIENCE_LABEL,
	MEMORY_COUNTER_THRESHOLD,
	MEMORY_DELETE_FAILURE_MESSAGE,
	MEMORY_EMPTY_MESSAGE,
	memorySaveFailureMessage,
	memoryStatusMessage,
	memoryVisibilityOptionAccessibilityLabel,
	memoryVisibilityOptionLabel,
	memoryVisibilityText,
	needsClassificationMessage,
	planMemorySave,
} from "./form.ts";

/** Who may know one memory, and what the person can change it to (`memory-audience.ts`). */
interface RowAudience {
	visibility: MemoryVisibility;
	options: MemoryVisibilityOption[];
	cast: readonly SceneCastMember[];
}

/**
 * The room's memory workspace: what this conversation keeps remembering.
 *
 * - A `Dialog(size="full")`, not a sheet: the CRUD is too large for a half-screen panel, and it
 *   has no route because a route would stay reachable after the room is deleted.
 * - The list and the editor swap in the same surface, one at a time, so accessibility focus keeps
 *   a single owner.
 * - Delete confirmation opens inside the row. A second dialog would stack windows and make the
 *   Android back target unpredictable (web's `memory-dialog.tsx` made the same call); the
 *   confirmation stays because there is no undo.
 * - Order comes from the store (`listMemories`: pinned first, then most recently edited).
 *   Re-sorting here would split the screen order from the prompt order; only splitting is done, by
 *   `groupMemories`.
 * - Auto-extraction is out of scope, and the empty-state copy does not hint at it.
 * - In a room with scenes, each human-written row states who may know it and offers the choices
 *   `memoryVisibilityOptions` returns (`memory-audience.ts`, the same answers as web's memory
 *   window). Classifying writes the audience only; the text is never touched in that flow.
 * - Long-term memory's availability is one line (`memoryStatusFor`, computed by the opener, which
 *   holds the runtime); `ready` is quiet.
 */
export function MemoryPanel({
	roomId,
	room,
	characters,
	store,
	status,
	onClose,
}: {
	roomId: string;
	/** The room as the window resolved it: its seed and role name the members of an audience. */
	room: Pick<ChatRoom, "seed" | "persona">;
	/** The room's added characters, passed by value like room settings does. */
	characters: { value: readonly ChatCharacter[]; loading: boolean };
	/**
	 * The store instance at the moment this surface opened. Not re-read from the scope, so an account
	 * switch cannot end an operation in another member's database; the parent guards ownership.
	 */
	store: ChatStore;
	/**
	 * Long-term memory's state for this room, or `undefined` when the opener does not hold the runtime
	 * (the conversation list); then no line is drawn rather than a guess.
	 */
	status?: ChatMemoryStatus;
	onClose: () => void;
}) {
	const load = useMemo(() => () => store.listMemories(roomId), [store, roomId]);
	const memories = useLocalLive<ChatMemory[]>(load, EMPTY);
	/**
	 * Scenes are subscribed only while this window is open. Until they and the cast have answered, no
	 * row draws its visibility or choices: a choice naming nobody before the cast arrives, or a state
	 * appearing a moment late, reads as something that just changed.
	 */
	const loadScenes = useMemo(
		() => () => store.listScenes(roomId),
		[store, roomId],
	);
	const scenes = useLocalLive<ChatScene[]>(loadScenes, NO_SCENES);
	const audienceFor = (item: ChatMemory): RowAudience | null => {
		if (scenes.status !== "ready" || characters.loading) return null;
		const cast = { room, characters: characters.value };
		return {
			visibility: memoryVisibility(item, scenes.value, cast),
			options: memoryVisibilityOptions(item, scenes.value, cast),
			cast: sceneCast(room, characters.value),
		};
	};
	/**
	 * A memory with no audience is unresolved, and in a room with a scene narrower than the room it is
	 * withheld from every reply until classified (`docs/chat/SCENES.md` §6). The panel says how many;
	 * the rows say which. Not before scenes answer (no count appearing late).
	 */
	const unresolved =
		scenes.status === "ready"
			? unresolvedMemoryCount(memories.value, scenes.value)
			: 0;
	const statusLine = status ? memoryStatusMessage(status) : null;

	/** What is being edited: `"new"` adds, an id edits, `null` is the list. */
	const [editing, setEditing] = useState<"new" | string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const target =
		typeof editing === "string" && editing !== "new"
			? (memories.value.find((memory) => memory.id === editing) ?? null)
			: null;

	// If the memory being edited disappears (a delete synced from another device), return to the list:
	// the store silently ignores saves to a missing record, leaving a dead save button.
	const gone =
		editing !== null &&
		editing !== "new" &&
		target === null &&
		memories.status === "ready";
	useEffect(() => {
		if (gone) setEditing(null);
	}, [gone]);

	return (
		<Dialog
			title="Memory"
			open
			size="full"
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			{editing !== null ? (
				<MemoryEditor
					initial={target?.content ?? ""}
					onCancel={() => {
						setEditing(null);
						setError(null);
					}}
					onSave={(content) =>
						target
							? /**
								 * Editing makes the memory the user's own (`promoteMemoryPatch`); left as auto, the next
								 * maintenance would treat it as a stale auto fact and replace or delete it. A no-op for user
								 * memories, so there is no source branch.
								 */
								store.updateMemory(target.id, promoteMemoryPatch(content))
							: store.createMemory({ roomId, content })
					}
					onSaved={() => {
						setEditing(null);
						setError(null);
					}}
				/>
			) : (
				<View style={memory.root}>
					{error ? <Notice tone="destructive" message={error} /> : null}
					{unresolved > 0 ? (
						<View style={memory.origin}>
							<Icon name="warning" size="sm" tone="foreground" />
							<Text variant="label" style={memory.flexText}>
								{needsClassificationMessage(unresolved)}
							</Text>
						</View>
					) : null}

					{memories.status === "loading" ? (
						<Spinner />
					) : memories.value.length === 0 ? (
						<Text variant="label" tone="muted-foreground">
							{MEMORY_EMPTY_MESSAGE}
						</Text>
					) : (
						<MemoryList
							memories={memories.value}
							audienceFor={audienceFor}
							onSetAudience={(item, audience) => {
								void store
									.updateMemory(item.id, { audience })
									.catch((failure: unknown) =>
										setError(memorySaveFailureMessage(failure)),
									);
							}}
							onEdit={(item) => {
								setError(null);
								setEditing(item.id);
							}}
							onTogglePin={(item) => {
								void store
									.updateMemory(item.id, { pinned: !item.pinned })
									.catch((failure: unknown) =>
										setError(memorySaveFailureMessage(failure)),
									);
							}}
							onDelete={(item) => {
								void store
									.deleteMemory(item.id)
									.catch(() => setError(MEMORY_DELETE_FAILURE_MESSAGE));
							}}
						/>
					)}

					<Button
						label="Add memory"
						icon="add"
						fullWidth
						onPress={() => {
							setError(null);
							setEditing("new");
						}}
					/>
					{statusLine ? (
						<Text variant="caption" tone="muted-foreground">
							{statusLine}
						</Text>
					) : null}
				</View>
			)}
		</Dialog>
	);
}

/**
 * Pinned and the rest: splits without sorting, so concatenating the groups restores the store's
 * order (`groupMemories`). The heading says `pin` is prompt priority, not absolute protection; the
 * budget still applies when everything is pinned.
 */
function MemoryList({
	memories,
	audienceFor,
	onSetAudience,
	onEdit,
	onTogglePin,
	onDelete,
}: {
	memories: readonly ChatMemory[];
	audienceFor: (memory: ChatMemory) => RowAudience | null;
	onSetAudience: (memory: ChatMemory, audience: ChatSceneAudience) => void;
	onEdit: (memory: ChatMemory) => void;
	onTogglePin: (memory: ChatMemory) => void;
	onDelete: (memory: ChatMemory) => void;
}) {
	const groups = groupMemories(memories);
	return (
		<View style={memory.list}>
			{groups.pinned.length > 0 ? (
				<Text variant="caption" tone="muted-foreground">
					pin
				</Text>
			) : null}
			{/*
			 * Rows have identity (see `lib/motion/list-motion.tsx`; web's `memory-dialog.tsx` uses the
			 * same rhythm). Toggling a pin moves the same row between groups; keyed by memory id, that
			 * is a relayout, not an exit plus an entrance.
			 */}
			{groups.pinned.map((item) => (
				<MotionRow key={item.id}>
					<MemoryRow
						memory={item}
						audience={audienceFor(item)}
						onSetAudience={onSetAudience}
						onEdit={onEdit}
						onTogglePin={onTogglePin}
						onDelete={onDelete}
					/>
				</MotionRow>
			))}
			{groups.others.map((item) => (
				<MotionRow key={item.id}>
					<MemoryRow
						memory={item}
						audience={audienceFor(item)}
						onSetAudience={onSetAudience}
						onEdit={onEdit}
						onTogglePin={onTogglePin}
						onDelete={onDelete}
					/>
				</MotionRow>
			))}
		</View>
	);
}

/** `(44 - 36) / 2`: the gap between the visible box and the touch target, split per side. */
const SLOP = (touchTarget - controlHeight.sm) / 2;

/**
 * The start of the content, so a button's accessible name says which memory it acts on. The
 * ellipsis keeps a screen reader from running a truncated memory into the next word (`Pin memory`).
 * Counted in code points so emoji are not cut in half.
 */
function excerpt(content: string): string {
	const trimmed = content.trim();
	const points = [...trimmed];
	return points.length > 20 ? `${points.slice(0, 20).join("")}…` : trimmed;
}

function MemoryRow({
	memory: item,
	audience,
	onSetAudience,
	onEdit,
	onTogglePin,
	onDelete,
}: {
	memory: ChatMemory;
	/** `null` draws nothing yet: scenes or the cast have not answered (`memory-audience.ts`). */
	audience: RowAudience | null;
	onSetAudience: (memory: ChatMemory, audience: ChatSceneAudience) => void;
	onEdit: (memory: ChatMemory) => void;
	onTogglePin: (memory: ChatMemory) => void;
	onDelete: (memory: ChatMemory) => void;
}) {
	const { colors } = useTheme();
	// One confirmation opened inside the row; no extra layer, so the back target stays unambiguous.
	const [confirming, setConfirming] = useState(false);
	// The character picker opens inside the row for the same reason.
	const [choosing, setChoosing] = useState(false);
	const visibility = audience
		? memoryVisibilityText(audience.visibility)
		: null;
	const withheld =
		audience?.visibility.state === "unresolved" && audience.visibility.blocking;
	const label = excerpt(item.content);

	return (
		<View style={[memory.row, { borderColor: colors.border }]}>
			<Text variant="body">{item.content}</Text>
			{/*
			 * The origin mark is only on auto memories; on user memories it would sit on nearly every
			 * row and distinguish nothing. The word accompanies the icon so color is not the only
			 * signal (same call as web).
			 */}
			{isAutoMemory(item) ? (
				<View style={memory.origin}>
					<Icon name="sparkle" size="sm" tone="muted-foreground" />
					<Text variant="caption" tone="muted-foreground">
						Remembered by AI
					</Text>
				</View>
			) : null}
			{/*
			 * Who may know this memory, in words: a restriction is otherwise invisible, and a character
			 * answering as if it never heard of something would read as a malfunction. A memory being
			 * withheld until classified says so with a glyph and the foreground colour, so it is found
			 * without reading every row (the list keeps the store's order: re-sorting here would split the
			 * screen order from the prompt order).
			 */}
			{visibility ? (
				withheld ? (
					<View style={memory.origin}>
						<Icon name="warning" size="sm" tone="foreground" />
						<Text variant="caption" style={memory.flexText}>
							{visibility}
						</Text>
					</View>
				) : (
					<Text variant="caption" tone="muted-foreground">
						{visibility}
					</Text>
				)
			) : null}
			{choosing && audience ? (
				<AudiencePicker
					cast={audience.cast}
					initial={
						item.audience?.kind === "participants"
							? item.audience
							: { kind: "participants", members: [] }
					}
					label={CHOOSE_AUDIENCE_LABEL}
					submitLabel="Save"
					busy={false}
					onCancel={() => setChoosing(false)}
					onSubmit={(picked) => {
						setChoosing(false);
						// The shared validator runs before the write; storage runs it again.
						onSetAudience(item, requireSceneAudience(picked));
					}}
				/>
			) : audience && audience.options.length > 0 && !confirming ? (
				/*
				 * The choices, always visible (a finger has no hover), in `memoryVisibilityOptions`' order;
				 * a choice equal to the current value is not offered.
				 */
				<View style={memory.options}>
					{audience.options.map((option) => (
						<Button
							key={option.kind}
							label={memoryVisibilityOptionLabel(option)}
							accessibilityLabel={memoryVisibilityOptionAccessibilityLabel(
								option,
								label,
							)}
							variant="outline"
							size="sm"
							style={memory.option}
							onPress={() =>
								option.kind === "choose"
									? setChoosing(true)
									: onSetAudience(item, option.audience)
							}
						/>
					))}
				</View>
			) : null}
			{choosing ? null : confirming ? (
				<View style={memory.confirm}>
					<Text
						accessibilityRole="alert"
						variant="label"
						tone="muted-foreground"
						style={memory.confirmText}
					>
						Delete this memory?
					</Text>
					<Button
						label="Cancel"
						variant="outline"
						size="sm"
						onPress={() => setConfirming(false)}
					/>
					<Button
						label="Delete"
						variant="destructive"
						size="sm"
						accessibilityLabel={`Confirm deleting memory ${label}`}
						onPress={() => {
							setConfirming(false);
							onDelete(item);
						}}
					/>
				</View>
			) : (
				<View style={memory.rowActions}>
					{/* Pin state is not color-only: the glyph changes and `accessibilityState.selected` carries it. */}
					<RowAction
						icon={item.pinned ? "unpin" : "pin"}
						label={
							item.pinned ? `Unpin memory ${label}` : `Pin memory ${label}`
						}
						selected={item.pinned}
						onPress={() => onTogglePin(item)}
					/>
					<RowAction
						icon="edit"
						label={`Edit memory ${label}`}
						onPress={() => onEdit(item)}
					/>
					<RowAction
						icon="delete"
						label={`Delete memory ${label}`}
						destructive
						onPress={() => setConfirming(true)}
					/>
				</View>
			)}
		</View>
	);
}

function RowAction({
	icon,
	label,
	selected,
	destructive,
	onPress,
}: {
	icon: "pin" | "unpin" | "edit" | "delete";
	label: string;
	selected?: boolean;
	destructive?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={selected === undefined ? undefined : { selected }}
			onPress={onPress}
			hitSlop={SLOP}
			style={({ pressed }) => [memory.action, pressed && memory.pressed]}
		>
			{/*
			 * The same control changes state; it is not two buttons. Only the pin toggle changes glyph
			 * (web's `memory-dialog.tsx` uses the same primitive); for edit and delete `stateKey` is
			 * constant and nothing happens. The box size must not change, or the three adjacent actions
			 * get pushed (`animated-icon-swap.tsx` guards it). The name lives outside
			 * (`accessibilityLabel`) because both glyphs are briefly in the tree during the swap.
			 */}
			<AnimatedIconSwap stateKey={icon}>
				<Icon
					name={icon}
					size="md"
					tone={destructive ? "destructive" : "muted-foreground"}
				/>
			</AnimatedIconSwap>
		</Pressable>
	);
}

/**
 * Add and edit share one editor; only the initial value and the save operation differ, and the
 * caller passes both. Two copies would let the counter, validation or failure handling drift.
 */
function MemoryEditor({
	initial,
	onCancel,
	onSave,
	onSaved,
}: {
	initial: string;
	onCancel: () => void;
	onSave: (content: string) => Promise<unknown>;
	onSaved: () => void;
}) {
	const [draft, setDraft] = useState(initial);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	// A ref, not state: `setPending(true)` is invisible until the next render, so a second press in
	// the same tick would read the old value.
	const pendingRef = useRef(false);

	const length = chatTextLength(draft);

	const submit = () => {
		if (pendingRef.current) return;
		// Adding has nothing to compare with; `undefined` keeps `unchanged` from being returned.
		const plan = planMemorySave(draft, initial ? initial : undefined);
		if (plan.kind === "invalid") return setError(plan.message);
		if (plan.kind === "unchanged") return onCancel();

		pendingRef.current = true;
		setPending(true);
		setError(null);
		void onSave(plan.content)
			.then(onSaved)
			.catch((failure: unknown) => {
				pendingRef.current = false;
				setPending(false);
				setError(memorySaveFailureMessage(failure));
			});
	};

	return (
		<View style={memory.root}>
			<Textarea
				label="What to remember"
				value={draft}
				onChangeText={(next) => {
					setDraft(next);
					setError(null);
				}}
				autoFocus
				style={memory.editor}
			/>
			{length >= MEMORY_COUNTER_THRESHOLD ? (
				/*
				 * Only the current count rolls; the limit is a fixed fact and plain text. It changes per
				 * keystroke, hence `continuous` (same as web).
				 */
				<View style={memory.counter}>
					<AnimatedCount
						value={String(length)}
						cadence="continuous"
						variant="caption"
						tone="muted-foreground"
					/>
					<Text variant="caption" tone="muted-foreground">
						{` / ${CHAT_MEMORY_CONTENT_MAX_LENGTH}`}
					</Text>
				</View>
			) : null}
			{error ? <Notice tone="destructive" message={error} /> : null}
			<DialogActions>
				<Button
					label="Cancel"
					variant="outline"
					fullWidth
					onPress={onCancel}
					style={memory.actionButton}
				/>
				<Button
					label="Save"
					fullWidth
					onPress={submit}
					busy={pending}
					style={memory.actionButton}
				/>
			</DialogActions>
		</View>
	);
}

/** Stable empty array; a fresh one per render would redraw the list every time. */
const EMPTY: ChatMemory[] = [];
const NO_SCENES: ChatScene[] = [];

const memory = StyleSheet.create({
	root: { gap: space.md },
	list: { gap: space.sm },
	counter: { alignItems: "center", flexDirection: "row" },
	row: {
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		gap: space.sm,
		padding: space.md,
	},
	// The row's own `gap` already spaces it from above; a margin here would push this line down.
	origin: { alignItems: "center", flexDirection: "row", gap: space.xs },
	rowActions: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs,
		justifyContent: "flex-end",
	},
	confirm: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
	confirmText: { flex: 1 },
	flexText: { flexShrink: 1 },
	options: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	option: { flexShrink: 1 },
	action: {
		alignItems: "center",
		height: controlHeight.sm,
		justifyContent: "center",
		width: controlHeight.sm,
	},
	pressed: { opacity: 0.6 },
	editor: { minHeight: 120 },
	actionButton: { flex: 1 },
});
