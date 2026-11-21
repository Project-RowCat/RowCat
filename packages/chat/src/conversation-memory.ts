import type { ChatCharacter } from "./character.ts";
import { selectMemoriesForContext } from "./context.ts";
import { type ChatMemory, isAutoMemory } from "./memory.ts";
import type { ChatMessage } from "./model.ts";
import { admissionContext, memoryAdmitted } from "./prompt-scope.ts";
import {
	audienceKey,
	type ChatPerspective,
	type ChatScene,
	perspectiveAdmits,
	type ResolvedAudience,
	recallPerspective,
	resolveMessageAudiences,
} from "./scene.ts";
import type { ChatSummary } from "./summary.ts";

/**
 * Long-term memory: **afterstate is the only engine** (`docs/chat/MEMORY.md`).
 *
 * RowCat keeps the authoritative records — messages, the memories people write, scenes, characters —
 * and their E2EE sync. Everything automatic about remembering is afterstate's, embedded on the
 * device (a native module on mobile, a stdio child process on desktop):
 *
 * ```text
 * RowCat records ──reconcile──▶ afterstate index (passages, by id + revision)
 *                 ──consolidate▶ episodes (one per run of one audience; derived, cites its sources)
 *                                 │
 * turn ──recall + digests (perspective inside the search)──▶ re-checked against the live store
 *                                 ──▶ the request: recalled passages (last user turn) and
 *                                     earlier episodes (system prompt)
 * ```
 *
 * - **One owner, one pipeline.** There is no backend choice and no fallback. Memory V2 (model-written
 *   rolling summary and extracted memories) was removed; nothing here or in the apps can run it.
 * - **Nothing here is a second source of truth.** The index is derived from the store's live records
 *   (`reconcileConversation`), never synchronized, rebuilt per device, and can be deleted at any time.
 *   No model is called: consolidation is extractive (afterstate Dreaming's deterministic digest).
 * - **Authorization happens twice.** The bridge filters by the turn's perspective inside the search
 *   (forbidden passages never use up the limit); this adapter then checks every passage — and every
 *   source of every episode — against the store's own scenes and live text again, so a lagging index
 *   can never reintroduce a deleted, edited or newly restricted record.
 * - **Unavailable is reported, never replaced.** Without an engine (a plain browser, a native module
 *   that failed to load, a store that did not open) the conversation runs on its recent history alone,
 *   and `ChatMemoryStatus` says so. A slow or failing call drops long-term memory for that turn only.
 * - **Historical records are evidence, not memory.** V2's automatic memories and its last summary are
 *   indexed as model-written, attributed evidence, recalled only where their unknown audience is
 *   admissible (rooms without scenes). They never enter the memory block or the system prompt.
 * - **The transport is the app's.** `AfterstatePort` is the only door; this package has no platform
 *   imports (`boundaries.test.ts`).
 */

export type AfterstateOp =
	| "status"
	| "ingest"
	| "recall"
	| "reconcile"
	| "consolidate"
	| "digests"
	| "erase"
	| "sweep"
	| "verify"
	| "checkpoint";

/**
 * The native engine's door (protocol `afterstate-bridge/1`). Implementations resolve with the
 * response's `result` and reject on `ok: false` or a transport failure. Calls must not run on the
 * UI thread (the implementations hand them to a native worker or a child process).
 */
export interface AfterstatePort {
	call<T>(op: AfterstateOp, params: object): Promise<T>;
}

export const AFTERSTATE_PROTOCOL = "afterstate-bridge/1";

// ── Mapping ────────────────────────────────────────────────────────────────────────────────────

type BridgeRole = "user" | "character" | "narrator" | "model" | "system";

export type BridgeAudience =
	| { kind: "room" }
	| { kind: "participants"; members: string[] }
	| { kind: "narrator" };

export interface BridgeItem {
	conversation: string;
	record: "message" | "note" | "summary";
	id: string;
	revision: string;
	text: string;
	author: { role: BridgeRole; name?: string };
	at_ms?: number;
	labels?: string[];
	target?: { layer: "story" | "notes" | "ooc" };
	/** Absent: unknown (the bridge never reads absent as "everyone"). */
	audience?: BridgeAudience;
}

/** The bridge accepts these ids; anything else is reported, never rewritten. */
export const isBridgeId = (id: string): boolean =>
	/^[A-Za-z0-9_.:@-]{1,128}$/.test(id);

/** The record's HLC revision as one string. It changes on every edit, on every device alike. */
export const revisionOf = (record: Pick<ChatMessage, "rev">): string =>
	`${record.rev.t}.${record.rev.c}.${record.rev.d}`;

const millis = (iso: string): number | undefined => {
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : undefined;
};

/**
 * A message as the index sees it. The user's lines are user statements (their explicit `(OOC: …)`
 * asides are routed out of the story by the engine); the assistant's lines are **utterances** of
 * the speaker — said in the story, not established as true, never facts about the user.
 */
export function messageItem(
	message: ChatMessage,
	audience: ResolvedAudience = { kind: "unknown" },
): BridgeItem | null {
	if (!isBridgeId(message.id) || !isBridgeId(message.roomId)) return null;
	const speaker = message.speaker.trim();
	/*
	 * The audience is part of what is indexed, so it is part of the revision the index compares: a
	 * scene marked later re-indexes the messages it covers without touching the message records. An
	 * unknown audience leaves the revision as it was, so rooms without scenes are not re-indexed.
	 */
	const known = audience.kind === "unknown" ? null : audience;
	return {
		conversation: message.roomId,
		record: "message",
		id: message.id,
		revision: known
			? `${revisionOf(message)}~${audienceKey(known)}`.slice(0, 128)
			: revisionOf(message),
		...(known
			? {
					audience:
						known.kind === "participants"
							? { kind: "participants" as const, members: [...known.members] }
							: { kind: known.kind },
				}
			: {}),
		text: message.content,
		author: {
			role: message.role === "user" ? "user" : "character",
			...(speaker ? { name: speaker } : {}),
		},
		at_ms: millis(message.createdAt),
	};
}

/**
 * A memory as the index sees it: the user's exact words for a human-written memory; a memory V2
 * extracted is model-written (`model`, never `user`) and labelled `origin:auto`. Kept whole, never
 * rewritten; the record stays authoritative.
 */
export function noteItem(memory: ChatMemory): BridgeItem | null {
	if (!isBridgeId(memory.id) || !isBridgeId(memory.roomId)) return null;
	return {
		conversation: memory.roomId,
		record: "note",
		id: memory.id,
		revision: revisionOf(memory),
		text: memory.content,
		author: { role: isAutoMemory(memory) ? "model" : "user" },
		at_ms: millis(memory.createdAt),
		labels: [
			isAutoMemory(memory) ? "origin:auto" : "origin:user",
			...(memory.pinned ? ["pinned"] : []),
		],
	};
}

