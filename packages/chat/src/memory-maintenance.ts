import { CHAT_HISTORY_LIMIT } from "./context.ts";
import {
	CHAT_AUTO_MEMORY_MAX_PER_ROOM,
	CHAT_MEMORY_MAX_PER_ROOM,
	type ChatMemory,
	checkAutoMemoryContent,
	isAutoMemory,
	memoryDedupeKey,
} from "./memory.ts";
import type { ChatMessage } from "./model.ts";
import {
	type ChatSummary,
	type ChatSummaryFrontier,
	clampSummary,
	compareMessagePosition,
	isAfterFrontier,
	normalizeSummary,
} from "./summary.ts";

/**
 * The complete rules of automatic maintenance: when it runs, what it processes, and what it may
 * commit. Pure functions only, with no storage, fetch, or React. Web and mobile can check the same
 * table without rendering. Inside a hook, the only test would be a long conversation run by hand.
 * Failures here are silent: the same fact saved twenty times, the frontier running ahead so a
 * stretch is never summarized, or one model-made operation deleting a memory the user wrote. Not
 * answered here: what makes a good fact (the prompt's job, see maintenance-prompt.ts); when it runs
 * (scheduling is app wiring; shouldRunMemoryMaintenance answers only "should it run now"); who
 * commits (storage, in one transaction).
 */

/**
 * The number of recent messages that summarization leaves untouched. It equals the history limit by
 * design. The frontier never moves past this window, so summarized and raw ranges never overlap.
 * Two consequences follow. One: no content appears in two blocks. If the frontier entered the
 * window, those messages would be sent as raw text and as summary, spending tokens twice and making
 * the model see one event twice. Two: history rewrites rarely touch the frontier. Edits,
 * regenerations, and deletes usually happen in the last few turns, which are not yet processed.
 * Rewinds are therefore rare, and that rarity is what makes the simple strategy of discarding the
 * whole summary workable.
 */
export const CHAT_MAINTENANCE_RECENT_KEEP = CHAT_HISTORY_LIMIT;

/**
 * Minimum backlog before a run starts: unprocessed messages pushed out of the window must reach
 * this count. Runs are paid model calls, and running after every assistant response would double
 * conversation cost. 20 is roughly 10 turns, so the first run comes around message 60 and then
 * about every 10 turns. The legacy value was not ported. Its window was centered on 25 and this one
 * is 40, so copying the value would summarize stretches not yet pushed out of the window.
 */
export const CHAT_MAINTENANCE_TRIGGER = 20;

/**
 * Maximum messages per run. This is the catch-up step size. A room far behind (for example, 300
 * turns advanced on another device and synced here, or conversations from before this feature
 * existed) can have hundreds of unprocessed messages. One request that large would exceed the
 * model's context, and one failure would stop all progress. Chunks of 40 limit a failure to losing
 * 40 messages' worth of progress; the next assistant response resumes from there. A run never loops
 * internally, because ten paid calls in a row would go out silently while the user keeps chatting.
 */
export const CHAT_MAINTENANCE_BATCH_MAX = 40;

/**
 * Character budget for raw batch content, on top of the count limit. Count alone is not enough: one
 * message can reach the contract limit (40,000 characters), so 40 of them could reach 1.6 million
 * characters. Every provider would reject that, and retries would fail the same way, so this room's
 * maintenance would fail permanently. When over budget, the batch shrinks from the back, never from
 * the front, since a front cut would open a gap between frontier and batch. A single remaining
 * message is sent as is. One large message should not halt the room; the per-message clamp in the
 * assembler handles that case.
 */
export const CHAT_MAINTENANCE_BATCH_CHAR_BUDGET = 24_000;

/**
 * Maximum new automatic memories a single run may add. Models will produce twenty if asked, and
 * most are facts that will never be used again ("it rained that day"). The narrow limit is a
 * quality control: with six slots the model must choose, and if it does not, the code keeps the
 * first six in order. Replacements and removals do not count, since they add no memories and remove
 * stale facts.
 */
export const CHAT_MAINTENANCE_MAX_ADDS_PER_RUN = 6;

/**
 * Maximum operations a single run may propose. This is a parse-stage limit. It differs from the
 * limit above, which controls how many are accepted. This one controls how many are read at all.
 * Without it, one malformed response could carry tens of thousands of entries, and validating that
 * array would itself be costly.
 */
export const CHAT_MAINTENANCE_MAX_OPERATIONS = 24;

/** Minimum message shape read by batch selection. Sync metadata and usage are not read. */
export type MaintenanceMessage = Pick<
	ChatMessage,
	"id" | "role" | "speaker" | "content" | "createdAt"
