import {
	CHAT_MEMORY_CONTENT_MAX_LENGTH,
	CHAT_MEMORY_MAX_PER_ROOM,
	type ChatMemory,
	ChatMemoryLimitError,
	ChatRoomMissingError,
	type ChatStore,
	isAutoMemory,
	promoteMemoryPatch,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { Pencil, Pin, PinOff, Plus, Sparkles, Trash2 } from "lucide-react";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { useLocalMemories } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import type { ManagedRoom } from "../room/management.tsx";
import {
	groupMemories,
	MEMORY_COUNTER_THRESHOLD,
	memoryContentLength,
	memoryDeleteFailureMessage,
	memoryRoomGoneMessage,
	memorySaveFailureMessage,
	planMemorySave,
} from "./form.ts";

/**
 * Memory: where the person writes and edits, by hand, what this conversation should keep
 * remembering.
 *
 * This screen owns no values. The memory's owner is the conversation store (`ChatMemoryStore`), the
 * rules belong to `@rowcat/chat`, and moving memories to other devices is sync's job. What is here
 * is only those three things moved into a shape a person can touch.
 *
 * **It does not call `syncNow()`.** A write creates the dirty record on the spot, and the write
 * signal wrapped at the assembly point wakes automatic sync (`local-data/stores.ts`). If the screen
 * called sync directly, a second path would run alongside the automatic one.
 *
 * **There is no button to have AI create memories — yet AI-created memories exist.**
 *
 * Those are different things. Automatic maintenance is a background job that runs by itself as the
 * conversation grows (`use-memory-maintenance.ts`), and there is no trigger for the user to press.
 * A button would be a paid "generate now" action, and it would bring progress indicators, failure
 * copy and duplicate-run protection with it. That screen would be a product this slice never built.
 *
 * Instead the list **says where each memory came from.** An automatic memory is a sentence the user
 * never wrote, and without a mark, someone who cannot recall when they wrote something starts
 * doubting their own memory. The mark also says what an edit means: automatic memories can be
 * replaced or deleted as the conversation continues, and human-written ones are not. That shows in
 * the fact that the badge disappears the moment the memory is edited.
 *
 * The list is a `liveQuery` subscription, so it is not refreshed by hand after writes. Edits from
 * another tab, and remote memories that sync brought in, arrive through the same subscription. This
 * screen knows neither SSE nor sync.
 */

/** What is open on this row right now — one at a time. */
type RowMode = "idle" | "editing" | "confirming-delete";

export function MemoryDialog({
	room,
	onClose,
}: {
	/** The room as it was when the window opened: identity and title. The source of truth is still IndexedDB. */
	room: ManagedRoom;
	onClose: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const { store, ownsStore } = useChatScope();
	const { items, loading } = useLocalMemories(room.id);
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const errorId = useId();

	/**
	 * Closes the window **if the account changes while it is open.**
	 *
	 * If Alice opens the memory window and signs out without closing it, and Bob signs in, the window
	 * would show Alice's conversation title on Bob's screen. The writes below check ownership again,
	 * but that is a defence after the press, and this check comes first. `room-management.tsx` uses
	 * the same shape for the same reason.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: close only at the moment the scope changes.
	useEffect(() => {
		if (!store) onClose();
	}, [store]);

	/**
	 * Checks ownership with the store **just before** an irreversible action, and folds a failure into
	 * one sentence.
	 *
	 * It is important not to swap in the store of the scope currently open. Otherwise an operation
	 * started on Alice's screen would finish in Bob's database.
	 */
	const run = async (
		perform: (store: ChatStore) => Promise<void>,
		failureMessage: string,
	): Promise<boolean> => {
		if (!store || !ownsStore(store)) {
			onClose();
			return false;
		}
		setPending(true);
		setError(null);
		try {
			await perform(store);
			return true;
		} catch (failure) {
			if (failure instanceof ChatRoomMissingError) {
				setError(memoryRoomGoneMessage());
				return false;
			}
			if (failure instanceof ChatMemoryLimitError) {
				setError(t("memory.limit", { max: CHAT_MEMORY_MAX_PER_ROOM }));
				return false;
			}
			// The raw Dexie error is not shown: it does not say what the user can do.
			console.error("[chat] a memory operation failed", failure);
			setError(failureMessage);
			return false;
		} finally {
			setPending(false);
		}
	};

	const groups = groupMemories(items);
	const full = items.length >= CHAT_MEMORY_MAX_PER_ROOM;

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			{/*
			 * On narrow screens this is a sheet rising from the bottom; above `sm` it is a centred dialog, using the same
			 * geometry as room settings. The memory list can grow long, so it needs both `max-h` and inner scrolling
			 * (especially when the keyboard rises on a 390px screen). Otherwise the add button is pushed off-screen.
			 */}
			<DialogContent
				closeButtonDisabled={pending}
				placement="adaptive"
				className="top-auto bottom-0 max-h-[85dvh] w-full max-w-full flex flex-col gap-0 rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:rounded-xl"
			>
				{/*
				 * `min-w-0` is the key to this line. `DialogContent` is a grid, so its children's minimum size is `auto`. The
				 * description line below is `truncate` (= `white-space: nowrap`), so its whole title becomes the min-content size.
				 * Instead of truncating, **the grid cell grows to fit the title**, and every line in the window is pushed off-screen
				 * (this really happened at 390px). For truncation to work, the width it truncates to must be fixed first.
				 */}
				<DialogHeader className="min-w-0 border-b px-5 py-4 text-left">
					<DialogTitle>{t("dialog.memory")}</DialogTitle>
					<DialogDescription className="truncate" title={room.title}>
						{room.title}
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4">
					{/*
					 * The add form opens **inside the same window**. A nested dialog would make it unpredictable which one Escape
					 * closes, and if the outer one closed first, the text being written would vanish with it.
					 */}
					{/*
					 * The trigger and the form are **two states in the same place**. If they switched abruptly the form would not
					 * say where it came from, so the switch is drawn briefly. `mode="wait"` is used because this place is a single
					 * result slot (`work-lifecycle-controls.tsx` uses the same value for the same reason). Overlapping them made the
					 * window grow and shrink back by one button's and one form's height for that one frame.
					 *
					 * `adding` is not delayed. The state changes on press and the form arrives after; focus movement is tied to the
					 * form's mount, not to this transition.
					 */}
					<AnimatePresence initial={false} mode="wait">
						{adding ? (
							<m.div
								key="editor"
								initial={rowEnter.initial}
								animate={rowEnter.animate}
								exit={rowExit}
								transition={rowEnter.transition}
							>
								<MemoryEditor
									label={t("dialog.whatToRemember")}
									submitLabel={t("dialog.add")}
									pending={pending}
									onCancel={() => {
										setAdding(false);
										setError(null);
									}}
									onSubmit={async (content) => {
										const ok = await run(
											/**
											 * The created record is not held by the screen. The list is drawn by its subscription,
											 * and holding the value here would keep the same memory in two places.
											 */
											async (chat) => {
												await chat.createMemory({ roomId: room.id, content });
											},
											memorySaveFailureMessage(),
										);
										if (ok) setAdding(false);
										return ok;
									}}
								/>
							</m.div>
						) : (
							<m.div
								key="trigger"
								className="flex flex-col"
								initial={rowEnter.initial}
								animate={rowEnter.animate}
								exit={rowExit}
								transition={rowEnter.transition}
							>
								<Button
									variant="outline"
									className="h-10 justify-start sm:h-9"
									disabled={!store || full}
									onClick={() => {
										setError(null);
										setAdding(true);
									}}
								>
									<Plus aria-hidden="true" />
									{t("dialog.addMemory")}
								</Button>
							</m.div>
						)}
					</AnimatePresence>

					{full && !adding && (
						<p className="text-sm text-muted-foreground">
							{t("memory.full", { max: CHAT_MEMORY_MAX_PER_ROOM })}
						</p>
					)}

					{error && (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}

					{/*
					 * Empty and loading are different statements. If "no saved memories" were shown before the subscription's first
					 * result arrived, a person opening a room that does have memories would read for one frame that their memories
					 * had vanished.
					 */}
					{loading ? (
						<p className="py-6 text-center text-sm text-muted-foreground">
							{t("dialog.loadingMemories")}
						</p>
					) : items.length === 0 ? (
						<div className="py-6 text-center">
							<p className="text-sm font-medium">
								{t("dialog.noMemoriesSavedYet")}
							</p>
							{/*
							 * **Does not promise automatic extraction.** "It builds up on its own as the conversation grows" is true
							 * today (maintenance really runs), but this screen cannot say when that point comes (around the 60th
							 * message), and a reader who waits for it will write nothing. Only the one thing they can do now is named.
							 */}
							<p className="mt-1 text-sm text-muted-foreground">
								{t("dialog.youCanAddInformationYou")}
							</p>
						</div>
					) : (
						/*
						 * The two sections are **one layout family.** Turning pinning on or off moves a row from `Other`
						 * to `Pinned`, and that move changes the height of both `<ul>`s at once. If they were not
						 * grouped, each would measure separately, and one would move first.
						 */
						<LayoutGroup>
							<div className="flex flex-col gap-4">
								{groups.pinned.length > 0 && (
									<MemoryGroup title={t("dialog.pinned")}>
										{groups.pinned.map((memory) => (
											<MemoryRow
												key={memory.id}
												memory={memory}
												pending={pending}
												run={run}
											/>
										))}
									</MemoryGroup>
								)}
								{groups.others.length > 0 && (
									<MemoryGroup
										title={
											groups.pinned.length > 0
												? t("dialog.other")
												: t("dialog.savedMemories")
										}
									>
										{groups.others.map((memory) => (
											<MemoryRow
												key={memory.id}
												memory={memory}
												pending={pending}
												run={run}
											/>
										))}
									</MemoryGroup>
								)}
							</div>
						</LayoutGroup>
					)}

					{/*
					 * Says in one line only what memory does. Vocabulary such as context budget or pinning priority is ours, not the
					 * person's, so only the result is stated here.
					 */}
					<p className="text-sm text-muted-foreground">
						{t("dialog.savedMemoriesAreSentAlong")}
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function MemoryGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h3 className="mb-2 text-xs font-semibold text-muted-foreground">
				{title}
			</h3>
			{/*
			 * The presence boundary is **per section.** It cannot be one for both, because the two sections are different
			 * `<ul>`s and `AnimatePresence` only sees its direct children. Continuity of a row moving between sections is
			 * handled by `layoutId` instead (`MemoryRow`).
			 *
			 * `initial={false}` means memories already present when the window opens do not rise up. What actually appears is
			 * only the rows added afterwards, or ones sync brought in.
			 */}
			<ul className="flex flex-col gap-2">
				<AnimatePresence initial={false}>{children}</AnimatePresence>
			</ul>
		</section>
	);
}

/**
 * One memory row: its content and three actions.
 *
 * Edit and delete confirmation open **inside the row.** A separate confirmation dialog would stack
 * a second window, and Escape's target would become unclear. These actions are irreversible, as
 * deleting a conversation is, but what is lost is a different size: one memory line.
 *
 * Confirmation is still required. Immediate deletion cannot be undone (there is no undo structure),
 * and this list is also opened on narrow screens operated by finger.
 */
function MemoryRow({
	memory,
	pending,
	run,
}: {
	memory: ChatMemory;
	pending: boolean;
	run: (
		perform: (store: ChatStore) => Promise<void>,
		failureMessage: string,
	) => Promise<boolean>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [mode, setMode] = useState<RowMode>("idle");
	/**
	 * This row has three buttons, so **presses are blocked during exit** (a place where it differs
	 * from the sentence in `feedback.ts`). On a tab that receives no frames, exit lasts indefinitely
	 * rather than 120ms, and a delete button on a memory that was already removed would still be
	 * pressable.
	 */
	const exiting = useExitGuard();
	/**
	 * The head of the content. It makes the accessible names of the action buttons say **which
	 * memory** they belong to.
	 *
	 * The ellipsis on truncation is for people who do not see the screen. Without it, a long memory
	 * name would break mid-sentence and run into the next words (`Pin memory`), reading as a single
	 * sentence.
	 */
	const trimmed = memory.content.trim();
	const label =
		[...trimmed].length > 20
			? `${[...trimmed].slice(0, 20).join("")}…`
			: trimmed;

	return (
		/*
		 * **One shell.** At one point edit mode replaced the whole `<li>`, so fixing the same memory
		 * looked like one row disappearing and another appearing. In this list, editing is not an
		 * identity change.
		 *
		 * `layoutId` provides **continuity across sections.** When pinning is turned on, this row
		 * unmounts from the `Other` `<ul>` and mounts in the `Pinned` `<ul>` (React cannot link the instances
		 * because the parents differ). With the same name, Motion treats the two as one object and draws
		 * it moving from the old seat to the new one. Without it, what the user pressed would look like
		 * "disappears here, appears there", and they could not follow visually what they moved.
		 *
		 * Deriving the name from the memory id is an allowed place (`docs/motion/ARCHITECTURE.md`: a
		 * visual namespace, not an identity). Conversely, do not build code that parses this string to
		 * find a memory.
		 *
		 * `layout="position"` is also a rule. Projecting size as well would make rows with different
		 * heights match each other, and the text would grow and shrink. What moves in this list is the
		 * seat, not the box.
		 */
		<m.li
			layoutId={`chat-memory:${memory.id}`}
			layout="position"
			className="rounded-lg border p-3"
			style={exiting}
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
		>
			{/*
			 * Display and edit are **two states of the same row.** Stacked, the row would be twice as tall for that one frame and
			 * then snap back, so it is `mode="wait"`. Height is not animated: the final geometry is set immediately and only the
			 * content arrives via opacity (`docs/motion/ARCHITECTURE.md`, "height animation").
			 */}
			<AnimatePresence initial={false} mode="wait">
				{mode === "editing" ? (
					<m.div
						key="editing"
						initial={rowEnter.initial}
						animate={rowEnter.animate}
						exit={rowExit}
						transition={rowEnter.transition}
					>
						<MemoryEditor
							label={t("dialog.memoryContent")}
							submitLabel={t("common:actions.save")}
							initialValue={memory.content}
							pending={pending}
							onCancel={() => setMode("idle")}
							onSubmit={async (content) => {
								/**
								 * **Rewritten in place — not deleted and recreated.** Deleting and recreating would change
								 * the identity: on another device it would look like one thing removed and another added,
								 * and the merge would lose the basis for comparing the two versions.
								 */
								/**
								 * **The moment it is edited, the memory is this person's own text** (`promoteMemoryPatch`).
								 *
								 * If it were not promoted, the memory would stay automatic, and the next maintenance run
								 * would treat it as an "old automatic fact" and replace or delete it. To the user, the
								 * sentence they just edited would later return or vanish, and since nothing happened in
								 * between they could not guess the cause.
								 *
								 * Applying this patch to a human-written memory changes nothing (it is already `"user"`),
								 * so there is no branch that splits on source.
								 */
								const ok = await run(
									(store) =>
										store.updateMemory(memory.id, promoteMemoryPatch(content)),
									memorySaveFailureMessage(),
								);
								if (ok) setMode("idle");
								return ok;
							}}
						/>
					</m.div>
				) : (
					<m.div
						key="display"
						initial={rowEnter.initial}
						animate={rowEnter.animate}
						exit={rowExit}
						transition={rowEnter.transition}
					>
						<p className="text-sm break-words whitespace-pre-wrap">
							{memory.content}
						</p>
						{/*
						 * The source mark is attached **to automatic memories only.** If every human-written memory carried a `Saved by you`
						 * label, almost every row in the list would show the same badge, and a badge that distinguishes
						 * nothing only takes space. A mark is worth something only when it sits on the **rarer** side.
						 *
						 * It does not rely on colour alone. The word is there too, so someone who cannot distinguish colour reads the same
						 * fact, and a screen reader reads the word as it is.
						 */}
						{isAutoMemory(memory) ? (
							<p className="mt-1.5 flex items-center gap-1 text-muted-foreground text-xs">
								<Sparkles aria-hidden="true" className="size-3" />
								{t("dialog.rememberedByAi")}
							</p>
						) : null}
						{/*
						 * The delete confirmation **replaces the action group inside this row.** It is one state in the same place, so
						 * `mode="wait"` applies here too, and the confirmation text arrives exactly where the action buttons were. The
						 * question being asked reads from its position.
						 */}
						<AnimatePresence initial={false} mode="wait">
							{mode === "confirming-delete" ? (
								<m.div
									key="confirm"
									className="mt-3 flex flex-wrap items-center gap-2"
									initial={rowEnter.initial}
									animate={rowEnter.animate}
									exit={rowExit}
									transition={rowEnter.transition}
								>
									<span className="flex-1 text-sm text-muted-foreground">
										{t("dialog.deleteThisMemory")}
									</span>
									<Button
										size="sm"
										variant="outline"
										disabled={pending}
										onClick={() => setMode("idle")}
									>
										{t("common:actions.cancel")}
									</Button>
									<Button
										size="sm"
										variant="destructive"
										disabled={pending}
										onClick={() =>
											void run(
												(store) => store.deleteMemory(memory.id),
												memoryDeleteFailureMessage(),
											)
										}
									>
										{t("common:actions.delete")}
									</Button>
								</m.div>
							) : (
								<m.div
									key="actions"
									className="mt-2 flex items-center justify-end gap-1"
									initial={rowEnter.initial}
									animate={rowEnter.animate}
									exit={rowExit}
									transition={rowEnter.transition}
								>
									{/*
									 * Not icon-only. When a list of memories has pin buttons the same width as the rest, a screen
									 * reader user hearing `Pin` has no way to know which memory it belongs to.
									 */}
									<Button
										variant="ghost"
										size="icon-sm"
										className="size-9 sm:size-8"
										aria-pressed={memory.pinned}
										aria-label={
											memory.pinned
												? t("memory.unpin", { label })
												: t("memory.pin", { label })
										}
										disabled={pending}
										onClick={() =>
											void run(
												(store) =>
													store.updateMemory(memory.id, {
														pinned: !memory.pinned,
													}),
												memorySaveFailureMessage(),
											)
										}
									>
										{/*
										 * While the row crosses sections, the pictogram on the trigger also switches. Two facts (where
										 * it is, and what pressing will do) must arrive at the same rhythm for the action to read as one
										 * operation. The state itself is still said by `aria-pressed` and the name.
										 */}
										<AnimatedIconSwap
											stateKey={memory.pinned ? "pinned" : "unpinned"}
										>
											{memory.pinned ? (
												<PinOff aria-hidden="true" />
											) : (
												<Pin aria-hidden="true" />
											)}
										</AnimatedIconSwap>
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										className="size-9 sm:size-8"
										aria-label={t("memory.edit", { label })}
										disabled={pending}
										onClick={() => setMode("editing")}
									>
										<Pencil aria-hidden="true" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										className="size-9 text-destructive hover:text-destructive sm:size-8"
										aria-label={t("memory.delete", { label })}
										disabled={pending}
										onClick={() => setMode("confirming-delete")}
									>
										<Trash2 aria-hidden="true" />
									</Button>
								</m.div>
							)}
						</AnimatePresence>
					</m.div>
				)}
			</AnimatePresence>
		</m.li>
	);
}

/**
 * The form for writing content. Adding and editing **use the same thing.**
 *
 * Two copies would let the limit copy, the character count and the validation timing diverge. Only
 * the label and the button name differ, so those are passed as arguments.
 */
function MemoryEditor({
	label,
	submitLabel,
	initialValue = "",
	pending,
	onCancel,
	onSubmit,
}: {
	label: string;
	submitLabel: string;
	initialValue?: string;
	pending: boolean;
	onCancel: () => void;
	/** Resolves true on successful save. The failure copy is drawn by the outer side (one per window). */
	onSubmit: (content: string) => Promise<boolean>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [value, setValue] = useState(initialValue);
	const [invalid, setInvalid] = useState<string | null>(null);
	const fieldId = useId();
	const errorId = useId();
	const ref = useRef<HTMLTextAreaElement>(null);
	/** Blocks a second submit in the same tick. Pressing the button twice really does happen. */
	const pendingRef = useRef(false);

	useEffect(() => {
		const frame = requestAnimationFrame(() => ref.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);

	const length = memoryContentLength(value);

	const submit = async (): Promise<void> => {
		if (pendingRef.current) return;
		const plan = planMemorySave(value, initialValue ? initialValue : undefined);
		if (plan.kind === "invalid") {
			setInvalid(plan.message);
			ref.current?.focus();
			return;
		}
		if (plan.kind === "unchanged") {
			onCancel();
			return;
		}
		pendingRef.current = true;
		setInvalid(null);
		try {
			await onSubmit(plan.content);
		} finally {
			pendingRef.current = false;
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			{/* The label is a real `<label>`: a placeholder alone makes the name disappear while typing. */}
			<label htmlFor={fieldId} className="text-sm font-medium">
				{label}
			</label>
			<Textarea
				id={fieldId}
				ref={ref}
				rows={3}
				value={value}
				onChange={(event) => {
					setValue(event.target.value);
					if (invalid) setInvalid(null);
				}}
				onKeyDown={(event) => {
					/**
					 * Enter is a line break, since a memory can span several lines. Save is by ⌘/Ctrl+Enter and
					 * the button, and Escape cancels (it folds only this form, without closing the dialog).
					 */
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						void submit();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onCancel();
					}
				}}
				aria-invalid={invalid !== null}
				aria-describedby={invalid ? errorId : undefined}
				disabled={pending}
			/>
			<div className="flex items-start justify-between gap-3">
				{invalid ? (
					<p id={errorId} role="alert" className="text-sm text-destructive">
						{invalid}
					</p>
				) : (
					<span />
				)}
				{length > MEMORY_COUNTER_THRESHOLD && (
					<span
						className={`shrink-0 text-xs tabular-nums ${
							length > CHAT_MEMORY_CONTENT_MAX_LENGTH
								? "text-destructive"
								: "text-muted-foreground"
						}`}
					>
						{/* Only the current count moves. The limit is an unchanging fact. */}
						<AnimatedCount value={String(length)} cadence="continuous" />/
						{CHAT_MEMORY_CONTENT_MAX_LENGTH}
					</span>
				)}
			</div>
			<div className="flex justify-end gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={onCancel}
					disabled={pending}
				>
					{t("common:actions.cancel")}
				</Button>
				<Button size="sm" onClick={() => void submit()} disabled={pending}>
					{pending ? t("dialog.saving") : submitLabel}
				</Button>
			</div>
		</div>
	);
}