/**
 * Memory V2's stored summary as **migration input**: model-written (`model`), attributed
 * (`origin:v2-summary`), in the story layer with **no audience** — unknown. The bridge admits unknown
 * passages only to a perspective that includes unknown history, which RowCat sends only for rooms
 * without scenes; the adapter checks that again. So a summary built over a room before anyone marked
 * a private scene can never reach a character's turn once scenes exist. A retired (empty) summary is
 * not indexed, and its earlier passages are erased by the next reconcile.
 */
export function summaryItem(summary: ChatSummary): BridgeItem | null {
	if (!isBridgeId(summary.id) || !isBridgeId(summary.roomId)) return null;
	if (summary.deletedAt !== null || summary.summary.trim() === "") return null;
	return {
		conversation: summary.roomId,
		record: "summary",
		id: summary.id,
		revision: `${revisionOf(summary)}~e${summary.epoch}`.slice(0, 128),
		text: summary.summary,
		author: { role: "model" },
		at_ms: millis(summary.frontier?.createdAt ?? summary.updatedAt),
		labels: ["origin:v2-summary"],
		target: { layer: "story" },
	};
}

// ── Indexing ───────────────────────────────────────────────────────────────────────────────────

/** What the indexer reads. `ChatStore` satisfies it. */
export interface ConversationMemorySource {
	listAllMessages(roomId: string): Promise<ChatMessage[]>;
	listMemories(roomId: string): Promise<ChatMemory[]>;
	/** Scenes (who witnessed what). Absent: the room has none (every message is unknown audience). */
	listScenes?(roomId: string): Promise<ChatScene[]>;
	/** Characters added to the room (their aliases feed recall). */
	listCharacters?(roomId: string): Promise<ChatCharacter[]>;
	/** Memory V2's historical summary (migration input). Absent: none is imported. */
	getSummary?(roomId: string): Promise<ChatSummary | null>;
}

interface ReconcileResponse {
	missing: string[];
	stale: string[];
	orphaned: string[];
	erased_passages: number;
	current: number;
}

interface IngestResponse {
	items: { id: string; status: string; passages: number }[];
	cancelled: boolean;
}

export interface ReconcileKindReport {
	live: number;
	current: number;
	missing: number;
	stale: number;
	orphaned: number;
	erasedPassages: number;
	ingested: number;
	/** Live records whose id the bridge cannot take (left out of the index, never renamed). */
	rejected: number;
}

export interface ReconcileReport {
	messages: ReconcileKindReport;
	notes: ReconcileKindReport;
	summaries: ReconcileKindReport;
	/** False when `maxItems` stopped ingestion early; the next run continues (it is idempotent). */
	complete: boolean;
	dryRun: boolean;
}

/** Items per ingest call: under the bridge's 256 and small enough to yield between batches. */
export const CHAT_INDEX_BATCH = 64;
/** Items one background run ingests at most. A long imported room catches up over several runs. */
export const CHAT_INDEX_MAX_ITEMS_PER_RUN = 2_000;

/**
 * Brings the room's index in line with the store: erases what the store no longer has, (re)indexes
 * what is missing or changed. Idempotent and resumable: an interrupted run leaves a consistent
 * index (each record is written atomically) and the next run picks up where it stopped. `dryRun`
 * reports without writing (migration preview).
 *
 * This is also the **migration**: on first run it indexes the room's whole history, its memories
 * (human-written and V2's automatic ones, attributed) and V2's last summary — once, by id and
 * revision, so a repeated or interrupted run never duplicates anything.
 */
