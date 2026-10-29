import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import type { Rev } from "@rowcat/contracts/sync";
import { z } from "zod";
import {
	CHAT_CHARACTER_NAME_MAX_LENGTH,
	CHAT_CHARACTER_PROMPT_MAX_LENGTH,
	type ChatCharacter,
} from "./character.ts";
import { applyRoomIntensity } from "./intensity.ts";
import {
	CHAT_MEMORY_SOURCES,
	type ChatMemory,
	checkAutoMemoryContent,
	checkMemoryContent,
	mergeMemorySource,
	normalizeMemoryContent,
	readMemorySource,
} from "./memory.ts";
import type { ChatMessage, ChatRoom } from "./model.ts";
import { applyRoomNarration } from "./narration.ts";
import type { ChatPersona } from "./persona.ts";
import {
	applyRoomPersona,
	checkPersonaDescription,
	checkPersonaName,
	normalizePersonaDescription,
	normalizePersonaName,
} from "./persona.ts";
import { type ChatSummary, clampSummary } from "./summary.ts";
import { applyRoomUserNote } from "./user-note.ts";

/**
 * Codec for conversation records: record and payload conversion, plus the conflict rules for these
 * two types.
 * - Must not import `@rowcat/sync`. Otherwise the sync package becomes a hub that knows every
 *   domain, and adding a conversation field would force a change to the protocol package. The
 *   codecs are plain objects; `SyncCodec` conformance is checked structurally where the app
 *   registers them.
 * - zod is used because successful decryption does not mean the payload has an applicable shape.
 *   A payload from a buggy or older client on the same account would break local storage, not just
 *   a screen. AEAD guarantees integrity, not meaning.
 */

/**
 * Schema version of the conversation payload. It is separate from the storage (Dexie) version and
 * the envelope version, and it tracks the meaning of one record. Each type bumps independently.
 */
export const CHAT_SYNC_SCHEMA_VERSION = 1;

/**
 * Diagnostic codes emitted by merges, in the chat domain's vocabulary. The sync package receives
 * them only as strings.
 */
export const CHAT_MERGE_NOTE = {
	/** An immutable field differs between two devices. This state should be impossible. */
	roomImmutableDivergence: "chat_room_immutable_divergence",
	/** An incomplete copy tried to beat a complete one, and the complete-first rule blocked it. */
	messageIncompleteRejected: "chat_message_incomplete_rejected",
} as const;

/** Merges `updatedAt` with max, treating both devices' activity as a union. */
const later = (a: string, b: string): string => (a >= b ? a : b);

/**
 * Must follow the same rule as `compareRev` in `@rowcat/sync`. This package cannot import it, so a
 * test (`apps/web/src/lib/local-sync/codec-order.test.ts`) checks on a random matrix that both pick
 * the same winner. `safeInt` keeps the comparison a total order: with NaN, negatives, or fractions,
 * `NaN !== NaN` makes the result depend on argument order, and two devices could reach different
 * winners. Local stored rows skip the contract's validation, so folding is needed here too.
 */
const safeInt = (value: number): number =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

function compareRev(a: Rev, b: Rev): number {
	const at = safeInt(a.t);
	const bt = safeInt(b.t);
	if (at !== bt) return at < bt ? -1 : 1;
	const ac = safeInt(a.c);
	const bc = safeInt(b.c);
	if (ac !== bc) return ac < bc ? -1 : 1;
	if (a.d === b.d) return 0;
	return a.d < b.d ? -1 : 1;
}

/**
 * The merged revision must be at least the max of both inputs. If local wins but keeps its old
 * revision, the peer treats the result as a replay (step 5 of §19.2), ignores it, and re-uploads
 * its own version, and the two devices overwrite each other forever. The result is a new revision,
 * later than both inputs.
 */
const mergedRev = (a: Rev, b: Rev): Rev => (compareRev(b, a) > 0 ? b : a);

/**
 * Input to decode: the payload's `data` plus the transport metadata outside it. It is restated here
 * rather than imported from `@rowcat/sync`, which would make this file depend on the protocol. If
 * the two declarations drift apart, the app's assembly point fails to compile.
 */