>;

export interface MaintenanceBatch {
	/** Messages to process this run, in ascending order. Each run starts right after the frontier. */
	messages: MaintenanceMessage[];
	/** Frontier position to move to on a successful commit (the batch's last message). */
	through: ChatSummaryFrontier;
	/** Unprocessed messages left after this batch. Diagnostic only. */
	remaining: number;
}

export interface SelectMaintenanceBatchInput {
	messages: readonly MaintenanceMessage[];
	/** Current frontier. null means processing starts from the beginning. */
	frontier: ChatSummaryFrontier | null;
}

/**
 * Chooses the stretch to process this run. Returns null if there is none. Order is the rule:
 * 1. Set aside the most recent KEEP messages. Messages still in the raw window are never
 *    summarized.
 * 2. Keep only what follows the frontier. Nothing already processed is processed again.
 * 3. Return null below TRIGGER. Paid calls do not go out every turn.
 * 4. Cut by BATCH_MAX and the character budget. Step 1 must come before step 2. Reversed, a room
 *    whose frontier already lies inside the window (after an older version's state, or right after
 *    a rewind) would summarize its newest messages, and the same text would appear raw and
 *    summarized. It is also safe when the frontier appears to move backward: messages before it are
 *    filtered out in step 2, and a room whose frontier was removed by a rewind is scanned from the
 *    start.
 */
export function selectMaintenanceBatch(
	input: SelectMaintenanceBatchInput,
): MaintenanceBatch | null {
	const { messages, frontier } = input;

	const settled =
		messages.length > CHAT_MAINTENANCE_RECENT_KEEP
			? messages.slice(0, messages.length - CHAT_MAINTENANCE_RECENT_KEEP)
			: [];

	const pending = settled.filter((message) =>
		isAfterFrontier(message, frontier),
	);

	if (pending.length < CHAT_MAINTENANCE_TRIGGER) return null;

	let batch = pending.slice(0, CHAT_MAINTENANCE_BATCH_MAX);
	while (
		batch.length > 1 &&
		batchChars(batch) > CHAT_MAINTENANCE_BATCH_CHAR_BUDGET
	)
		batch = batch.slice(0, batch.length - 1);

	const last = batch[batch.length - 1];
	/**
	 * Unreachable after the step-3 check, since the batch cannot be empty. Returns null rather than
	 * inventing a value.
	 */
	if (!last) return null;

	return {
		messages: batch,
		through: { createdAt: last.createdAt, messageId: last.id },
		remaining: pending.length - batch.length,
	};
}

const batchChars = (messages: readonly MaintenanceMessage[]): number =>
	messages.reduce((total, message) => total + message.content.length, 0);

/**
 * Whether maintenance should start in this room now. Calls the same function as batch selection.
 * Writing the two checks separately would create a path that says "run" and then finds nothing to
 * process. That path would send a useless request every turn.
 */
export const shouldRunMemoryMaintenance = (
	input: SelectMaintenanceBatchInput,
): boolean => selectMaintenanceBatch(input) !== null;

/**
 * One operation on an automatic memory. The model states an intent; it does not issue database
 * commands. Because the shape can express only a few fixed intents, "delete every memory in this
 * room" or "change another room" cannot be written. There is no room id field, and the target is
 * always a memory id from this room's snapshot.
 */
export type AutoMemoryOperation =
	| { type: "add"; content: string }
	| { type: "replace"; memoryId: string; content: string }
	| { type: "remove"; memoryId: string };

/** Shape the maintenance request is asked to return. It has passed schema validation. */
export interface ChatMaintenanceResult {
	summary: string;
	memoryOperations: AutoMemoryOperation[];
}

/**
 * A validated state transition. Storage commits this value as-is. The plan is separated from the
 * commit because the commit is a transaction. If the rules ran inside it, each storage
 * implementation (Dexie on web, SQLite on mobile) would hold its own copy, and one copy would
 * always lag. The symptom would be a user's memories disappearing on one device only.
 */
export interface ChatMaintenancePlan {
	/** New summary text, after clamping. */
	summary: string;
	through: ChatSummaryFrontier;
	/** Surviving operations. All of them target automatic memories. */
	operations: AutoMemoryOperation[];
	/**
	 * Value storage rechecks just before commit. This is optimistic concurrency. Maintenance takes
	 * seconds from start to finish. Meanwhile history can be rewritten, another device can sync, or
	 * another run can finish. The plan would then rest on a conversation that no longer exists, and
	 * committing it would store a summary of events the user deleted. AbortController cannot prevent
	 * this: a request whose body has arrived ignores the signal and succeeds, the same as with
	 * generation ownership. The check is therefore a comparison inside the commit transaction, with no
	 * window between reading and writing.
	 */
	expect: {
		/** Generation read at start. If a rewind happened since, the current value is larger. */
		epoch: number;
		/** Frontier read at start. A different value means another run committed first. */
		frontier: ChatSummaryFrontier | null;
	};
}

