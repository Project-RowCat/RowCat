import type { ChatCharacter } from "./character.ts";
import { selectMemoriesForContext } from "./context.ts";
import type { ChatMemory } from "./memory.ts";
import type { ChatMessage } from "./model.ts";
import {
	audienceKey,
	type ChatPerspective,
	type ChatScene,
	perspectiveAdmits,
	type ResolvedAudience,
	recallPerspective,
	resolveMessageAudiences,
} from "./scene.ts";

/**
 * Conversation memory backends: one contract for every app and every provider.
 *
 * RowCat's records stay the source of truth. `legacy` is memory V2 as it was (pinned/recent memories
 * within budget, the rolling summary, the history window). `afterstate` adds a **local derived
 * index** (the afterstate engine, embedded natively on the device) that finds earlier passages of
 * this conversation which have scrolled out of the history window and quotes the relevant ones into
 * the turn. `shadow` runs the afterstate recall beside V2 and records how it did, without changing
 * the request.
 *
 * - **Nothing here is a second source of truth.** The index is rebuilt from the store's live
 *   records (`reconcileConversation`). It never synchronizes, never writes a ChatMemory, never edits
 *   a summary. Sync, conflict resolution, tombstones and the E2EE envelope are untouched: each
 *   device indexes what it decrypted.
 * - **Recall is checked against the store before use.** The index can lag (a deletion that arrived
 *   by sync a moment ago, an edit not reconciled yet). Every recalled passage must still be
 *   contained in a live record of the snapshot this turn read, or it is dropped. A deleted or
 *   rewritten message cannot come back through the index.
 * - **Failure is silence.** No port, a closed store, an index still building, a slow call: the turn
 *   goes out as V2 would have sent it. A recall never fails a turn and never delays it by more than
 *   `CHAT_RECALL_TIMEOUT_MS`.
 * - **The transport is the app's.** `AfterstatePort` is the only door; web/desktop/mobile supply it
 *   (a stdio host on desktop, a native module on mobile) or supply none. This package has no
 *   platform imports (`boundaries.test.ts`).
 */

export type MemoryBackendMode = "legacy" | "afterstate" | "shadow";

export const MEMORY_BACKEND_MODES: readonly MemoryBackendMode[] = [
	"legacy",
	"afterstate",
	"shadow",
];

/** Unknown or absent values are `legacy`: an unreadable setting must not switch the backend. */
export function parseMemoryBackendMode(value: unknown): MemoryBackendMode {
	return MEMORY_BACKEND_MODES.includes(value as MemoryBackendMode)
		? (value as MemoryBackendMode)
		: "legacy";
}

/**
 * The mode that actually runs. `afterstate` and `shadow` need a port; without one (the web build,
 * a native module that failed to load, a store that did not open) the conversation is `legacy`.
 * That fallback is the rollback path too: switching back never touches a record.
 */
export function effectiveMemoryBackend(
	requested: MemoryBackendMode,
	port: AfterstatePort | null | undefined,
): MemoryBackendMode {
	return port ? requested : "legacy";
}

export type AfterstateOp =
	| "status"
	| "ingest"
	| "recall"
	| "reconcile"
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
	record: "message" | "note";
	id: string;
	revision: string;
	text: string;
	author: { role: BridgeRole; name?: string };
	at_ms?: number;
	labels?: string[];
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
 *
 * Incomplete (cut-off) and empty messages are indexed as they are stored; deleted ones never reach
 * here (the store does not return them).
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
 * A memory as the index sees it: the user's exact words for `user`, the model's for `auto`
 * (`model`, never `user`). Kept whole, never rewritten; the record stays authoritative.
 */