export async function reconcileConversation(
	port: AfterstatePort,
	source: ConversationMemorySource,
	roomId: string,
	options: { maxItems?: number; dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<ReconcileReport> {
	const dryRun = options.dryRun === true;
	let budget = options.maxItems ?? CHAT_INDEX_MAX_ITEMS_PER_RUN;
	let complete = true;
	const run = async <R extends { id: string }>(
		record: "message" | "note" | "summary",
		records: R[],
		toItem: (r: R) => BridgeItem | null,
	): Promise<ReconcileKindReport> => {
		const items = new Map<string, BridgeItem>();
		let rejected = 0;
		for (const r of records) {
			const item = toItem(r);
			if (!item || item.text.trim() === "") {
				if (!item && !isBridgeId(r.id)) rejected++;
				continue;
			}
			items.set(item.id, item);
		}
		const response = await port.call<ReconcileResponse>("reconcile", {
			conversation: roomId,
			record,
			live: [...items.values()].map((i) => ({
				id: i.id,
				revision: i.revision,
			})),
			dry_run: dryRun,
		});
		const todo = [...response.missing, ...response.stale]
			.map((id) => items.get(id))
			.filter((i): i is BridgeItem => i !== undefined);
		let ingested = 0;
		if (!dryRun) {
			const allowed = Math.min(todo.length, Math.max(0, budget));
			if (allowed < todo.length) complete = false;
			for (let i = 0; i < allowed; i += CHAT_INDEX_BATCH) {
				if (options.signal?.aborted) {
					complete = false;
					break;
				}
				const batch = todo.slice(i, Math.min(i + CHAT_INDEX_BATCH, allowed));
				const result = await port.call<IngestResponse>("ingest", {
					items: batch,
				});
				ingested += result.items.filter((x) => x.status !== "skipped").length;
				budget -= batch.length;
			}
		}
		return {
			live: items.size,
			current: response.current,
			missing: response.missing.length,
			stale: response.stale.length,
			orphaned: response.orphaned.length,
			erasedPassages: response.erased_passages,
			ingested,
			rejected,
		};
	};
	const [messages, memories, scenes, summary] = await Promise.all([
		source.listAllMessages(roomId),
		source.listMemories(roomId),
		source.listScenes ? source.listScenes(roomId) : Promise.resolve([]),
		source.getSummary ? source.getSummary(roomId) : Promise.resolve(null),
	]);
	const audiences = resolveMessageAudiences(messages, scenes);
	const messageReport = await run("message", messages, (m) =>
		messageItem(m, audiences.get(m.id)),
	);
	const noteReport = await run("note", memories, noteItem);
	const summaryReport = await run(
		"summary",
		summary ? [summary] : [],
		summaryItem,
	);
	return {
		messages: messageReport,
		notes: noteReport,
		summaries: summaryReport,
		complete,
		dryRun,
	};
}

interface ConsolidateResponse {
	episodes: number;
	current: number;
	written: number;
	retracted: number;
	pending: boolean;
	fenced?: boolean;
}

export interface ConsolidateReport {
	episodes: number;
	written: number;
	retracted: number;
	/** False when the per-run bound stopped it; the next run continues (idempotent). */
	complete: boolean;
}

/** Records per episode: about twelve exchanges, one screenful of story. */
export const CHAT_EPISODE_RECORDS = 24;
/** Episode writes per `consolidate` call, and calls per background run. */
export const CHAT_CONSOLIDATE_WRITES_PER_CALL = 16;
export const CHAT_CONSOLIDATE_CALLS_PER_RUN = 4;

/**
 * Consolidates the room's indexed story into **episodes**: maximal runs of messages that share one
 * audience, cut every `CHAT_EPISODE_RECORDS` records, each condensed by afterstate Dreaming's
 * deterministic digest (extractive, no model call) into one derived record that cites its sources.
 *
 * - A run never mixes audiences, so a private scene cannot become shared by being condensed; the
 *   episode carries its sources' audience and the same admission rule applies to it.
 * - Erasing or editing any source erases or invalidates the episode inside the engine; the next run
 *   rebuilds it from what is live. Bounded per call and per run; resumable.
 */
export async function consolidateConversation(
	port: AfterstatePort,
	roomId: string,
	options: { calls?: number; signal?: AbortSignal } = {},
): Promise<ConsolidateReport> {
	if (!isBridgeId(roomId))
		return { episodes: 0, written: 0, retracted: 0, complete: true };
	const calls = options.calls ?? CHAT_CONSOLIDATE_CALLS_PER_RUN;
	const report: ConsolidateReport = {
		episodes: 0,
		written: 0,
		retracted: 0,
		complete: false,
	};
	for (let i = 0; i < calls; i++) {
		if (options.signal?.aborted) return report;
		const r = await port.call<ConsolidateResponse>("consolidate", {
			conversation: roomId,
			max_records: CHAT_EPISODE_RECORDS,
			max_writes: CHAT_CONSOLIDATE_WRITES_PER_CALL,
		});
		report.episodes = r.episodes;
		report.written += r.written;
		report.retracted += r.retracted;
		if (r.fenced || !r.pending) {
			report.complete = true;
			return report;
		}
	}
	return report;
}

/** Erases a room's index (room deletion on this device). Physical erasure, every layer. */
export async function eraseConversation(
	port: AfterstatePort,
	roomId: string,
): Promise<number> {
	if (!isBridgeId(roomId)) return 0;
	const r = await port.call<{ erased_passages: number }>("erase", {
		conversation: roomId,
	});
	return r.erased_passages;
}

/**
 * Erases the index of every room the store no longer has: rooms deleted on another device (a sync
 * tombstone), or while the index was closed. Run after the store opens and after sync applies.
 */
export async function sweepConversations(
	port: AfterstatePort,
	liveRoomIds: readonly string[],
): Promise<{ orphaned: number; erasedPassages: number }> {
	const r = await port.call<{ orphaned: number; erased_passages: number }>(
		"sweep",
		{ live: liveRoomIds.filter(isBridgeId) },
	);
	return { orphaned: r.orphaned, erasedPassages: r.erased_passages };
}

/** `sweepConversations` against the store's own room list. */
export async function sweepDeletedRooms(
	port: AfterstatePort,
	store: { listRooms(): Promise<readonly { id: string }[]> },
): Promise<{ orphaned: number; erasedPassages: number }> {
	const rooms = await store.listRooms();
	return sweepConversations(
		port,
		rooms.map((r) => r.id),
	);
}

// ── Recall ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Characters the recalled block may take. 1,600 is about four short passages, roughly the size of
 * one long message, so a turn never grows by more than one message's worth.
 */
export const CHAT_RECALL_CONTEXT_CHAR_BUDGET = 1_600;
/** Passages at most, whatever their length. */
export const CHAT_RECALL_MAX_PASSAGES = 6;
/** Long-term memory slower than this is abandoned and the turn goes out without it. */
export const CHAT_RECALL_TIMEOUT_MS = 400;

export type ChatRecallLayer = "story" | "ooc" | "notes" | "character";

export interface ChatRecalledPassage {
	/** Record id (message, memory, episode or historical summary); not shown to the model. */
	id: string;
	layer: ChatRecallLayer;
	/**
	 * What the passage is: a message, a memory, a consolidated episode (`digest`), or V2's historical
	 * summary (`summary`). Absent reads as `message` for story/ooc and `note` for notes.
	 */
	kind?: "message" | "note" | "digest" | "summary";
	text: string;
	/** Who said it, for messages; null for notes. */
	speaker: string | null;
	role: "user" | "character" | "model" | "narrator" | "system";
	/** ISO time the record was written (an episode: its latest source). */
	at: string | null;
	/** Who witnessed it (messages; notes are `room`). Unknown only in rooms without scenes. */
	audience?: ResolvedAudience["kind"];
	/**
	 * A later record of this conversation says something about the same terms: this passage may be
	 * out of date. Not a verdict — the model reads it as "earlier" and the later record wins.
	 */
	superseded?: boolean;
	/** A memory V2 extracted (historical, model-written). Shown as such. */
	automatic?: boolean;
}

/** A turn's recalled passages, frozen when the generation starts (like memories). */
export interface ChatRecallSnapshot {
	passages: readonly ChatRecalledPassage[];
}

interface BridgeEvidence {
	layer: ChatRecallLayer;
	record: "message" | "note" | "summary" | "digest";
	id: string;
	passage: number;
	text: string;
	author: { role: ChatRecalledPassage["role"]; name?: string | null };
	at_ms?: number;
	score: number;
	audience?: ResolvedAudience["kind"];
	matched?: string[];
	sources?: string[];
}

/** The perspective as the bridge takes it. */
export function bridgePerspective(p: ChatPerspective): object {
	return p.kind === "participants"
		? { kind: "participants", members: p.members, unknown: p.unknown }
		: { kind: p.kind, unknown: p.unknown };
}

/**
 * Alias groups for recall: each added character's name with its aliases. Only groups with more than
 * one name; the bridge expands none of a name that two groups share (`afterstate` `alias_plan`).
 */
export function recallAliases(
	characters: readonly Pick<ChatCharacter, "name" | "aliases" | "deletedAt">[],
): string[][] {
	return characters
		.filter((c) => c.deletedAt === null && (c.aliases?.length ?? 0) > 0)
		.map((c) => [c.name, ...(c.aliases ?? [])].slice(0, 8))
		.slice(0, 32);
}

const HANGUL = /[가-힣]/;

/** Whether `text` contains the engine's term `term` (a lowercase word, or a Hangul bigram). */
export function containsTerm(text: string, term: string): boolean {
	const lower = text.toLowerCase();
	if (HANGUL.test(term)) return lower.includes(term);
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
		"u",
	).test(lower);
}

/** Words that ask about the present ("is it still…", "지금"). Then superseded passages are left out. */
const CURRENT =
	/\b(now|currently|current|still|anymore|nowadays|today|these days|at the moment)\b|지금|현재|요즘|아직|이제는|최근/i;
/** Words that ask about the past. Then superseded passages stay, marked as earlier. */
const PAST =
	/\b(used to|before|originally|at first|back then|formerly|previously|earlier|once|old)\b|예전|처음|원래|전에|그때|옛날|과거/i;

export type RecallTimeIntent = "current" | "past" | "any";

export function recallTimeIntent(query: string): RecallTimeIntent {
	if (PAST.test(query)) return "past";
	if (CURRENT.test(query)) return "current";
	return "any";
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Whether `passage` is still what `content` says: every line of the passage occurs in the live text.
 * Line-wise because the engine joins a passage's sentences and removes out-of-character asides; a
 * passage from an edited or rewritten version fails and is dropped.
 */
export function passageStillLive(passage: string, content: string): boolean {
	const live = normalize(content);
	return passage
		.split("\n")
		.map(normalize)
		.filter(Boolean)
		.every((line) => live.includes(line));
}

/**
 * The verbatim excerpts of an episode digest (afterstate Dreaming's deterministic digest: a header,
 * a keyword line, then `- ` excerpt lines, each a source turn cut at a word boundary and marked `…`).
 * The header and keywords are not shown to the model: dates there are record dates and keywords are
 * index terms.
 */
export function digestExcerpts(text: string): string[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("- "))
		.map((l) => l.slice(2).trim())
		.filter(Boolean);
}

/**
 * Whether every excerpt of an episode still occurs in its sources' live text. An excerpt is a prefix
 * of a source turn (cut and marked `…`), so its part before the mark must be found. An episode with no
 * excerpt, or one whose wording no longer exists, is dropped.
 */
export function digestStillLive(
	text: string,
	sources: readonly Pick<ChatMessage, "content" | "speaker">[],
): boolean {
	const excerpts = digestExcerpts(text);
	if (excerpts.length === 0) return false;
	const live = normalize(sources.map((s) => s.content).join("\n"));
	const speakers = new Set(
		sources.map((s) => s.speaker.trim()).filter(Boolean),
	);
	return excerpts.every((e) => {
		let body = normalize(e.replace(/[…]+$/u, "").replace(/\.\.\.$/, ""));
		if (!body) return true;
		// The engine labels an excerpt with its turn's speaker (`Rowan: …`), as the index stores it.
		const colon = body.indexOf(": ");
		if (colon > 0 && speakers.has(body.slice(0, colon).trim()))
			body = body.slice(colon + 2);
		// A digest may join a turn's lines; compare line by line, like passages.
		return body
			.split(/\s{2,}| \/ /)
			.map(normalize)
			.filter(Boolean)
			.every((line) => live.includes(line));
	});
}

/** User turns shorter than this many words get the end of the reply they answer added. */
export const CHAT_RECALL_SHORT_TURN_WORDS = 4;

/**
 * The query for this turn: the user's latest words. A short turn ("응, 어디 뒀더라", "what about
 * him?") points at the reply it answers, so for those the end of that reply is added. Bounded so a
 * pasted wall of text does not become a slow query.
 */
export function recallQuery(
	history: readonly Pick<ChatMessage, "role" | "content">[],
	userInput?: string,
): string {
	const lastUser = userInput?.trim()
		? userInput.trim()
		: ([...history]
				.reverse()
				.find((m) => m.role === "user")
				?.content.trim() ?? "");
	const words = lastUser.split(/\s+/).filter(Boolean).length;
	if (words >= CHAT_RECALL_SHORT_TURN_WORDS) return lastUser.slice(0, 1_200);
	const lastAssistant =
		[...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
	const tail = lastAssistant.trim().slice(-300);
	return [lastUser, tail].filter(Boolean).join("\n");
}

/**
 * Picks passages for the budget, best first, skipping (not stopping at) one that does not fit, then
 * orders them by time so the model reads a timeline. Pure and deterministic.
 */
export function selectRecallForContext(
	passages: readonly ChatRecalledPassage[],
	budget = CHAT_RECALL_CONTEXT_CHAR_BUDGET,
): ChatRecalledPassage[] {
	const chosen: ChatRecalledPassage[] = [];
	let used = 0;
	for (const p of passages) {
		if (chosen.length >= CHAT_RECALL_MAX_PASSAGES) break;
		const size = p.text.length + (p.speaker?.length ?? 0) + 24;
		if (used + size > budget) continue;
		chosen.push(p);
		used += size;
	}
	return chosen.sort(
		(a, b) =>
			(a.at ?? "").localeCompare(b.at ?? "") || a.id.localeCompare(b.id),
	);
}

export interface RecallTurnInput {
	roomId: string;
	query: string;
	/** Live messages of the room, oldest first (the validation snapshot). */
	messages: readonly ChatMessage[];
	/** Length of the history window this turn sends: the last N messages are excluded. */
	windowLength: number;
	/** This turn's memory snapshot; notes already in the memory block are not repeated. */
	memories: readonly (Pick<ChatMemory, "id" | "content"> &
		Partial<Pick<ChatMemory, "createdAt" | "source" | "audience">>)[];
	/** Ids of memories the memory block will carry. */
	memoryIdsInContext: ReadonlySet<string>;
	/** The room's scenes (none: every message is unknown audience, read as shared history). */
	scenes?: readonly ChatScene[];
	/** Alias groups (`recallAliases`). */
	aliases?: readonly (readonly string[])[];
	/** V2's historical summary (validation snapshot for a recalled summary passage). */
	summary?: Pick<ChatSummary, "id" | "summary" | "deletedAt"> | null;
	/** Marking (and, for present-tense questions, dropping) passages a later record overtook. */
	supersession?: boolean;
	/** Phase 11 behaviour for comparisons: send no perspective (no audience filtering at all). */
	unscoped?: boolean;
	/** Messages that follow each of the best story hits, carried with it; 0 turns it off. */
	continuation?: number;
	/** Search consolidated episodes too (default true). */
	digests?: boolean;
}

/**
 * How many following messages the best story hits bring along. A question names the scene but the
 * answer is said in the next lines, which share none of its words. Only the two best hits do, only
 * messages of the same scene (same audience) and only outside the history window.
 */
export const CHAT_RECALL_CONTINUATION = 2;
const CONTINUATION_ANCHORS = 2;

/** The admission check for one stored message under the turn's perspective. */
const admitsMessage = (
	input: Pick<RecallTurnInput, "unscoped">,
	perspective: ChatPerspective,
	audience: ResolvedAudience,
): boolean =>
	input.unscoped === true || perspectiveAdmits(perspective, audience);

/**
 * One turn's recall against the index, validated against the store snapshot. Throws on transport
 * failure (callers wrap it, see `createLongTermLoader`).
 */
export async function recallForTurn(
	port: AfterstatePort,
	input: RecallTurnInput,
): Promise<ChatRecallSnapshot> {
	if (!input.query.trim() || !isBridgeId(input.roomId)) return { passages: [] };
	const live = new Map(input.messages.map((m) => [m.id, m]));
	const windowIds = input.messages
		.slice(Math.max(0, input.messages.length - input.windowLength))
		.map((m) => m.id)
		.filter(isBridgeId)
		.slice(-500);
	const windowSet = new Set(windowIds);
	const notes = new Map(input.memories.map((m) => [m.id, m]));
	const scenes = (input.scenes ?? []).filter((s) => s.deletedAt === null);
	const perspective = recallPerspective(scenes);
	const admission = admissionContext(scenes);
	const audiences = resolveMessageAudiences(input.messages, scenes);
	const response = await port.call<{ evidence: BridgeEvidence[] }>("recall", {
		conversation: input.roomId,
		query: input.query.slice(0, 4_000),
		visible: {
			story: true,
			ooc: true,
			notes: true,
			...(input.digests === false ? {} : { digests: true }),
		},
		limit: 16,
		exclude: windowIds,
		...(input.unscoped ? {} : { perspective: bridgePerspective(perspective) }),
		...(input.aliases && input.aliases.length > 0
			? { aliases: input.aliases.map((g) => [...g]) }
			: {}),
	});
	const passages: ChatRecalledPassage[] = [];
	/** The matched terms of each passage, by index (notes: none). */
	const termsOf: string[][] = [];
	for (const e of response.evidence) {
		if (e.record === "message") {
			const message = live.get(e.id);
			if (!message || !passageStillLive(e.text, message.content)) continue;
			/*
			 * Checked again here, from the store's own scenes: the index filtered by the audience it was
			 * given when the message was indexed, and a scene changed since (on this device or by sync)
			 * may not be reconciled yet. Every layer, out-of-character asides included: an aside written
			 * during a private scene may name its secret.
			 */
			const audience = audiences.get(e.id) ?? { kind: "unknown" as const };
			if (!admitsMessage(input, perspective, audience)) continue;
			passages.push({
				id: e.id,
				layer: e.layer,
				kind: "message",
				text: e.text,
				speaker: e.author.name ?? null,
				role: e.author.role,
				at: message.createdAt,
				audience: audience.kind,
			});
			termsOf.push(e.matched ?? []);
		} else if (e.record === "digest") {
			const sources = (e.sources ?? []).map((id) => live.get(id));
			if (
				sources.length === 0 ||
				sources.some((s) => s === undefined) ||
				sources.every((s) => s && windowSet.has(s.id))
			)
				continue;
			const present = sources as ChatMessage[];
			const admitted = present.every((s) =>
				admitsMessage(
					input,
					perspective,
					audiences.get(s.id) ?? { kind: "unknown" },
				),
			);
			if (!admitted || !digestStillLive(e.text, present)) continue;
			const excerpts = digestExcerpts(e.text);
			const last = present[present.length - 1];
			passages.push({
				id: `digest:${e.id}`,
				layer: "story",
				kind: "digest",
				text: excerpts.join("\n"),
				speaker: null,
				role: "narrator",
				at: last?.createdAt ?? null,
				audience: audiences.get(present[0]?.id ?? "")?.kind ?? "unknown",
			});
			termsOf.push(e.matched ?? []);
		} else if (e.record === "summary") {
			/*
			 * V2's historical summary: only where unknown history is admissible (no scenes), only while the
			 * stored summary still says it.
			 */
			const stored = input.summary;
			if (
				!input.unscoped &&
				(scenes.length > 0 || perspective.unknown !== "include")
			)
				continue;
			if (
				!stored ||
				stored.deletedAt !== null ||
				stored.id !== e.id ||
				!passageStillLive(e.text, stored.summary)
			)
				continue;
			passages.push({
				id: `summary:${e.id}#${e.passage}`,
				layer: "story",
				kind: "summary",
				// Model-written by Memory V2: attributed as such wherever it is quoted.
				automatic: true,
				text: e.text,
				speaker: null,
				role: "model",
				at: e.at_ms ? new Date(e.at_ms).toISOString() : null,
				audience: "unknown",
			});
			termsOf.push(e.matched ?? []);
		} else if (e.record === "note") {
			const note = notes.get(e.id);
			if (
				!note ||
				input.memoryIdsInContext.has(e.id) ||
				normalize(note.content) !== normalize(e.text)
			)
				continue;
			if (note.source === "auto") {
				/*
				 * A memory V2 extracted: model-written, built over the whole room, no record of who saw what.
				 * Quoted (attributed) only where unknown history is admissible.
				 */
				if (!input.unscoped && scenes.length > 0) continue;
			} else if (
				!input.unscoped &&
				!memoryAdmitted({ source: "user", audience: note.audience }, admission)
			) {
				/** The memory block withholds it for this perspective; recall must not quote it back. */
				continue;
			}
			passages.push({
				id: e.id,
				layer: "notes",
				kind: "note",
				text: e.text,
				speaker: null,
				role: e.author.role,
				at: note.createdAt ?? null,
				audience: "room",
				...(note.source === "auto" ? { automatic: true } : {}),
			});
			termsOf.push([]);
		}
	}
	const withNext = addContinuation(
		passages,
		termsOf,
		input,
		audiences,
		perspective,
	);
	passages.splice(0, passages.length, ...withNext.passages);
	termsOf.splice(0, termsOf.length, ...withNext.terms);
	if (input.supersession === false)
		return { passages: selectRecallForContext(passages) };
	const marked = markSuperseded(
		passages.map((p, i) => ({ passage: p, terms: termsOf[i] ?? [] })),
		{
			window: input.messages.slice(
				Math.max(0, input.messages.length - input.windowLength),
				-1,
			),
			memories: input.memories,
		},
		input.aliases ?? [],
	);
	const intent = recallTimeIntent(input.query);
	const kept =
		intent === "current" ? marked.filter((p) => !p.superseded) : marked;
	return { passages: selectRecallForContext(kept) };
}

function addContinuation(
	passages: ChatRecalledPassage[],
	termsOf: string[][],
	input: RecallTurnInput,
	audiences: Map<string, ResolvedAudience>,
	perspective: ChatPerspective,
): { passages: ChatRecalledPassage[]; terms: string[][] } {
	const n = input.continuation ?? CHAT_RECALL_CONTINUATION;
	if (n <= 0) return { passages, terms: termsOf };
	const position = new Map(input.messages.map((m, i) => [m.id, i]));
	const windowStart = Math.max(0, input.messages.length - input.windowLength);
	const present = new Set(passages.map((p) => p.id));
	const out: ChatRecalledPassage[] = [];
	const terms: string[][] = [];
	let anchors = 0;
	passages.forEach((p, i) => {
		out.push(p);
		terms.push(termsOf[i] ?? []);
		if (
			anchors >= CONTINUATION_ANCHORS ||
			p.layer !== "story" ||
			(p.kind ?? "message") !== "message"
		)
			return;
		anchors++;
		const at = position.get(p.id);
		if (at === undefined) return;
		const scene = audiences.get(p.id) ?? { kind: "unknown" as const };
		const key =
			scene.kind === "participants"
				? `p:${scene.members.join(",")}`
				: scene.kind;
		for (let j = at + 1; j <= at + n && j < windowStart; j++) {
			const m = input.messages[j];
			if (!m || present.has(m.id)) continue;
			const a = audiences.get(m.id) ?? { kind: "unknown" as const };
			const aKey =
				a.kind === "participants" ? `p:${a.members.join(",")}` : a.kind;
			if (aKey !== key) break;
			if (!admitsMessage(input, perspective, a)) break;
			const text = m.content.trim().slice(0, 480);
			if (!text) continue;
			present.add(m.id);
			out.push({
				id: m.id,
				layer: "story",
				kind: "message",
				text,
				speaker: m.role === "user" ? m.speaker.trim() || null : null,
				role: m.role === "user" ? "user" : "character",
				at: m.createdAt,
				audience: a.kind,
			});
			terms.push([]);
		}
	});
	return { passages: out, terms };
}

/**
 * Marks passages that a later record of the conversation may have overtaken: a later message (a
 * recalled one, or one in the history window) or a human-written memory written after it contains
 * every content term the passage matched (at least two). Deterministic and cheap; it does not decide
 * what is true. It never marks a human-written memory (the user's record is authoritative), and a
 * model-written record (V2's memories and summary) is not authority enough to overtake anything.
 *
 * A term that is (part of) a character's name is also covered by any other name of that character
 * (`aliases`). A name two groups share expands nothing, as in the bridge.
 */
export function markSuperseded(
	items: readonly { passage: ChatRecalledPassage; terms: readonly string[] }[],
	later: {
		window: readonly Pick<ChatMessage, "id" | "content" | "createdAt">[];
		memories: readonly (Pick<ChatMemory, "id" | "content"> &
			Partial<Pick<ChatMemory, "createdAt" | "source">>)[];
	},
	aliases: readonly (readonly string[])[] = [],
): ChatRecalledPassage[] {
	const namesFor = aliasNames(aliases);
	const has = (text: string, t: string) =>
		containsTerm(text, t) ||
		(namesFor(t)?.some((n) => text.toLowerCase().includes(n)) ?? false);
	const authoritative = (p: ChatRecalledPassage) =>
		p.layer !== "notes" && p.kind !== "summary" && p.kind !== "digest";
	return items.map(({ passage, terms }) => {
		if (passage.layer === "notes" || terms.length < 2 || !passage.at)
			return passage;
		const at = passage.at;
		/*
		 * A question asserts nothing ("Is the bridge standing now?" must not overtake "the bridge was
		 * rebuilt"), and the turn being answered is one; neither can supersede.
		 */
		const covers = (text: string) =>
			!/[?？]\s*$/.test(text.trim()) && terms.every((t) => has(text, t));
		const newer =
			items.some(
				(o) =>
					o.passage.id !== passage.id &&
					authoritative(o.passage) &&
					(o.passage.at ?? "") > at &&
					covers(o.passage.text),
			) ||
			later.window.some(
				(m) => m.id !== passage.id && m.createdAt > at && covers(m.content),
			) ||
			later.memories.some(
				(m) =>
					m.source !== "auto" && (m.createdAt ?? "") > at && covers(m.content),
			);
		return newer ? { ...passage, superseded: true } : passage;
	});
}

/** For an engine term, the other names of the one character whose name contains it (else none). */
function aliasNames(
	groups: readonly (readonly string[])[],
): (term: string) => string[] | undefined {
	const of = (name: string, t: string) => {
		const n = name.toLowerCase();
		return HANGUL.test(t)
			? n.includes(t)
			: n.split(/[^\p{L}\p{N}]+/u).includes(t);
	};
	return (t) => {
		const owners = groups.filter((g) => g.some((n) => of(n, t)));
		const [only] = owners;
		if (owners.length !== 1 || !only) return undefined;
		return only.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0);
	};
}

// ── Consolidated episodes (the long-range context) ───────────────────────────────────────────────

/**
 * Characters the earlier-episodes block may take in the system prompt: the size V2's summary was
 * allowed (`CHAT_SUMMARY_MAX_LENGTH`), so replacing it does not grow the request.
 */
export const CHAT_CONSOLIDATED_CHAR_BUDGET = 2_000;
/** Episodes at most. */
export const CHAT_CONSOLIDATED_MAX_EPISODES = 8;

export interface ChatConsolidatedEpisode {
	/** The episode's key in the index; not shown to the model. */
	id: string;
	/** Verbatim excerpts of its source turns. */
	excerpts: readonly string[];
	/** ISO times of its first and last source. */
	from: string | null;
	to: string | null;
	/** Source message ids (for tests and the debugger; not shown to the model). */
	sources: readonly string[];
}

/** The episodes before the window, frozen when the generation starts. */
export interface ChatConsolidatedSnapshot {
	episodes: readonly ChatConsolidatedEpisode[];
}

interface BridgeDigest {
	id: string;
	text: string;
	sources: string[];
	from_ms?: number | null;
	to_ms?: number | null;
	audience?: ResolvedAudience["kind"];
}

/**
 * Picks episodes for the budget — newest first, skipping one that does not fit — then orders them by
 * time. Depends only on the stored episodes and the window, so between two window steps the selection
 * (and the cached system prompt) does not change.
 */
export function selectConsolidatedForContext(
	episodes: readonly ChatConsolidatedEpisode[],
	budget = CHAT_CONSOLIDATED_CHAR_BUDGET,
): ChatConsolidatedEpisode[] {
	const newestFirst = [...episodes].sort(
		(a, b) =>
			(b.to ?? "").localeCompare(a.to ?? "") || a.id.localeCompare(b.id),
	);
	const chosen: ChatConsolidatedEpisode[] = [];
	let used = 0;
	for (const e of newestFirst) {
		if (chosen.length >= CHAT_CONSOLIDATED_MAX_EPISODES) break;
		const size = e.excerpts.reduce((n, x) => n + x.length + 4, 24);
		if (used + size > budget) continue;
		chosen.push(e);
		used += size;
	}
	return chosen.sort(
		(a, b) =>
			(a.from ?? "").localeCompare(b.from ?? "") || a.id.localeCompare(b.id),
	);
}

export interface ConsolidatedTurnInput {
	roomId: string;
	/** Live messages of the room, oldest first (the validation snapshot). */
	messages: readonly ChatMessage[];
	/** Length of the history window this turn sends. */
	windowLength: number;
	scenes?: readonly ChatScene[];
}

/**
 * The earlier episodes this turn may draw on: those with at least one source before the history
 * window, admitted by the perspective inside the bridge and again here — every source live, every
 * source admitted under the store's current scenes, every excerpt still in the live text.
 */
export async function consolidatedForTurn(
	port: AfterstatePort,
	input: ConsolidatedTurnInput,
): Promise<ChatConsolidatedSnapshot> {
	if (!isBridgeId(input.roomId)) return { episodes: [] };
	const live = new Map(input.messages.map((m) => [m.id, m]));
	const windowIds = input.messages
		.slice(Math.max(0, input.messages.length - input.windowLength))
		.map((m) => m.id)
		.filter(isBridgeId)
		.slice(-500);
	const windowSet = new Set(windowIds);
	const scenes = (input.scenes ?? []).filter((s) => s.deletedAt === null);
	const perspective = recallPerspective(scenes);
	const audiences = resolveMessageAudiences(input.messages, scenes);
	const response = await port.call<{ digests: BridgeDigest[] }>("digests", {
		conversation: input.roomId,
		perspective: bridgePerspective(perspective),
		exclude: windowIds,
		limit: 32,
	});
	const episodes: ChatConsolidatedEpisode[] = [];
	for (const d of response.digests ?? []) {
		const sources = d.sources.map((id) => live.get(id));
		if (sources.length === 0 || sources.some((s) => s === undefined)) continue;
		const present = sources as ChatMessage[];
		if (present.every((s) => windowSet.has(s.id))) continue;
		if (
			!present.every((s) =>
				perspectiveAdmits(
					perspective,
					audiences.get(s.id) ?? { kind: "unknown" },
				),
			)
		)
			continue;
		if (!digestStillLive(d.text, present)) continue;
		episodes.push({
			id: d.id,
			excerpts: digestExcerpts(d.text),
			from: present[0]?.createdAt ?? null,
			to: present[present.length - 1]?.createdAt ?? null,
			sources: present.map((s) => s.id),
		});
	}
	return { episodes: selectConsolidatedForContext(episodes) };
}

// ── Runtime wiring (shared by web, desktop and mobile) ────────────────────────────────────────────

/**
 * Whether this conversation has long-term memory right now — the value the screens state.
 *
 * - `ready`: the engine is open and the last call worked.
 * - `indexing`: the engine is open and still catching up on this room's history (a long room's first
 *   open); recall covers what is indexed so far.
 * - `degraded`: the engine is open but the last call failed or timed out; the turn went out with its
 *   recent history only.
 * - `unavailable`: there is no engine on this device (a plain browser, a module that failed to load).
 *   Only the recent conversation and the memories people wrote are used.
 */
export type ChatMemoryStatus =
	| "ready"
	| "indexing"
	| "degraded"
	| "unavailable";

/** Counters only: no text, no ids. Diagnostics read these. */
export interface MemoryEngineEvent {
	kind:
		| "recall"
		| "recall-failed"
		| "recall-timeout"
		| "index"
		| "index-failed"
		| "consolidate"
		| "consolidate-failed";
	ms: number;
	passages?: number;
	episodes?: number;
	chars?: number;
	dropped?: number;
	ingested?: number;
	erased?: number;
	written?: number;
}

export interface ConversationMemoryRuntime {
	/** The engine, or null where this platform has none. */
	port: AfterstatePort | null;
	/** Observability hook; must not throw and must not keep content. */
	observe?: (event: MemoryEngineEvent) => void;
	/** Clock for measurements (tests inject one). */
	now?: () => number;
}

export interface RecallRequest {
	query: string;
	windowLength: number;
	memories: readonly ChatMemory[];
	memoryIdsInContext: ReadonlySet<string>;
}

/** What a turn takes from long-term memory, frozen when the generation starts. */
export interface ChatLongTermSnapshot {
	recall: ChatRecallSnapshot | null;
	consolidated: ChatConsolidatedSnapshot | null;
	status: ChatMemoryStatus;
}

/** The scenes, alias groups and historical summary a turn needs, read when the source provides them. */
async function recallScope(
	source: ConversationMemorySource,
	roomId: string,
): Promise<{
	scenes: ChatScene[];
	aliases: string[][];
	summary: ChatSummary | null;
}> {
	const [scenes, characters, summary] = await Promise.all([
		source.listScenes ? source.listScenes(roomId) : Promise.resolve([]),
		source.listCharacters ? source.listCharacters(roomId) : Promise.resolve([]),
		source.getSummary ? source.getSummary(roomId) : Promise.resolve(null),
	]);
	return { scenes, aliases: recallAliases(characters), summary };
}

/**
 * The recall request for a turn, from the snapshots the generation already took: the history window
 * it will send (its length, and its last turns as the query) and the memories (which of them the
 * memory block will carry, by the same admission and selection functions, so a note is never quoted
 * twice and a withheld one is never quoted at all). Web and mobile call this one function.
 */
export function recallRequestFor(
	history: readonly Pick<ChatMessage, "role" | "content">[],
	memories: readonly ChatMemory[],
	userInput?: string,
	scope?: { scenes?: readonly ChatScene[] },
): RecallRequest {
	const context = admissionContext(scope?.scenes);
	const inBlock = memories.filter((m) => memoryAdmitted(m, context));
	return {
		query: recallQuery(history, userInput),
		windowLength: history.length,
		memories,
		memoryIdsInContext: new Set(
			selectMemoriesForContext(inBlock).map((m) => m.id),
		),
	};
}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T | "timeout"> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve("timeout"), ms);
		work.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});