export interface PlanMemoryMaintenanceInput {
	/** Live memories from the snapshot taken when maintenance started. */
	memories: readonly ChatMemory[];
	summary: ChatSummary | null;
	result: ChatMaintenanceResult;
	through: ChatSummaryFrontier;
}

/**
 * Turns the model's proposal into a plan that is safe to commit. This is the slice's trust
 * boundary. Everything above (model output) is untrusted; everything below (the plan) is executed
 * by storage as-is. So this function only rejects, and never invents.
 * - replace or remove of a manual memory: dropped. Users edit their own text.
 * - id not in the snapshot: dropped. The model fabricated the reference.
 * - memory already deleted: dropped. The snapshot holds only live memories.
 * - over the length limit or empty: dropped. Never saved truncated.
 * - normalized content matches an existing memory, manual ones included: dropped.
 * - duplicate within the same batch: dropped.
 * - second operation on the same memory: only the first is kept.
 * - more than six adds: only the first six are accepted.
 * - adds beyond the per-room or total limit: not accepted. There are no partial failures. If one
 *   operation is dropped, the rest and the summary still commit. Maintenance is best-effort;
 *   rolling back a batch over one discarded candidate would reprocess the same range forever.
 */
export function planMemoryMaintenance(
	input: PlanMemoryMaintenanceInput,
): ChatMaintenancePlan {
	const { memories, summary, result, through } = input;

	const byId = new Map(memories.map((memory) => [memory.id, memory]));
	/**
	 * Normalized keys of all live memories, manual ones included. Including manual ones is the point
	 * of this rule.
	 */
	const takenKeys = new Set(
		memories.map((memory) => memoryDedupeKey(memory.content)),
	);
	const touched = new Set<string>();

	const liveCount = memories.length;
	const autoCount = memories.filter(isAutoMemory).length;

	const operations: AutoMemoryOperation[] = [];
	let adds = 0;
	/** Removals free slots, so whether an add fits is counted again as the loop proceeds. */
	let removed = 0;

	for (const operation of result.memoryOperations.slice(
		0,
		CHAT_MAINTENANCE_MAX_OPERATIONS,
	)) {
		if (operation.type === "remove") {
			const target = byId.get(operation.memoryId);
			if (!target || !isAutoMemory(target) || touched.has(target.id)) continue;
			touched.add(target.id);
			operations.push(operation);
			removed += 1;
			continue;
		}

		const checked = checkAutoMemoryContent(operation.content);
		if (!checked.ok) continue;
		const key = memoryDedupeKey(checked.content);

		if (operation.type === "replace") {
			const target = byId.get(operation.memoryId);
			if (!target || !isAutoMemory(target) || touched.has(target.id)) continue;
			/**
			 * The duplicate check for a replace excludes the memory itself. Otherwise a replace that only
			 * rewords a memory would always match itself and never pass.
			 */
			const others = new Set(takenKeys);
			others.delete(memoryDedupeKey(target.content));
			if (others.has(key)) continue;

			touched.add(target.id);
			takenKeys.delete(memoryDedupeKey(target.content));
			takenKeys.add(key);
			operations.push({ ...operation, content: checked.content });
			continue;
		}

		// add
		if (adds >= CHAT_MAINTENANCE_MAX_ADDS_PER_RUN) continue;
		if (takenKeys.has(key)) continue;
		/**
		 * Checks for room. Both limits are checked. The automatic limit keeps automatic memories from
		 * using the slots meant for the user's own. The total limit blocks what storage would otherwise
		 * throw on. A throw would fail the whole commit and lose the summary and frontier with it.
		 */
		if (autoCount - removed + adds >= CHAT_AUTO_MEMORY_MAX_PER_ROOM) continue;
		if (liveCount - removed + adds >= CHAT_MEMORY_MAX_PER_ROOM) continue;

		takenKeys.add(key);
		adds += 1;
		operations.push({ type: "add", content: checked.content });
	}

	/**
	 * An empty summary does not erase the current one. This happens in practice: the model may find
	 * nothing to record in this batch, or a truncated response may return only an empty summary.
	 * Overwriting with an empty string would lose hundreds of turns of context in one response. That
	 * loss cannot be undone, since the frontier has already moved and the stretch cannot be summarized
	 * again.
	 */
	const next = normalizeSummary(result.summary);
	return {
		summary: clampSummary(next || (summary?.summary ?? "")),
		through,
		operations,
		expect: {
			epoch: summary?.epoch ?? 0,
			frontier: summary?.frontier ?? null,
		},
	};
}

