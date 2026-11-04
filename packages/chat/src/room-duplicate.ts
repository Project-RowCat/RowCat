import type { Rev } from "@rowcat/contracts/sync";
import type { ChatCharacter } from "./character.ts";
import type { ChatMemory } from "./memory.ts";
import {
	CHAT_ROOM_TITLE_MAX_LENGTH,
	type ChatMessage,
	type ChatRoom,
	freshChatSyncMeta,
	isLiveChatRecord,
	normalizeRoomTitle,
} from "./model.ts";
import { type ChatSummary, summaryIdFor } from "./summary.ts";

/**
 * Duplicating a conversation: one room and its four children copied under new identities.
 *
 * The rule lives in the pure package because both stores (Dexie on web, SQLite on mobile) write the
 * same copy. Written per store, one of them eventually forgets a child, and that copy is a
 * conversation that answers differently from its original with nothing on screen to say why: the
 * model has lost the memories, the added cast or the summary the original still carries.
 *
 * What a copy is:
 *
 * - **Every child, live ones only.** Messages, memories, added characters and the summary. A
 *   tombstoned record is history the user removed; copying it would bring it back in a room that
 *   never deleted it.
 * - **New identities, never shared.** Every record gets a fresh id, and the summary takes
 *   `summaryIdFor(newRoomId)`. Sharing any id would make the two rooms fight over one row in the
 *   server's `(owner, id)` key.
 * - **A new routing key.** It is a per-room value (`routingSessionId`); a copy that kept the
 *   original's would tell upstream the two conversations are one.
 * - **The room's own settings travel** (persona override, narration, intensity, user note), as do
 *   the immutable acquisition fields (seed, origin story, rating, prompt protection). The copy is the
 *   same conversation from the same work, so those values are true of it too.
 * - **Message and memory times are kept verbatim.** Ordering is `[roomId+createdAt+id]`, the summary
 *   frontier is a coordinate on that axis, and an auto memory's `originAt` points into it. Restamping
 *   them would leave the frontier pointing between messages and the next rewind deleting the wrong
 *   memories. The room alone is stamped now, so the copy sorts to the top of the list as the thing
 *   just made.
 * - **Every copied record is a new local record** (dirty, never uploaded, its own revision). A copy
 *   syncs as its own conversation; that is the cost of having one.
 *
 * Not copied: device generation preferences (model, length, reasoning). They are not synced and not
 * in this store; the app's composition layer carries them, as it clears them on deletion.
 */

export interface ChatRoomDuplicateSource {
	room: ChatRoom;
	/** The room's messages. Order does not matter; tombstones are skipped here. */
	messages: readonly ChatMessage[];
	memories: readonly ChatMemory[];
	characters: readonly ChatCharacter[];
	summary: ChatSummary | null;
}

export interface ChatRoomDuplicateStamp {
	/** The copy's title, already through `requireRoomTitle`. */
	title: string;
	/** ISO 8601; the copy's room creation and activity time. */
	now: string;
	/**
	 * Issues a fresh random id. Called once for the room, once for its routing key and once per copied
	 * child — storage owns the issuer, as it does for every other record.
	 */
	newId: () => string;
	/**
	 * One revision per record written, in write order (`chatRoomDuplicateRecordCount`). Issued at
	 * once by storage so one operation reads the clock once.
	 */
	revs: readonly Rev[];
}

export interface ChatRoomDuplicate {
	room: ChatRoom;
	messages: ChatMessage[];
	memories: ChatMemory[];
	characters: ChatCharacter[];
	summary: ChatSummary | null;
}

/**
 * The summary only travels when its frontier still points at a copied message. A frontier whose
 * message is gone cannot be remapped, and a guessed frontier would claim a range as summarized that
 * the copy's maintenance then never revisits. Dropping it costs one recomputation.
 */
const copyableSummary = (
	summary: ChatSummary | null,
	liveMessageIds: ReadonlySet<string>,
): ChatSummary | null => {
	if (!summary || !isLiveChatRecord(summary)) return null;
	if (summary.frontier && !liveMessageIds.has(summary.frontier.messageId))
		return null;
	return summary;
};

/** How many revisions `planRoomDuplicate` consumes for this source: the room plus each live child. */
export function chatRoomDuplicateRecordCount(
	source: ChatRoomDuplicateSource,
): number {
	const messages = source.messages.filter(isLiveChatRecord);
	return (
		1 +
		messages.length +
		source.memories.filter(isLiveChatRecord).length +
		source.characters.filter(isLiveChatRecord).length +
		(copyableSummary(
			source.summary,
			new Set(messages.map((message) => message.id)),
		)
			? 1
			: 0)
	);
}

/**
 * Builds the copy (does not save it). Storage reads the source and writes the result in one
 * transaction: split, a room could exist with half its messages, and the next sync would upload
 * that half as the whole conversation.
 *
 * Throws when the revisions run short rather than reusing one — two records sharing a revision lose
 * their order in every later merge.
 */
export function planRoomDuplicate(
	source: ChatRoomDuplicateSource,
	stamp: ChatRoomDuplicateStamp,
): ChatRoomDuplicate {
	let issued = 0;
	const rev = (): Rev => {
		const next = stamp.revs[issued++];
		if (next === undefined)
			throw new Error("room duplicate ran out of revisions");
		return next;
	};

	const roomId = stamp.newId();
	const room: ChatRoom = {
		...source.room,
		id: roomId,
		title: stamp.title,
		routingSessionId: stamp.newId(),
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(rev()),
	};

	const messageIds = new Map<string, string>();
	const messages = source.messages.filter(isLiveChatRecord).map((message) => {
		const id = stamp.newId();
		messageIds.set(message.id, id);
		return { ...message, id, roomId, ...freshChatSyncMeta(rev()) };
	});

	const memories = source.memories.filter(isLiveChatRecord).map((memory) => ({
		...memory,
		id: stamp.newId(),
		roomId,
		...freshChatSyncMeta(rev()),
	}));

	const characters = source.characters
		.filter(isLiveChatRecord)
		.map((character) => ({
			...character,
			id: stamp.newId(),
			roomId,
			...freshChatSyncMeta(rev()),
		}));

	const kept = copyableSummary(source.summary, new Set(messageIds.keys()));
	const summary: ChatSummary | null = kept
		? {
				...kept,
				id: summaryIdFor(roomId),
				roomId,
				frontier: kept.frontier
					? {
							createdAt: kept.frontier.createdAt,
							// Present: `copyableSummary` kept only frontiers on a copied message.
							messageId:
								messageIds.get(kept.frontier.messageId) ??
								kept.frontier.messageId,
						}
					: null,
				...freshChatSyncMeta(rev()),
			}
		: null;

	return { room, messages, memories, characters, summary };
}

/**
 * The copy's title: the original's with the app's suffix (`(사본)`, `(copy)`), cut so the whole fits
 * the title rule. The suffix comes from the app because this package holds no copy; the cut belongs
 * here because it is the title rule's length, counted in code points like `checkRoomTitle`.
 *
 * The original's part is what shrinks. Cutting the suffix instead would give a long-titled copy the
 * original's exact name, and the list would show two rows the user cannot tell apart.
 */
export function duplicateRoomTitle(title: string, suffix: string): string {
	const tail = normalizeRoomTitle(suffix);
	const base = normalizeRoomTitle(title);
	if (!tail) return base;
	if (!base) return tail;
	const room = CHAT_ROOM_TITLE_MAX_LENGTH - [...tail].length - 1;
	const head = [...base].slice(0, Math.max(0, room)).join("").trimEnd();
	return head ? `${head} ${tail}` : tail;
}
