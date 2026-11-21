import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";

/**
 * Scenes: who witnessed which part of the conversation (`docs/chat/SCENES.md`).
 *
 * A scene starts at one message and lasts until the next scene starts. Its audience says which
 * characters were there. The memory index uses it so a character is never reminded of a scene it
 * did not witness (afterstate recall filters by it inside the search), and the knowledge boundary
 * (`prompt-scope.ts`) leaves out of the whole request what the present characters did not all witness.
 *
 * - **Explicit only.** Audience is what the user said, never inferred from text: a character named
 *   in a passage did not necessarily witness it.
 * - **Child records**, like characters (`docs/chat/CHARACTERS.md` §3): each scene has its own id and
 *   revision, so two devices that mark two scenes do not overwrite each other, and an old client that
 *   does not know this kind skips it without rewriting it (a field on the message would be dropped by
 *   an old client's next edit of that message, silently widening a private scene).
 * - **Unknown stays unknown.** Messages before a room's first scene have no audience. A room with no
 *   scene at all keeps memory V2's semantics (everything is shared history, which is also what V2's
 *   summary assumes); once a room has a scene, unknown history is not recalled (`recallPerspective`).
 * - **Conflicts narrow.** Two concurrent versions of one scene settle on the more restrictive one
 *   (`mergeSceneAudience`), so a stale or concurrent widening cannot undo a narrowing.
 */

/**
 * A participant of a scene. Display names are not identities (two characters can share a name, and
 * a rename would move the reference), so members are references:
 *
 * - `user`        the user's role in this conversation (the persona)
 * - `seed:<n>`    the n-th character the work supplied (`seed.characters`; the seed is immutable,
 *                 so the index is stable for the room's life)
 * - `char:<id>`   a character added to this room (`ChatCharacter.id`)
 */
export type ChatSceneMember = string;

export const CHAT_SCENE_USER: ChatSceneMember = "user";

/** At most this many members per scene (the index stores one tag per witness). */
export const CHAT_SCENE_MAX_MEMBERS = 16;

export type ChatSceneAudience =
	/** Everyone in the story: shared history. */
	| { kind: "room" }
	/** Only these were present. */
	| { kind: "participants"; members: ChatSceneMember[] }
	/** No character saw it (narration of a hidden event). */
	| { kind: "narrator" };

/** Where a scene starts: the first message it covers (a stored message position: time, then id). */
export interface ChatSceneStart {
	createdAt: string;
	messageId: string;
}

export interface ChatScene extends ChatSyncMeta, ChatSoftDelete {
	id: string;
	roomId: string;
	startAt: ChatSceneStart;
	audience: ChatSceneAudience;
	createdAt: string;
	updatedAt: string;
}

const MEMBER = /^(user|seed:[0-9]{1,3}|char:[A-Za-z0-9_.:@-]{1,120})$/;

export const isChatSceneMember = (value: string): boolean => MEMBER.test(value);

export type ChatSceneIssue = "empty" | "too_many" | "invalid_member";

export class ChatSceneAudienceError extends Error {
	readonly reason: ChatSceneIssue;
	constructor(reason: ChatSceneIssue) {
		super(`scene audience: ${reason}`);
		this.name = "ChatSceneAudienceError";
		this.reason = reason;
	}
}

/**
 * The one representation of an audience: members sorted and unique. Storage calls this before
 * writing, the codec after reading, so two devices never hold two spellings of one audience (a
 * difference in order would read as a conflict).
 */
export function normalizeSceneAudience(
	audience: ChatSceneAudience,
):
	| { ok: true; audience: ChatSceneAudience }
	| { ok: false; reason: ChatSceneIssue } {
	if (audience.kind !== "participants")
		return { ok: true, audience: { kind: audience.kind } };
	const members = [...new Set(audience.members.map((m) => m.trim()))].sort();
	if (members.length === 0) return { ok: false, reason: "empty" };
	if (members.length > CHAT_SCENE_MAX_MEMBERS)
		return { ok: false, reason: "too_many" };
	if (!members.every(isChatSceneMember))
		return { ok: false, reason: "invalid_member" };
	return { ok: true, audience: { kind: "participants", members } };
}