export interface PlanMaintenanceRewindInput {
	summary: ChatSummary | null;
	memories: readonly ChatMemory[];
	/**
	 * Start time of the erased stretch: the earliest createdAt among messages the rewrite actually
	 * removed. Rewrites always cut the tail (tail-rewrite.ts), so this one value fully expresses
	 * "everything from here on is gone".
	 */
	cutoffCreatedAt: string;
}

export interface ChatMaintenanceRewind {
	/**
	 * Whether the summary must be discarded entirely. This is why there is no partial rewind. A
	 * summary is prose and cannot be subtracted: from a summary of M1..M50, the part covering M40..M50
	 * cannot be removed. Asking the model to do it would mean resending conversation that no longer
	 * exists. So a rewind discards the summary and clears the frontier, and rebuilding from what
	 * remains is better than keeping wrong sentences. That recomputation is rare. The frontier sits
	 * outside the most recent 40 messages, so ordinary edits, regenerations, and deletes from the
	 * frontier leave this false. It applies only when the user goes far back and deletes old history,
	 * which is exactly when the summary would be wrong.
	 */
	resetSummary: boolean;
	/**
	 * Automatic memory ids to delete: only those extracted from the erased stretch. Unlike summaries,
	 * memories can be rewound precisely. Each record carries its source time (ChatMemory.originAt), so
	 * facts drawn from a surviving conversation stay. Without this, one edit would erase the room's
	 * entire long-term memory. Manual memories never appear here. A sentence the user wrote is their
	 * data, not a derivative of the chat, and its source message being deleted does not mean they
	 * withdrew it. Automatic memories with no source time (rows from an older version) are also
	 * deleted, since there is no basis for keeping them. The next maintenance run corrects that error.
	 */
	staleMemoryIds: string[];
}

/**
 * What a history rewrite must do to maintenance state. It applies in the same transaction as the
 * rewrite (storage's editUserMessage, deleteFromMessage, deleteMessage). If split, the message
 * would be gone while the summary describing it stayed alive, and a generation started in between
 * would include that summary.
 */
export function planMaintenanceRewind(
	input: PlanMaintenanceRewindInput,
): ChatMaintenanceRewind {
	const { summary, memories, cutoffCreatedAt } = input;

	/**
	 * Whether the frontier reaches into the erased stretch. If the frontier time is before the cutoff,
	 * the summary never saw any erased message, so doing nothing is correct. The comparison uses
	 * timestamps, not message ids, because the message is being deleted right now. On equal times it
	 * errs toward resetting (>=): an extra reset costs one recomputation, while the opposite error
	 * would leave an erased event remembered in the summary.
	 */
	const resetSummary =
		summary !== null &&
		summary.frontier !== null &&
		summary.frontier.createdAt >= cutoffCreatedAt;

	const staleMemoryIds = memories
		.filter(
			(memory) =>
				isAutoMemory(memory) &&
				(memory.originAt === null || memory.originAt >= cutoffCreatedAt),
		)
		.map((memory) => memory.id);

	return { resetSummary, staleMemoryIds };
}

/** Whether the rewind changes anything. Prevents storage from issuing an empty revision. */
export const rewindChangesAnything = (rewind: ChatMaintenanceRewind): boolean =>
	rewind.resetSummary || rewind.staleMemoryIds.length > 0;

/**
 * Generation number for the summary record after a rewind. Always incremented. This value is what
 * lets a rewind win in a merge. Without the increment, concurrent progress from another device
 * would overwrite the rewind and bring back the summary of deleted conversation.
 */
export const nextSummaryEpoch = (summary: ChatSummary | null): number =>
	(summary?.epoch ?? 0) + 1;

/** Called by storage inside the transaction to decide whether this plan may still be committed. */
export function maintenanceStillApplies(
	plan: ChatMaintenancePlan,
	current: ChatSummary | null,
): boolean {
	if ((current?.epoch ?? 0) !== plan.expect.epoch) return false;
	const now = current?.frontier ?? null;
	const expected = plan.expect.frontier;
	if (now === null || expected === null) return now === expected;
	return (
		compareMessagePosition(
			{ createdAt: now.createdAt, id: now.messageId },
			{ createdAt: expected.createdAt, id: expected.messageId },
		) === 0
	);
}