/** Per port: each room's indexing state, so the loader can say `indexing` honestly. */
const indexState = new WeakMap<
	AfterstatePort,
	Map<string, { complete: boolean }>
>();

const roomsOf = <V>(
	table: WeakMap<AfterstatePort, Map<string, V>>,
	port: AfterstatePort,
): Map<string, V> => {
	let rooms = table.get(port);
	if (!rooms) {
		rooms = new Map();
		table.set(port, rooms);
	}
	return rooms;
};

/**
 * The conversation's long-term memory for a turn. Never throws and never waits longer than
 * `CHAT_RECALL_TIMEOUT_MS`. Without a port it answers `unavailable` at once.
 *
 * `protectedRoom`: the server assembles that room's prompt, so recall (which rides in the last user
 * turn of a device-assembled request) does not apply; the consolidated episodes still do — they travel
 * in the request's long-term-context field (`storyChatAssemblyRequest`).
 */
export function createLongTermLoader(
	runtime: ConversationMemoryRuntime | null | undefined,
	source: ConversationMemorySource,
	roomId: string,
	options: { protectedRoom?: boolean } = {},
): (request: RecallRequest) => Promise<ChatLongTermSnapshot> {
	const port = runtime?.port ?? null;
	if (!runtime || !port)
		return async () => ({
			recall: null,
			consolidated: null,
			status: "unavailable",
		});
	const now = runtime.now ?? (() => Date.now());
	const observe = (event: MemoryEngineEvent) => {
		try {
			runtime.observe?.(event);
		} catch {
			// Observability never breaks a turn.
		}
	};
	return async (request) => {
		const started = now();
		try {
			const [messages, scope] = await Promise.all([
				source.listAllMessages(roomId),
				recallScope(source, roomId),
			]);
			const work = Promise.all([
				options.protectedRoom
					? Promise.resolve<ChatRecallSnapshot | null>(null)
					: recallForTurn(port, {
							roomId,
							query: request.query,
							messages,
							windowLength: request.windowLength,
							memories: request.memories,
							memoryIdsInContext: request.memoryIdsInContext,
							scenes: scope.scenes,
							aliases: scope.aliases,
							summary: scope.summary,
						}),
				/*
				 * Episodes are an addition to recall, not a condition of it: a bridge that cannot answer
				 * them (an older engine build) leaves the turn with recall alone.
				 */
				consolidatedForTurn(port, {
					roomId,
					messages,
					windowLength: request.windowLength,
					scenes: scope.scenes,
				}).catch((): ChatConsolidatedSnapshot => ({ episodes: [] })),
			]);
			const result = await withTimeout(work, CHAT_RECALL_TIMEOUT_MS);
			if (result === "timeout") {
				observe({ kind: "recall-timeout", ms: now() - started });
				return { recall: null, consolidated: null, status: "degraded" };
			}
			const [recall, consolidated] = result;
			observe({
				kind: "recall",
				ms: now() - started,
				passages: recall?.passages.length ?? 0,
				episodes: consolidated.episodes.length,
				chars:
					(recall?.passages.reduce((n, p) => n + p.text.length, 0) ?? 0) +
					consolidated.episodes.reduce(
						(n, e) => n + e.excerpts.join("").length,
						0,
					),
			});
			const indexing =
				roomsOf(indexState, port).get(roomId)?.complete === false;
			return {
				recall,
				consolidated,
				status: indexing ? "indexing" : "ready",
			};
		} catch {
			observe({ kind: "recall-failed", ms: now() - started });
			return { recall: null, consolidated: null, status: "degraded" };
		}
	};
}