export function requireSceneAudience(
	audience: ChatSceneAudience,
): ChatSceneAudience {
	const checked = normalizeSceneAudience(audience);
	if (!checked.ok) throw new ChatSceneAudienceError(checked.reason);
	return checked.audience;
}

export interface SetSceneInput {
	roomId: string;
	startAt: ChatSceneStart;
	audience: ChatSceneAudience;
}

export function createSceneRecord(
	input: SetSceneInput,
	stamp: ChatStamp,
): ChatScene {
	return {
		id: stamp.id,
		roomId: input.roomId,
		startAt: {
			createdAt: input.startAt.createdAt,
			messageId: input.startAt.messageId,
		},
		audience: requireSceneAudience(input.audience),
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

// ── Order and restriction ──────────────────────────────────────────────────────────────────────────

const comparePosition = (a: ChatSceneStart, b: ChatSceneStart): number =>
	a.createdAt !== b.createdAt
		? a.createdAt < b.createdAt
			? -1
			: 1
		: a.messageId < b.messageId
			? -1
			: a.messageId > b.messageId
				? 1
				: 0;

const RANK = { narrator: 0, participants: 1, room: 2 } as const;

/**
 * Whether `a` admits strictly fewer perspectives than `b`: narrator < participants < room, and
 * among participants a strict subset of witnesses. Undefined for incomparable member sets.
 */
export function narrowerAudience(
	a: ChatSceneAudience,
	b: ChatSceneAudience,
): boolean {
	if (a.kind !== b.kind) return RANK[a.kind] < RANK[b.kind];
	if (a.kind !== "participants" || b.kind !== "participants") return false;
	const wider = new Set(b.members);
	return (
		a.members.length < b.members.length && a.members.every((m) => wider.has(m))
	);
}

export const sameAudience = (
	a: ChatSceneAudience,
	b: ChatSceneAudience,
): boolean => audienceKey(a) === audienceKey(b);

/** A canonical string of an audience (for revisions and comparisons; carries refs, not names). */
export const audienceKey = (a: ChatSceneAudience): string =>
	a.kind === "participants" ? `p:${[...a.members].sort().join(",")}` : a.kind;

/**
 * The audience two versions settle on when neither is simply newer (same position, or a concurrent
 * edit): the narrower; for incomparable member sets, the witnesses both name (narrator if none).
 * Deterministic and symmetric, so every device reaches the same value.
 */
export function mergeSceneAudience(
	a: ChatSceneAudience,
	b: ChatSceneAudience,
): ChatSceneAudience {
	if (sameAudience(a, b)) return a;
	if (narrowerAudience(a, b)) return a;
	if (narrowerAudience(b, a)) return b;
	if (a.kind === "participants" && b.kind === "participants") {
		const other = new Set(b.members);
		const both = a.members.filter((m) => other.has(m)).sort();
		return both.length > 0
			? { kind: "participants", members: both }
			: { kind: "narrator" };
	}
	return RANK[a.kind] <= RANK[b.kind] ? a : b;
}

/** Live scenes in position order; scenes sharing a start are merged to their narrower audience. */
export function orderScenes(
	scenes: readonly ChatScene[],
): { startAt: ChatSceneStart; audience: ChatSceneAudience }[] {
	const live = scenes
		.filter((s) => s.deletedAt === null)
		.sort(
			(a, b) =>
				comparePosition(a.startAt, b.startAt) ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
		);
	const out: { startAt: ChatSceneStart; audience: ChatSceneAudience }[] = [];
	for (const s of live) {
		const last = out[out.length - 1];
		if (last && comparePosition(last.startAt, s.startAt) === 0) {
			last.audience = mergeSceneAudience(last.audience, s.audience);
		} else {
			out.push({ startAt: s.startAt, audience: s.audience });
		}
	}
	return out;
}

// ── Resolution ─────────────────────────────────────────────────────────────────────────────────────

/** A message's audience as the memory index and the assembler use it. */
export type ResolvedAudience = ChatSceneAudience | { kind: "unknown" };

/**
 * Each message's audience: the scene whose start is the latest at or before the message. Messages
 * before the first scene (and every message of a room with no scene) are `unknown`.
 */
export function resolveMessageAudiences(
	messages: readonly { id: string; createdAt: string }[],
	scenes: readonly ChatScene[],
): Map<string, ResolvedAudience> {
	const ordered = orderScenes(scenes);
	const sorted = [...messages].sort((a, b) =>
		comparePosition(
			{ createdAt: a.createdAt, messageId: a.id },
			{ createdAt: b.createdAt, messageId: b.id },
		),
	);
	const out = new Map<string, ResolvedAudience>();
	let next = 0;
	let current: ResolvedAudience = { kind: "unknown" };
	for (const m of sorted) {
		const at = { createdAt: m.createdAt, messageId: m.id };
		for (
			let s = ordered[next];
			s && comparePosition(s.startAt, at) <= 0;
			s = ordered[++next]
		) {
			current = s.audience;
		}
		out.set(m.id, current);
	}
	return out;
}

/** Whose knowledge a turn may draw on: the scene in effect at the end of the conversation. */
export type ChatPerspective =
	| { kind: "room"; unknown: "include" | "exclude" }
	| {
			kind: "participants";
			members: readonly ChatSceneMember[];
			unknown: "include" | "exclude";
	  }
	| { kind: "narrator"; unknown: "include" | "exclude" };

/**
 * The perspective for the next turn. A room without scenes is `room` with unknown history included
 * (memory V2's semantics, stated rather than assumed); a room with scenes excludes unknown history.
 */
export function recallPerspective(
	scenes: readonly ChatScene[],
): ChatPerspective {
	const ordered = orderScenes(scenes);
	const last = ordered[ordered.length - 1];
	if (!last) return { kind: "room", unknown: "include" };
	const a = last.audience;
	return a.kind === "participants"
		? { kind: "participants", members: [...a.members], unknown: "exclude" }
		: { kind: a.kind, unknown: "exclude" };
}

/**
 * The same admission rule the index applies (afterstate `admits`), restated so the adapter can check
 * every recalled passage again before it reaches the prompt: shared history always; participants
 * only when **every** present member witnessed it; narrator-only to a narrator perspective; unknown
 * only when the perspective includes it.
 */
export function perspectiveAdmits(
	perspective: ChatPerspective,
	audience: ResolvedAudience,
): boolean {
	switch (audience.kind) {
		case "room":
			return true;
		case "unknown":
			return perspective.unknown === "include";
		case "narrator":
			return perspective.kind === "narrator";
		case "participants": {
			if (
				perspective.kind !== "participants" ||
				perspective.members.length === 0
			)
				return false;
			const witnesses = new Set(audience.members);
			return perspective.members.every((m) => witnesses.has(m));
		}
	}
}

// ── Names ──────────────────────────────────────────────────────────────────────────────────────────

/** Display names for member refs, for the prompt and the screen. Unknown refs read as absent. */
export function sceneMemberNames(
	members: readonly ChatSceneMember[],
	cast: {
		seed: { characters?: readonly { name?: string }[] };
		characters: readonly { id: string; name: string }[];
		userName: string;
	},
): string[] {
	const byChar = new Map(cast.characters.map((c) => [`char:${c.id}`, c.name]));
	const out: string[] = [];
	for (const m of members) {
		if (m === CHAT_SCENE_USER) out.push(cast.userName);
		else if (m.startsWith("seed:")) {
			const name = cast.seed.characters?.[Number(m.slice(5))]?.name?.trim();
			if (name) out.push(name);
		} else {
			const name = byChar.get(m);
			if (name) out.push(name);
		}
	}
	return out;
}