interface DecodeInput {
	id: string;
	schemaVersion: number;
	rev: Rev;
	deletedAt: string | null;
	data: unknown;
}

interface MergeCtx {
	note(code: string): void;
}

interface Merged<T> {
	record: T;
	remoteWins: boolean;
}

/**
 * Default transport metadata for decoded records. Payloads do not carry `dirty` or `serverVersion`,
 * which belong to the receiving device, and the store overwrites them with wire values directly.
 */
const INBOUND_META = { dirty: 0, serverVersion: 0 } as const;

/**
 * Optional fields are omitted when their key is absent. Explicitly setting `undefined` would mix
 * "unspecified" with "has a value".
 */
const withOptional = <T extends Record<string, unknown>>(
	base: T,
	extra: Record<string, unknown>,
): T => {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(extra))
		if (value !== undefined) out[key] = value;
	return out as T;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * chat.room
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The room's persona copy deliberately omits the library id. Carrying it would let the receiving
 * device look up its own library by that id, breaking this feature's product decision (see
 * `persona.ts`).
 */
const RoomPersonaData = z
	.object({ name: z.string(), description: z.string() })
	.strict();

/**
 * The payload deliberately omits `id`, `dirty`, `serverVersion`, `rev`, and `deletedAt`. The first
 * three are identity and transport metadata; the last two belong to the envelope. `persona` is
 * optional and `schemaVersion` stays at 1: missing keys read as no override, and absent values are
 * never written (`withOptional`), so reads in both directions are accurate. Bumping the version
 * would add a branch for one optional field to every stored room.
 */
/**
 * The narration style the room chose. Only the three product-vocabulary values are carried
 * (`narration.ts`). Carrying the pack alias would tie renaming a body file to breaking records
 * other devices already received. Carrying the level would freeze a value the model decides; the
 * catalog answers the level on each turn.
 */
const RoomNarrationData = z
	.object({
		scope: z.enum(["strict", "reactive", "assisted", "auto"]),
		density: z.enum(["light", "rich"]),
		castTracking: z.boolean(),
	})
	.strict();

