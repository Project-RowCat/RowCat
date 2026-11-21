import type { ChatCharacter } from "./character.ts";
import type { ChatMessage, ChatRoom } from "./model.ts";
import { effectiveChatUserName } from "./persona.ts";
import {
	CHAT_SCENE_USER,
	type ChatScene,
	type ChatSceneAudience,
	type ChatSceneMember,
	type ChatSceneStart,
	orderScenes,
	requireSceneAudience,
	type SetSceneInput,
	sameAudience,
	sceneMemberNames,
} from "./scene.ts";
import { compareMessagePosition } from "./summary.ts";

/**
 * What the scene controls in the chat room do, as pure plans both apps execute through the store's
 * existing `setScene` / `deleteScene` (`docs/chat/SCENES.md` §7). Scenes stay RowCat records,
 * E2EE-synced; afterstate only receives each message's resolved audience when it indexes.
 *
 * - **Start a scene** with chosen participants: it covers the next message onward (messages inherit
 *   the scene in effect — nobody assigns messages one by one).
 * - **Change participants** of the scene in effect: the change applies from the next message, so
 *   what was already said keeps the audience it was said under. A scene with no message yet is
 *   edited in place instead of stacking an empty one.
 * - **End the scene**: everyone is present again from the next message (a `room` scene).
 * - **Correct** a past scene's membership: rewrites who witnessed what was said in it, explicitly,
 *   at its own start (the store upserts by start position; concurrent edits on two devices settle on
 *   the narrower audience).
 * - **Classify earlier history** when a room that already has messages gains its first scene
 *   (`planHistoryAdoption`).
 */

/** One person the scene picker can list: the user's role, the work's characters, added characters. */
export interface SceneCastMember {
	ref: ChatSceneMember;
	name: string;
	kind: "user" | "seed" | "char";
}

/** The cast the picker offers, in a stable order: the user's role, the work's, then added ones. */
export function sceneCast(
	room: Pick<ChatRoom, "seed" | "persona">,
	characters: readonly Pick<ChatCharacter, "id" | "name" | "deletedAt">[],
): SceneCastMember[] {
	const out: SceneCastMember[] = [
		{ ref: CHAT_SCENE_USER, name: effectiveChatUserName(room), kind: "user" },
	];
	(room.seed.characters ?? []).forEach((c, i) => {
		const name = c.name?.trim();
		if (name && i < 1000) out.push({ ref: `seed:${i}`, name, kind: "seed" });
	});
	for (const c of characters)
		if (c.deletedAt === null && c.name.trim())
			out.push({ ref: `char:${c.id}`, name: c.name.trim(), kind: "char" });
	return out;
}

/** The scene in effect for the next message, as the room's header shows it. */
export interface ActiveSceneView {
	/** The live scene record (the newest one at that start). */
	scene: ChatScene;
	audience: ChatSceneAudience;
	/** Display names of the participants (empty for `room` and `narrator`). */
	names: string[];
	/** No message has been said in it yet. */
	empty: boolean;
}

const startOf = (s: ChatSceneStart) => ({
	createdAt: s.createdAt,
	id: s.messageId,
});

/** The scene in effect and whether anything was said in it yet (no names). */
function sceneInEffect(
	scenes: readonly ChatScene[],
	lastMessage: Pick<ChatMessage, "id" | "createdAt"> | null,
): { scene: ChatScene; audience: ChatSceneAudience; empty: boolean } | null {
	const ordered = orderScenes(scenes);
	const last = ordered[ordered.length - 1];
	if (!last) return null;
	const record = scenes
		.filter(
			(s) =>
				s.deletedAt === null &&
				s.startAt.createdAt === last.startAt.createdAt &&
				s.startAt.messageId === last.startAt.messageId,
		)
		.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
	if (!record) return null;
	return {
		scene: record,
		audience: last.audience,
		empty:
			lastMessage === null ||
			compareMessagePosition(startOf(last.startAt), {
				createdAt: lastMessage.createdAt,
				id: lastMessage.id,
			}) > 0,
	};
}

export function activeScene(
	scenes: readonly ChatScene[],
	cast: Pick<ChatRoom, "seed" | "persona"> & {
		characters: readonly Pick<ChatCharacter, "id" | "name" | "deletedAt">[];
	},
	lastMessage: Pick<ChatMessage, "id" | "createdAt"> | null,
): ActiveSceneView | null {
	const current = sceneInEffect(scenes, lastMessage);
	if (!current) return null;
	const { audience } = current;
	return {
		...current,
		names:
			audience.kind === "participants"
				? sceneMemberNames(audience.members, {
						seed: cast.seed,
						characters: cast.characters.filter((c) => c.deletedAt === null),
						userName: effectiveChatUserName(cast),
					})
				: [],
	};
}

/**
 * The start position for "from the next message": after the last message. The id `~` sorts after
 * every message id at the same instant, so the last message stays in the scene before.
 */
export function startAfter(
	lastMessage: Pick<ChatMessage, "createdAt"> | null,
	nowIso: string,
): ChatSceneStart {
	const at =
		lastMessage && lastMessage.createdAt > nowIso
			? lastMessage.createdAt
			: nowIso;
	return { createdAt: at, messageId: "~" };
}