export function noteItem(memory: ChatMemory): BridgeItem | null {
	if (!isBridgeId(memory.id) || !isBridgeId(memory.roomId)) return null;
	return {
		conversation: memory.roomId,
		record: "note",
		id: memory.id,
		revision: revisionOf(memory),
		text: memory.content,
		author: { role: memory.source === "auto" ? "model" : "user" },
		at_ms: millis(memory.createdAt),
		labels: [
			memory.source === "auto" ? "origin:auto" : "origin:user",
			...(memory.pinned ? ["pinned"] : []),
		],
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
		record: "message" | "note",
		records: R[],
		toItem: (r: R) => BridgeItem | null,
	): Promise<ReconcileKindReport> => {
		const items = new Map<string, BridgeItem>();
		let rejected = 0;
		for (const r of records) {
			const item = toItem(r);
			if (!item || item.text.trim() === "") {
				if (!item) rejected++;
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
	const [messages, memories, scenes] = await Promise.all([
		source.listAllMessages(roomId),
		source.listMemories(roomId),
		source.listScenes ? source.listScenes(roomId) : Promise.resolve([]),
	]);
	const audiences = resolveMessageAudiences(messages, scenes);
	const messageReport = await run("message", messages, (m) =>
		messageItem(m, audiences.get(m.id)),
	);
	const noteReport = await run("note", memories, noteItem);
	return {
		messages: messageReport,
		notes: noteReport,
		complete,
		dryRun,
	};
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

/**
 * `sweepConversations` against the store's own room list: the call the apps make once the store and
 * the index are both open. The room list is read here, in the package, so no screen-side code reads
 * it outside the room-list hook.
 */
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
 * Characters the recalled block may take. It is not taken from the memory budget: memory is the
 * user's record and keeps its 4,000 characters. 1,600 is about four short passages, roughly the size
 * of one long message, so a turn never grows by more than one message's worth.
 */
export const CHAT_RECALL_CONTEXT_CHAR_BUDGET = 1_600;
/** Passages at most, whatever their length. */
export const CHAT_RECALL_MAX_PASSAGES = 6;
/** A recall slower than this is abandoned and the turn goes out without it. */
export const CHAT_RECALL_TIMEOUT_MS = 400;

export type ChatRecallLayer = "story" | "ooc" | "notes" | "character";

export interface ChatRecalledPassage {
	/** Record id (message or memory); not shown to the model. */
	id: string;
	layer: ChatRecallLayer;
	text: string;
	/** Who said it, for messages; null for notes. */
	speaker: string | null;
	role: "user" | "character" | "model" | "narrator" | "system";
	/** ISO time the record was written. */
	at: string | null;
	/** Who witnessed it (messages; notes are `room`). Unknown only in rooms without scenes. */
	audience?: ResolvedAudience["kind"];
	/**
	 * A later record of this conversation says something about the same terms (a later message, a
	 * user memory written after it): this passage may be out of date. Not a verdict — the model reads
	 * it as "earlier" and the later record wins (`recallBlock`).
	 */
	superseded?: boolean;
}

/** A turn's recalled passages, frozen when the generation starts (like memories and summary). */
export interface ChatRecallSnapshot {
	passages: readonly ChatRecalledPassage[];
}

interface BridgeEvidence {
	layer: ChatRecallLayer;
	record: "message" | "note" | "summary";
	id: string;
	passage: number;
	text: string;
	author: { role: ChatRecalledPassage["role"]; name?: string | null };
	at_ms?: number;
	score: number;
	audience?: ResolvedAudience["kind"];
	matched?: string[];
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

const HANGUL = /[\uac00-\ud7a3]/;

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

/** User turns shorter than this many words get the end of the reply they answer added. */
export const CHAT_RECALL_SHORT_TURN_WORDS = 4;

/**
 * The query for this turn: the user's latest words. A short turn ("응, 어디 뒀더라", "what about
 * him?") points at the reply it answers, so for those the end of that reply is added. Bounded so a
 * pasted wall of text does not become a slow query.
 *
 * Not the reply tail on every turn: in the Phase 11 A/B (afterstate `docs/benchmarks/phase11`) the
 * tail's words matched the recent scene everywhere and outranked the passage the question was about
 * (gold in context 0.12 with it, 0.76 without, held-out probes).
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
		Partial<Pick<ChatMemory, "createdAt" | "source">>)[];
	/** Ids of memories the memory block will carry. */
	memoryIdsInContext: ReadonlySet<string>;
	/** The room's scenes (none: every message is unknown audience, read as shared history). */
	scenes?: readonly ChatScene[];
	/** Alias groups (`recallAliases`). */
	aliases?: readonly (readonly string[])[];
	/**
	 * Marking (and, for questions about the present, dropping) passages a later record overtook
	 * (`markSuperseded`). On by default; `false` reproduces the Phase 11 behaviour for comparisons.
	 */
	supersession?: boolean;
	/** Phase 11 behaviour for comparisons: send no perspective (no audience filtering at all). */
	unscoped?: boolean;
	/**
	 * Messages that follow each of the best story hits, carried with it (`CHAT_RECALL_CONTINUATION`);
	 * 0 turns it off (Phase 11 behaviour).
	 */
	continuation?: number;
}

/**
 * How many following messages the best story hits bring along. A question names the scene ("the
 * council at the Gilded Anchor") but the answer is said in the next lines, which share none of its
 * words (Phase 12 failure analysis of multi-scene probes: the scene-setting line was found, the
 * decisions after it never were). Only the two best hits do, only messages of the same scene
 * (same audience) and only outside the history window.
 */
export const CHAT_RECALL_CONTINUATION = 2;
const CONTINUATION_ANCHORS = 2;

/**
 * One turn's recall against the index, validated against the store snapshot. Throws on transport
 * failure (callers wrap it, see `createRecallLoader`).
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
	const notes = new Map(input.memories.map((m) => [m.id, m]));
	const scenes = input.scenes ?? [];
	const perspective = recallPerspective(scenes);
	const audiences = resolveMessageAudiences(input.messages, scenes);
	const response = await port.call<{ evidence: BridgeEvidence[] }>("recall", {
		conversation: input.roomId,
		query: input.query.slice(0, 4_000),
		visible: { story: true, ooc: true, notes: true },
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
			 * may not be reconciled yet. Story passages only; the OOC layer is the user's literal words.
			 */
			const audience = audiences.get(e.id) ?? { kind: "unknown" as const };
			if (
				!input.unscoped &&
				e.layer !== "ooc" &&
				!perspectiveAdmits(perspective, audience)
			)
				continue;
			passages.push({
				id: e.id,
				layer: e.layer,
				text: e.text,
				speaker: e.author.name ?? null,
				role: e.author.role,
				at: message.createdAt,
				audience: audience.kind,
			});
			termsOf.push(e.matched ?? []);
		} else if (e.record === "note") {
			/*
			 * In a room with scenes, a model-written memory (V2 maintenance) has no audience: it may
			 * restate a private scene. The memory block may still carry it (V2's own choice, unchanged);
			 * recall does not add one the block left out.
			 */
			if (
				!input.unscoped &&
				scenes.length > 0 &&
				notes.get(e.id)?.source === "auto"
			)
				continue;
			const note = notes.get(e.id);
			if (
				!note ||
				input.memoryIdsInContext.has(e.id) ||
				normalize(note.content) !== normalize(e.text)
			)
				continue;
			passages.push({
				id: e.id,
				layer: "notes",
				text: e.text,
				speaker: null,
				role: e.author.role,
				at: note.createdAt ?? null,
				audience: "room",
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
		if (anchors >= CONTINUATION_ANCHORS || p.layer !== "story") return;
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
			if (!input.unscoped && !perspectiveAdmits(perspective, a)) break;
			const text = m.content.trim().slice(0, 480);
			if (!text) continue;
			present.add(m.id);
			out.push({
				id: m.id,
				layer: "story",
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
 * recalled one, or one in the history window) or a user memory written after it contains every
 * content term the passage matched (at least two). Deterministic and cheap; it does not decide what
 * is true. It never marks a user-authored memory (the user's record is authoritative).
 *
 * A term that is (part of) a character's name is also covered by any other name of that character
 * (`aliases`), so "이안 has the map" is overtaken by a later "새벽 has the map" after a rename. A name
 * two groups share expands nothing, as in the bridge.
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
					o.passage.layer !== "notes" &&
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

// ── Runtime wiring (shared by web, desktop and mobile) ────────────────────────────────────────────

/** Counters only: no text, no ids. Shadow and diagnostics read these. */
export interface MemoryBackendEvent {
	kind:
		| "recall"
		| "recall-failed"
		| "recall-timeout"
		| "index"
		| "index-failed";
	mode: MemoryBackendMode;
	ms: number;
	passages?: number;
	chars?: number;
	dropped?: number;
	ingested?: number;
	erased?: number;
}

export interface ConversationMemoryRuntime {
	mode: MemoryBackendMode;
	port: AfterstatePort | null;
	/** Observability hook; must not throw and must not keep content. */
	observe?: (event: MemoryBackendEvent) => void;
	/** Clock for measurements (tests inject one). */
	now?: () => number;
}

export interface RecallRequest {
	query: string;
	windowLength: number;
	memories: readonly ChatMemory[];
	memoryIdsInContext: ReadonlySet<string>;
}

/** The scenes and alias groups a recall needs, read from the source when it can provide them. */
async function recallScope(
	source: ConversationMemorySource,
	roomId: string,
): Promise<{ scenes: ChatScene[]; aliases: string[][] }> {
	const [scenes, characters] = await Promise.all([
		source.listScenes ? source.listScenes(roomId) : Promise.resolve([]),
		source.listCharacters ? source.listCharacters(roomId) : Promise.resolve([]),
	]);
	return { scenes, aliases: recallAliases(characters) };
}

/**
 * The recall request for a turn, from the snapshots the generation already took: the history
 * window it will send (its length, and its last turns as the query) and the memories (which of them
 * the memory block will carry, by the same selection function, so a note is never quoted twice).
 * Web and mobile call this one function, so they ask the same question.
 */
export function recallRequestFor(
	history: readonly Pick<ChatMessage, "role" | "content">[],
	memories: readonly ChatMemory[],
	userInput?: string,
): RecallRequest {
	return {
		query: recallQuery(history, userInput),
		windowLength: history.length,
		memories,
		memoryIdsInContext: new Set(
			selectMemoriesForContext(memories).map((m) => m.id),
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

/**
 * The conversation's `loadRecall`, or undefined in legacy mode (the session then simply has none,
 * and assembly is byte-identical to V2). Never throws. In shadow mode it measures and returns null.
 */
export function createRecallLoader(
	runtime: ConversationMemoryRuntime,
	source: ConversationMemorySource,
	roomId: string,
):
	| ((request: RecallRequest) => Promise<ChatRecallSnapshot | null>)
	| undefined {
	const mode = effectiveMemoryBackend(runtime.mode, runtime.port);
	const port = runtime.port;
	if (mode === "legacy" || !port) return undefined;
	const now = runtime.now ?? (() => Date.now());
	const observe = (event: MemoryBackendEvent) => {
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
			const result = await withTimeout(
				recallForTurn(port, {
					roomId,
					query: request.query,
					messages,
					windowLength: request.windowLength,
					memories: request.memories,
					memoryIdsInContext: request.memoryIdsInContext,
					scenes: scope.scenes,
					aliases: scope.aliases,
				}),
				CHAT_RECALL_TIMEOUT_MS,
			);
			if (result === "timeout") {
				observe({ kind: "recall-timeout", mode, ms: now() - started });
				return null;
			}
			observe({
				kind: "recall",
				mode,
				ms: now() - started,
				passages: result.passages.length,
				chars: result.passages.reduce((n, p) => n + p.text.length, 0),
			});
			return mode === "afterstate" ? result : null;
		} catch {
			observe({ kind: "recall-failed", mode, ms: now() - started });
			return null;
		}
	};
}

const inflight = new WeakMap<AfterstatePort, Map<string, Promise<void>>>();

/**
 * The conversation's background indexer: `void`, never throws, one run per room at a time (a call
 * while one runs is folded into it — the running one reads the store at its start, so a second run
 * is queued once). Woken where V2 maintenance is woken (after the assistant reply is saved), and
 * when a room opens.
 */
export function createIndexer(
	runtime: ConversationMemoryRuntime,
	source: ConversationMemorySource,
	roomId: string,
): (() => void) | undefined {
	const mode = effectiveMemoryBackend(runtime.mode, runtime.port);
	const port = runtime.port;
	if (mode === "legacy" || !port) return undefined;
	const now = runtime.now ?? (() => Date.now());
	let rooms = inflight.get(port);
	if (!rooms) {
		rooms = new Map();
		inflight.set(port, rooms);
	}
	const table = rooms;
	let queued = false;
	const runOnce = async (): Promise<void> => {
		const started = now();
		try {
			const report = await reconcileConversation(port, source, roomId);
			runtime.observe?.({
				kind: "index",
				mode,
				ms: now() - started,
				ingested: report.messages.ingested + report.notes.ingested,
				erased: report.messages.erasedPassages + report.notes.erasedPassages,
			});
		} catch {
			try {
				runtime.observe?.({ kind: "index-failed", mode, ms: now() - started });
			} catch {
				// ignore
			}
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
 * What a local room's session gets from the memory backend, composed once for both apps: the
 * recall loader (absent in legacy mode) and `maintain`, which still wakes V2 maintenance (the
 * summary and extracted memories stay V2's: synced, authoritative records; the index does no model
 * calls) and, beside it, the indexer (which reads those records like any others).
 */
export function conversationMemoryHooks(
	runtime: ConversationMemoryRuntime | null | undefined,
	source: ConversationMemorySource,
	roomId: string,
	maintain?: () => void,
): {
	loadRecall?: (request: RecallRequest) => Promise<ChatRecallSnapshot | null>;
	maintain?: () => void;
} {
	const loadRecall = runtime
		? createRecallLoader(runtime, source, roomId)
		: undefined;
	const index = runtime ? createIndexer(runtime, source, roomId) : undefined;
	const both =
		maintain && index
			? () => {
					maintain();
					index();
				}
			: (maintain ?? index);
	return {
		...(loadRecall ? { loadRecall } : {}),
		...(both ? { maintain: both } : {}),
	};
}