const RoomData = z.object({
	originStoryId: z.string().nullable(),
	title: z.string(),
	adult: z.boolean(),
	promptProtected: z.boolean(),
	seed: StoryChatSeedDto,
	persona: RoomPersonaData.nullable().optional(),
	/**
	 * Routing-friendly key: optional, schema still at 1 (the same rule as persona). It belongs to the
	 * conversation, so per-device issuance would give the room different cache locality on each device
	 * and keep the devices overwriting each other's key. It is not sent to the server in plain text,
	 * since the room payload is encrypted inside the envelope. The managed generation request is a
	 * separate path.
	 */
	routingSessionId: z.string().optional(),
	/**
	 * Narration style: optional, schema still at 1, the same rule as persona and the routing key. An
	 * old client drops the key and runs the room without a pack, which is accurate because that
	 * version has no packs. Bumping the version would require a branch for one optional field.
	 */
	narration: RoomNarrationData.nullable().optional(),
	/**
	 * Intensity level: optional, schema still at 1, the same rule as above. An old client falls back
	 * to the default, which is accurate for a version without this axis. The level is not re-checked
	 * here, since rejecting an `intense` value on an all-ages room would drop the whole room. The
	 * server's rating guard checks it anyway.
	 */
	intensity: z.enum(["softened", "intense"]).nullable().optional(),
	/**
	 * User note: optional, schema still at 1. Length is not checked here, because rejecting an
	 * over-long note would drop the whole room, the same reason the title avoids this check
	 * (`CHAT_ROOM_TITLE_MAX_LENGTH`). The storage path enforces the cap (`requireChatUserNote`), and
	 * the assembler clamps deterministically (`clampChatUserNote`).
	 */
	userNote: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/**
 * Fields fixed at creation. `seed` belongs here: the replay snapshot is a self-contained copy taken
 * at acquisition, and it is the room's largest field. Treating it as immutable keeps it out of the
 * conflict surface entirely.
 */
const ROOM_IMMUTABLE = [
	"originStoryId",
	"createdAt",
	"adult",
	"promptProtected",
] as const;

export const chatRoomSyncCodec = {
	type: "chat.room",
	schemaVersion: CHAT_SYNC_SCHEMA_VERSION,

	encode(record: ChatRoom): unknown {
		return withOptional(
			{
				originStoryId: record.originStoryId,
				title: record.title,
				adult: record.adult,
				promptProtected: record.promptProtected,
				seed: record.seed,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			},
			{
				/**
				 * A room with no issued key omits the key, for the same reason as persona below. A payload from
				 * before this axis existed stays byte-identical, and the receiving device reads it as not yet
				 * present and issues its own key.
				 */
				routingSessionId: record.routingSessionId,
				/**
				 * With no override, the key is omitted rather than written as `null`. `null` would give the
				 * same fact two shapes and break byte-identity with pre-axis payloads, so ciphertext already on
				 * the server and newly produced ciphertext must mean the same value.
				 */
				persona: record.persona ?? undefined,
				narration: record.narration ?? undefined,
				intensity: record.intensity ?? undefined,
				/**
				 * The empty string is omitted too. `applyRoomUserNote` already erases the key, so "no note" has
				 * a single representation.
				 */
				userNote: record.userNote || undefined,
			},
		);
	},

	decode(input: DecodeInput): ChatRoom | null {
		const parsed = RoomData.safeParse(input.data);
		if (!parsed.success) return null;
		const {
			persona,
			routingSessionId,
			narration,
			intensity,
			userNote,
			...rest
		} = parsed.data;
		return withOptional(
			{
				id: input.id,
				...rest,
				deletedAt: input.deletedAt,
				rev: input.rev,
				...INBOUND_META,
			},
			{
				persona: persona ?? undefined,
				routingSessionId,
				narration: narration ?? undefined,
				intensity: intensity ?? undefined,
				/* An empty string means no note. A `""` left by an old version must not come back as a key. */
				userNote: userNote || undefined,
			},
		);
	},

	/**
	 * Immutable fields are protected, and mutable fields use HLC. The acquisition snapshot is not
	 * overwritten by another device's copy, so the first recorder wins. If immutable fields actually
	 * differ, that state cannot arise on the normal path, so a diagnostic is recorded.
	 *
	 * `updatedAt` is merged with max, because the list must follow the later activity on either
	 * device. Taking only the winner's value would move a conversation continued on the losing device
	 * back to an old position.
	 */
	merge(
		local: ChatRoom,
		remote: ChatRoom,
		context: MergeCtx,
	): Merged<ChatRoom> {
		const remoteNewer = compareRev(remote.rev, local.rev) > 0;
		const sameImmutables = ROOM_IMMUTABLE.every(
			(key) => local[key] === remote[key],
		);
		if (!sameImmutables) context.note(CHAT_MERGE_NOTE.roomImmutableDivergence);

		const updatedAt = later(local.updatedAt, remote.updatedAt);
		/**
		 * Persona is mutable and follows the title's rule: the later version wins. Conflicting persona
		 * choices are rare, and losing one only means choosing again. Fields are not merged, because a
		 * role mixing A's name with B's description is one no user created.
		 */
		const persona = remoteNewer ? remote.persona : local.persona;
		/**
		 * Narration follows the same rule as the title, but unlike the routing key it is not protected
		 * from erasure, because it is a setting the user chose. If an old-version record wins and turns
		 * the pack off, that device really was running without it. Protecting the value would bring back
		 * a room that was switched off elsewhere. Values are not merged, for the same reason as persona.
		 */
		const narration = remoteNewer ? remote.narration : local.narration;
		/**
		 * Intensity follows the same rule as narration: the later version wins, and erasure is not
		 * protected. If an old record wins and resets the level to the default, that device was using the
		 * default. Protecting the value would keep reverted values coming back.
		 */
		const intensity = remoteNewer ? remote.intensity : local.intensity;
		/**
		 * User note follows the same rule as narration and is not erasure-protected. It is text the user
		 * wrote, so an erase on another device must win; protecting it would resurrect notes deleted
		 * elsewhere. Notes are never concatenated, since a merged note would inject instructions no user
		 * wrote into every prompt, which is worse than losing one.
		 */
		const userNote = remoteNewer ? remote.userNote : local.userNote;
		/**
		 * The routing key is never erased and converges when the two sides differ.
		 *
		 * Later-wins fails in one case: a record from a device that does not know this axis. Its payload
		 * has no key, so following the winner would erase an issued key, the device would issue a new
		 * one, and the room's cache locality would reset forever. Keeping local fails too: two devices
		 * filling an old room would each keep their own value and ping-pong forever. So if only one side
		 * has a key, that side's value is used; if both do, the HLC winner is used. The comparison is a
		 * total order, so both devices reach the same answer in one round trip.
		 */
		const routingSessionId =
			local.routingSessionId && remote.routingSessionId
				? remoteNewer
					? remote.routingSessionId
					: local.routingSessionId
				: (local.routingSessionId ?? remote.routingSessionId);
		/*
		 * Applied through a shared function, so "no persona override" has a single representation
		 * (`applyRoomPersona`). Writing `persona: null` here would give the same fact two record shapes.
		 */
		const record: ChatRoom = applyRoomPersona(
			{
				...local,
				title: remoteNewer ? remote.title : local.title,
				updatedAt,
				/* No key is created when absent, so both devices produce the same record shape. */
				...(routingSessionId ? { routingSessionId } : {}),
				// Max, as in `mergedRev`: the room also merges `updatedAt`, so the result is neither input's
				// revision.
				rev: mergedRev(local.rev, remote.rev),
			},
			persona ?? null,
		);
		/*
		 * Applied through the shared function (`applyRoomNarration`), for the same reason as persona.
		 * Writing `narration: null` directly would give the same fact two record shapes.
		 */
		const withNarration = applyRoomNarration(record, narration ?? null);
		/*
		 * Applied through the shared function (`applyRoomIntensity`). Writing `intensity: undefined`
		 * directly would give two shapes: an absent key and a key holding `undefined`.
		 */
		const withIntensity = applyRoomIntensity(withNarration, intensity ?? null);
		/*
		 * Applied through the shared function (`applyRoomUserNote`). Writing `userNote: ""` directly
		 * would give the same fact two shapes.
		 */
		const merged = applyRoomUserNote(withIntensity, userNote ?? null);
		/**
		 * Did the server copy win as is, meaning there is nothing to send back? Equal revisions mean the
		 * same write from the same device, since the revision includes the device id. The revision alone
		 * decides it, without a deep comparison of the room's `seed` on every record.
		 */
		return {
			record: merged,
			remoteWins:
				compareRev(remote.rev, local.rev) >= 0 &&
				updatedAt === remote.updatedAt &&
				/*
				 * A routing key that differs from the server copy means there is something to send back. An
				 * old-version payload can win on revision while carrying no key, and returning true here would
				 * mean the kept value never reaches the server.
				 */
				routingSessionId === remote.routingSessionId &&
				sameImmutables,
		};
	},

	revOf: (record: ChatRoom): Rev => record.rev,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * chat.message
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The cache-usage axes were added, but `schemaVersion` stays at 1: every new field is optional,
 * unknown keys are ignored, and absent keys are not written. Reads in both directions are accurate,
 * with the two axes missing on one side. Bumping the version would make every stored record
 * old-version and require a reader branch for two optional fields. A bump is needed only when old
 * payloads can no longer be read as they are.
 */
const MessageData = z.object({
	roomId: z.string(),
	role: z.enum(["user", "assistant"]),
	speaker: z.string(),
	content: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	model: z.string().optional(),
	inputTokens: z.number().optional(),
	cachedInputTokens: z.number().optional(),
	cacheWriteInputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	incomplete: z.boolean().optional(),
	truncated: z.boolean().optional(),
});

export const chatMessageSyncCodec = {
	type: "chat.message",
	schemaVersion: CHAT_SYNC_SCHEMA_VERSION,

	encode(record: ChatMessage): unknown {
		return withOptional(
			{
				roomId: record.roomId,
				role: record.role,
				speaker: record.speaker,
				content: record.content,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			},
			{
				model: record.model,
				inputTokens: record.inputTokens,
				cachedInputTokens: record.cachedInputTokens,
				cacheWriteInputTokens: record.cacheWriteInputTokens,
				outputTokens: record.outputTokens,
				incomplete: record.incomplete,
				truncated: record.truncated,
			},
		);
	},

	decode(input: DecodeInput): ChatMessage | null {
		const parsed = MessageData.safeParse(input.data);
		if (!parsed.success) return null;
		const {
			model,
			inputTokens,
			cachedInputTokens,
			cacheWriteInputTokens,
			outputTokens,
			incomplete,
			truncated,
			...rest
		} = parsed.data;
		return withOptional(
			{
				id: input.id,
				...rest,
				deletedAt: input.deletedAt,
				rev: input.rev,
				...INBOUND_META,
			},
			{
				model,
				inputTokens,
				cachedInputTokens,
				cacheWriteInputTokens,
				outputTokens,
				incomplete,
				truncated,
			},
		);
	},

	/**
	 * Complete-first, then HLC. A message is effectively immutable once complete. The realistic
	 * conflict is one side saving an `incomplete: true` copy after a dropped stream, while the other
	 * side (or a retry) produces the complete copy. The longer, complete copy is correct. This rule
	 * sits above HLC because a dropped save can be finalized late. No text CRDT is built, because a
	 * message is not co-edited.
	 */
	merge(
		local: ChatMessage,
		remote: ChatMessage,
		context: MergeCtx,
	): Merged<ChatMessage> {
		const localComplete = local.incomplete !== true;
		const remoteComplete = remote.incomplete !== true;
		if (localComplete && !remoteComplete) {
			context.note(CHAT_MERGE_NOTE.messageIncompleteRejected);
			/**
			 * The content stays local, but the revision is raised. Sending the old revision would make the
			 * peer treat this as a replay, ignore it, and re-upload its own incomplete copy, so the two
			 * copies would swap places forever.
			 */
			return {
				record: { ...local, rev: mergedRev(local.rev, remote.rev) },
				remoteWins: false,
			};
		}
		if (!localComplete && remoteComplete)
			return {
				record: {
					...remote,
					dirty: local.dirty,
					serverVersion: local.serverVersion,
				},
				remoteWins: true,
			};

		const remoteWins = compareRev(remote.rev, local.rev) >= 0;
		return {
			record: remoteWins
				? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
				: local,
			remoteWins,
		};
	},

	revOf: (record: ChatMessage): Rev => record.rev,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * chat.memory
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Memory payload: the content rules are re-applied here. `z.string().max()` is deliberately not
 * used, since it counts UTF-16 units while the product rule counts code points
 * (`checkMemoryContent`). A memory with emoji near the cap would be valid on the sender and
 * rejected by the receiver, and that memory would never reach the receiving device. The value is
 * also trimmed first, because normalizing a value from an old or buggy client is safer than
 * discarding the record.
 */
/**
 * Automatic memories get the narrow cap as well. The predicate differs by source because the cap is
 * a product rule: checking only the manual 1,000-character cap would let automatic memories break
 * this device's budget and ordering assumptions. Over-length values are rejected rather than
 * truncated, unlike summaries, because a truncated fact is no longer a fact.
 */
const MemoryData = z
	.object({
		roomId: z.string(),
		content: z.string(),
		pinned: z.boolean(),
		/**
		 * `source` is optional; absent means `"user"`. Records from before this axis were all
		 * user-written, and requiring the key would reject them, so those memories would never reach
		 * devices on the new schema. That is why `schemaVersion` stays at 1: old readers ignore the
		 * unknown keys, and new readers read a missing key as `"user"`. Both are accurate.
		 */
		source: z.enum(CHAT_MEMORY_SOURCES).optional(),
		/** Origin time of an automatic memory. Absent on manual memories. */
		originAt: z.string().nullable().optional(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.superRefine((value, ctx) => {
		const content = normalizeMemoryContent(value.content);
		const checked =
			readMemorySource(value.source) === "auto"
				? checkAutoMemoryContent(content)
				: checkMemoryContent(content);
		if (!checked.ok)
			ctx.addIssue({
				code: "custom",
				path: ["content"],
				message: "memory content is outside the rules",
			});
	});

export const chatMemorySyncCodec = {
	type: "chat.memory",
	schemaVersion: CHAT_SYNC_SCHEMA_VERSION,

	encode(record: ChatMemory): unknown {
		return withOptional(
			{
				roomId: record.roomId,
				content: record.content,
				pinned: record.pinned,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			},
			{
				/**
				 * Manual memories omit the key, because `"user"` is what absence means. Writing it would give
				 * the same fact two shapes and break byte-identity with the pre-axis payload, which the
				 * ciphertext already on the server depends on.
				 */
				source: record.source === "auto" ? "auto" : undefined,
				originAt: record.originAt ?? undefined,
			},
		);
	},

	decode(input: DecodeInput): ChatMemory | null {
		const parsed = MemoryData.safeParse(input.data);
		if (!parsed.success) return null;
		const { source, originAt, content, ...rest } = parsed.data;
		const resolved = readMemorySource(source);
		return {
			id: input.id,
			...rest,
			content: normalizeMemoryContent(content),
			source: resolved,
			/** Manual memories get no origin time, the same rule as the factory. */
			originAt: resolved === "auto" ? (originAt ?? null) : null,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},

	/**
	 * Plain HLC last-writer-wins, except for the direction of `source` (see below). Memories have no
	 * partial state, so the message-style complete-first rule does not apply. A memory is confirmed by
	 * the user one version at a time, and a conflict loses one sentence, not data. It is a private
	 * note, not a co-edited document, so no text CRDT.
	 *
	 * `roomId` and `createdAt` get no immutability check. No normal path can make them diverge, and
	 * they are not large like the room's `seed`.
	 */
	merge(
		local: ChatMemory,
		remote: ChatMemory,
		_context: MergeCtx,
	): Merged<ChatMemory> {
		const remoteWins = compareRev(remote.rev, local.rev) >= 0;
		const winner = remoteWins ? remote : local;
		const loser = remoteWins ? local : remote;
		/**
		 * The one exception is `source`: a human-written version must not lose to an automatic one. Plain
		 * HLC could revert a human edit to an automatic sentence when a device unaware of the promotion
		 * writes later on the clock, even though storage only allows `auto` to `user`. Maintenance never
		 * targets human-written memories, so an automatic winner means nothing but an unaware device. If
		 * either side is deleted, the memory is left alone. The loser's content is kept, the revision is
		 * the max of both, and `remoteWins` is false because the result matches neither server version.
		 */
		if (
			winner.source === "auto" &&
			mergeMemorySource(winner.source, loser.source) === "user" &&
			winner.deletedAt === null &&
			loser.deletedAt === null
		)
			return {
				record: {
					...loser,
					rev: mergedRev(local.rev, remote.rev),
					serverVersion: local.serverVersion,
				},
				remoteWins: false,
			};
		return {
			record: remoteWins
				? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
				: local,
			remoteWins,
		};
	},

	revOf: (record: ChatMemory): Rev => record.rev,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * chat.character
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Character payload, the room's fourth child. The schema stays at 1 because a record kind was
 * added, not a version: the engine skips unknown kinds and advances the cursor, so accounts with
 * older clients see no change in the rest of sync. Over-long text is truncated rather than
 * rejected, because a rejected character would never reach this device, while a truncated
 * description is still true of that character. A record with an empty name is rejected, since it
 * cannot be referenced in a list or prompt.
 */
const CharacterData = z.object({
	roomId: z.string(),
	name: z.string(),
	prompt: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/** Truncates values that arrive over the limit, so the rule is defined in one place. */
const clampCharacterField = (value: string, max: number): string => {
	const points = [...value];
	return points.length > max ? points.slice(0, max).join("") : value;
};

export const chatCharacterSyncCodec = {
	type: "chat.character",
	schemaVersion: CHAT_SYNC_SCHEMA_VERSION,

	encode(record: ChatCharacter): unknown {
		return {
			roomId: record.roomId,
			name: record.name,
			prompt: record.prompt,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};
	},

	decode(input: DecodeInput): ChatCharacter | null {
		const parsed = CharacterData.safeParse(input.data);
		if (!parsed.success) return null;
		const name = parsed.data.name.trim();
		/**
		 * A name is required. Without one the character cannot be referenced, so it can be neither listed
		 * nor placed in a prompt.
		 */
		if (!name) return null;
		return {
			id: input.id,
			...parsed.data,
			name: clampCharacterField(name, CHAT_CHARACTER_NAME_MAX_LENGTH),
			prompt: clampCharacterField(
				parsed.data.prompt.trim(),
				CHAT_CHARACTER_PROMPT_MAX_LENGTH,
			),
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},

	/**
	 * Plain HLC last-writer-wins, for the same reasons as memories. Simultaneous edits are rare, and
	 * the wrong outcome is one edit winning, not data loss. Fields are not merged individually: a name
	 * from one device with a description from the other is a value no user created.
	 */
	merge(
		local: ChatCharacter,
		remote: ChatCharacter,
		_context: MergeCtx,
	): Merged<ChatCharacter> {
		const remoteWins = compareRev(remote.rev, local.rev) >= 0;
		return {
			record: remoteWins
				? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
				: local,
			remoteWins,
		};
	},

	revOf: (record: ChatCharacter): Rev => record.rev,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * chat.summary
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Summary payload. Identity is the room id, so the envelope's `id` is the `roomId`. The `roomId` is
 * still carried so the receiving store reads the parent from the payload, like other children,
 * without a special case for this codec. The frontier is one nested object, because flattening the
 * two axes would allow a timestamp without a message id, which points nowhere while claiming to be
 * the frontier.
 */
const SummaryFrontierData = z
	.object({ createdAt: z.string(), messageId: z.string() })
	.strict();

const SummaryData = z.object({
	roomId: z.string(),
	/**
	 * Over-long summaries are truncated on receipt, unlike memories. A rejected summary would never
	 * reach this device, since a room has only one summary and another device resends it only when
	 * maintenance runs again. A truncated summary is incomplete but still true, which beats nothing.
	 */
	summary: z.string(),
	frontier: SummaryFrontierData.nullable(),
	/**
	 * `z.number()` already rejects `NaN`, which drops the record. Negative and fractional values are
	 * folded by the decoder (`safeEpoch`), because merge builds a total order from this value.
	 */
	epoch: z.number(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/**
 * Epoch must be a non-negative integer. A corrupt value folds to 0, the weakest generation, which
 * is the safe choice.
 */
const safeEpoch = (value: number): number =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export const chatSummarySyncCodec = {
	type: "chat.summary",
	schemaVersion: CHAT_SYNC_SCHEMA_VERSION,

	encode(record: ChatSummary): unknown {
		return {
			roomId: record.roomId,
			summary: record.summary,
			frontier: record.frontier,
			epoch: record.epoch,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};
	},

	decode(input: DecodeInput): ChatSummary | null {
		const parsed = SummaryData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			/** Identity comes from the envelope, not from the payload's `roomId`. */
			id: input.id,
			...parsed.data,
			summary: clampSummary(parsed.data.summary),
			epoch: safeEpoch(parsed.data.epoch),
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},

	/**
	 * Generation first, then HLC: the one place where summary merge differs from plain memory
	 * last-writer-wins. If device A forgets history and bumps the epoch while device B advances the
	 * old summary at epoch 0 with a later revision, HLC alone would resurrect the deleted
	 * conversation's summary permanently. Generation-first loses only B's one-step advance, which gets
	 * recomputed. "Empty summary wins" is rejected because a stale rewind would then reverse every
	 * later advance forever. Generations only rise, so advances after a rewind are decided by plain
	 * HLC. There is no text CRDT, since picking one summary is correct.
	 */
	merge(
		local: ChatSummary,
		remote: ChatSummary,
		_context: MergeCtx,
	): Merged<ChatSummary> {
		const localEpoch = safeEpoch(local.epoch);
		const remoteEpoch = safeEpoch(remote.epoch);
		const remoteWins =
			remoteEpoch !== localEpoch
				? remoteEpoch > localEpoch
				: compareRev(remote.rev, local.rev) >= 0;
		return {
			record: remoteWins
				? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
				: {
						...local,
						/**
						 * Even if local wins, the revision is raised. Sending the old revision would make the peer
						 * ignore it as a replay and re-upload its own version, and the two devices would overwrite
						 * each other forever.
						 */
						rev: mergedRev(local.rev, remote.rev),
					},
			remoteWins,
		};
	},

	revOf: (record: ChatSummary): Rev => record.rev,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * chat.persona
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Persona payload: content rules are re-applied here, for the same reason as memory.
 * `z.string().max()` would count UTF-16 units while the product rule counts code points
 * (`checkPersonaName`), so a valid persona near the cap would be rejected by the receiver and never
 * arrive. The value is trimmed first, since normalizing is safer than discarding a buggy client's
 * record. The absence of `roomId` matters most: personas belong to the account, not to rooms, so
 * room tombstones do not cascade to them.
 */
const PersonaData = z
	.object({
		name: z.string(),
		description: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.superRefine((value, ctx) => {
		if (!checkPersonaName(normalizePersonaName(value.name)).ok)
			ctx.addIssue({
				code: "custom",
				path: ["name"],
				message: "persona name is outside the rules",
			});
		if (
			!checkPersonaDescription(normalizePersonaDescription(value.description))
				.ok
		)
			ctx.addIssue({
				code: "custom",
				path: ["description"],
				message: "persona description is outside the rules",
			});
	});

export const chatPersonaSyncCodec = {
	type: "chat.persona",
	schemaVersion: CHAT_SYNC_SCHEMA_VERSION,

	encode(record: ChatPersona): unknown {
		return {
			name: record.name,
			description: record.description,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};
	},

	decode(input: DecodeInput): ChatPersona | null {
		const parsed = PersonaData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...parsed.data,
			name: normalizePersonaName(parsed.data.name),
			description: normalizePersonaDescription(parsed.data.description),
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},

	/**
	 * Plain HLC last-writer-wins, with no persona-specific rule, because there is no partial state to
	 * protect. Simultaneous edits are rare, and the wrong outcome is one version winning. The merge
	 * does not touch rooms: the speaker and prompt of an existing conversation are set by the room's
	 * own copy, not by the library entry.
	 */
	merge(
		local: ChatPersona,
		remote: ChatPersona,
		_context: MergeCtx,
	): Merged<ChatPersona> {
		const remoteWins = compareRev(remote.rev, local.rev) >= 0;
		return {
			record: remoteWins
				? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
				: local,
			remoteWins,
		};
	},

	revOf: (record: ChatPersona): Rev => record.rev,
};

/**
 * The list is ordered parents first and is also the outbound collection order. Memories follow
 * messages only by convention, since the children do not reference each other. New types are
 * appended to the end so that in-progress collection cursors stay valid.
 */
export const chatSyncCodecs = [
	chatRoomSyncCodec,
	chatMessageSyncCodec,
	chatMemorySyncCodec,
	chatSummarySyncCodec,
	/**
	 * Personas have no parent, so the only meaningful position is the end. New types go at the end,
	 * which is safest for collection cursors already in progress.
	 */
	chatPersonaSyncCodec,
	/**
	 * Characters are a room child but are placed last. The only constraint in this array is
	 * parent-before-child, which `chat.room` already satisfies from the first line. Inserting in the
	 * middle would shift later types and break in-progress collection cursors, so new types go at the
	 * end (`sync-codec.test.ts` asserts this).
	 */
	chatCharacterSyncCodec,
];