/** What a control writes. Executed in order through `setScene` / `deleteScene`. */
export interface ScenePlan {
	set: SetSceneInput[];
	remove: string[];
}

const NOTHING: ScenePlan = { set: [], remove: [] };

/**
 * Start a scene with `audience` from the next message, or change the participants of the scene in
 * effect (same thing: the change applies from the next message). If the scene in effect has no
 * message yet, it is edited in place. Starting what is already in effect writes nothing.
 */
export function planStartScene(input: {
	roomId: string;
	scenes: readonly ChatScene[];
	lastMessage: Pick<ChatMessage, "id" | "createdAt"> | null;
	audience: ChatSceneAudience;
	nowIso: string;
}): ScenePlan {
	const audience = requireSceneAudience(input.audience);
	const active = sceneInEffect(input.scenes, input.lastMessage);
	if (active && sameAudience(active.audience, audience)) return NOTHING;
	if (active?.empty)
		return {
			set: [
				{
					roomId: input.roomId,
					startAt: active.scene.startAt,
					audience,
				},
			],
			remove: [],
		};
	return {
		set: [
			{
				roomId: input.roomId,
				startAt: startAfter(input.lastMessage, input.nowIso),
				audience,
			},
		],
		remove: [],
	};
}

/** End the scene in effect: everyone is present again from the next message. */
export function planEndScene(input: {
	roomId: string;
	scenes: readonly ChatScene[];
	lastMessage: Pick<ChatMessage, "id" | "createdAt"> | null;
	nowIso: string;
}): ScenePlan {
	if (orderScenes(input.scenes).length === 0) return NOTHING;
	return planStartScene({ ...input, audience: { kind: "room" } });
}

/** Correct who witnessed an existing scene (applies to everything said in it). */
export function planCorrectScene(
	scene: ChatScene,
	audience: ChatSceneAudience,
): ScenePlan {
	const next = requireSceneAudience(audience);
	if (sameAudience(scene.audience, next)) return NOTHING;
	return {
		set: [{ roomId: scene.roomId, startAt: scene.startAt, audience: next }],
		remove: [],
	};
}

// ── Earlier history ───────────────────────────────────────────────────────────────────────────────

/**
 * How the person classifies a room's history from before its first scene:
 *
 * - `shared`  — everyone knew it: a `room` scene at the first message. Earlier history keeps
 *               reaching every character, as it did before scenes.
 * - `private` — no character may draw on it: a `narrator` scene at the first message. The messages
 *               stay on screen and in the index; no character's turn recalls them.
 * - `review`  — decide later: nothing is written, the history stays `unknown`, and unknown history is
 *               withheld from every character in a room with scenes (fail closed). The scene panel
 *               keeps showing how many messages are unclassified.
 *
 * Nobody is invented as a witness: there is no "these characters were there" for history, because
 * no record says who was present then. The person can still correct it afterwards with explicit
 * scenes at specific messages.
 */
export const HISTORY_ADOPTION_CHOICES = [
	"shared",
	"private",
	"review",
] as const;
export type HistoryAdoptionChoice = (typeof HISTORY_ADOPTION_CHOICES)[number];

/** The default when the person dismisses the question: the conservative one. */
export const HISTORY_ADOPTION_DEFAULT: HistoryAdoptionChoice = "review";

/**
 * The room's messages from before its first scene that no scene classifies yet. Zero in a room with
 * no scene (everything there is shared history) or when a scene starts at the first message.
 */
export function unclassifiedHistory(
	messages: readonly Pick<ChatMessage, "id" | "createdAt">[],
	scenes: readonly ChatScene[],
): { count: number; first: Pick<ChatMessage, "id" | "createdAt"> | null } {
	const ordered = orderScenes(scenes);
	const firstScene = ordered[0];
	if (!firstScene) return { count: 0, first: null };
	const sorted = [...messages].sort((a, b) => compareMessagePosition(a, b));
	const before = sorted.filter(
		(m) => compareMessagePosition(m, startOf(firstScene.startAt)) < 0,
	);
	return { count: before.length, first: before[0] ?? null };
}

/** Whether starting a first scene in this room should ask about earlier history. */
export function historyAdoptionNeeded(
	messages: readonly Pick<ChatMessage, "id" | "createdAt">[],
	scenes: readonly ChatScene[],
): boolean {
	return orderScenes(scenes).length === 0 && messages.length > 0;
}

/** The scene the choice writes at the first message, or nothing for `review`. */
export function planHistoryAdoption(input: {
	roomId: string;
	choice: HistoryAdoptionChoice;
	firstMessage: Pick<ChatMessage, "id" | "createdAt"> | null;
}): ScenePlan {
	if (input.choice === "review" || !input.firstMessage) return NOTHING;
	return {
		set: [
			{
				roomId: input.roomId,
				startAt: {
					createdAt: input.firstMessage.createdAt,
					messageId: input.firstMessage.id,
				},
				audience:
					input.choice === "shared" ? { kind: "room" } : { kind: "narrator" },
			},
		],
		remove: [],
	};
}