const inflight = new WeakMap<AfterstatePort, Map<string, Promise<void>>>();

/**
 * The conversation's background maintenance: index the room (reconcile), then consolidate it. `void`,
 * never throws, one run per room at a time (a call while one runs is folded into it — the running one
 * reads the store at its start, so a second run is queued once). Woken after the assistant reply is
 * saved, and when a room opens. Without a port there is nothing to maintain and it is absent.
 *
 * This is the **only** automatic memory pipeline: no model is called, nothing is synchronized, and no
 * other scheduler processes the same conversation.
 */
export function createMaintainer(
	runtime: ConversationMemoryRuntime | null | undefined,
	source: ConversationMemorySource,
	roomId: string,
): (() => void) | undefined {
	const port = runtime?.port ?? null;
	if (!runtime || !port) return undefined;
	const now = runtime.now ?? (() => Date.now());
	const table = roomsOf(inflight, port);
	const states = roomsOf(indexState, port);
	const observe = (event: MemoryEngineEvent) => {
		try {
			runtime.observe?.(event);
		} catch {
			// ignore
		}
	};
	let queued = false;
	const runOnce = async (): Promise<void> => {
		const started = now();
		let complete = false;
		try {
			const report = await reconcileConversation(port, source, roomId);
			complete = report.complete;
			observe({
				kind: "index",
				ms: now() - started,
				ingested:
					report.messages.ingested +
					report.notes.ingested +
					report.summaries.ingested,
				erased:
					report.messages.erasedPassages +
					report.notes.erasedPassages +
					report.summaries.erasedPassages,
			});
		} catch {
			observe({ kind: "index-failed", ms: now() - started });
			return;
		}
		const consolidating = now();
		try {
			const c = await consolidateConversation(port, roomId);
			complete = complete && c.complete;
			observe({
				kind: "consolidate",
				ms: now() - consolidating,
				episodes: c.episodes,
				written: c.written,
			});
		} catch {
			observe({ kind: "consolidate-failed", ms: now() - consolidating });
		} finally {
			states.set(roomId, { complete });
		}
	};
	return () => {
		const running = table.get(roomId);
		if (running) {
			if (!queued) {
				queued = true;
				const next = running.then(() => {
					queued = false;
					return runOnce();
				});
				table.set(roomId, next);
				void next.finally(() => {
					if (table.get(roomId) === next) table.delete(roomId);
				});
			}
			return;
		}
		const run = runOnce();
		table.set(roomId, run);
		void run.finally(() => {
			if (table.get(roomId) === run) table.delete(roomId);
		});
	};
}

/**
 * The status a screen states before any turn ran: `unavailable` without an engine, otherwise
 * `indexing` until the room's first maintenance run completed, then `ready`.
 */
export function memoryStatusFor(
	runtime: ConversationMemoryRuntime | null | undefined,
	roomId: string,
): ChatMemoryStatus {
	const port = runtime?.port ?? null;
	if (!port) return "unavailable";
	const state = indexState.get(port)?.get(roomId);
	return state?.complete === false || state === undefined
		? "indexing"
		: "ready";
}

/**
 * What a room's session gets from long-term memory, composed once for both apps: the loader (always
 * present — it answers `unavailable` without an engine) and `maintain` (absent without an engine).
 */
export function conversationMemoryHooks(
	runtime: ConversationMemoryRuntime | null | undefined,
	source: ConversationMemorySource,
	roomId: string,
	options: { protectedRoom?: boolean } = {},
): {
	loadLongTermMemory: (request: RecallRequest) => Promise<ChatLongTermSnapshot>;
	maintain?: () => void;
} {
	const maintain = createMaintainer(runtime, source, roomId);
	return {
		loadLongTermMemory: createLongTermLoader(runtime, source, roomId, options),
		...(maintain ? { maintain } : {}),
	};
}
