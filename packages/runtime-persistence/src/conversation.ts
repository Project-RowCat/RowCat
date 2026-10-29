import type { Rev } from "@rowcat/contracts/sync";
import { z } from "zod";
import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	isRuntimeSaveSlot,
	RUNTIME_SAVE_SLOTS,
	type RuntimeSaveSlot,
	type RuntimeSaveSyncMeta,
} from "./model.ts";
import { compareRev } from "./rev-order.ts";

/**
 * Runtime conversation record: this member opened this runtime playthrough and can resume it. It is
 * library metadata, not save state. Its lifetime is not a third kind of progress.
 *
 * Not projected from the save state. A playthrough row is the wrong signal: the first open may
 * commit nothing, runtimes without useStoryState never create one, removing a list row must not
 * erase progress, and save updatedAt is the last commit while library activity is the last open.
 *
 * Holds no source, artifact, snapshot, provider or entitlement. title is the last displayed value,
 * not authorization. Opening is re-checked by the server each time.
 *
 * Identity follows the playthrough: runtime-conversation:<work id>:<slot>. No artifact hash,
 * version, compiler, VM generation, address or random value enters it, so a republish or a first
 * open on two devices converges on one record. The prefix differs because the server key is (owner,
 * id) and the same id would make the rows contend (model.ts).
 *
 * Removal is not a tombstone. In sync a tombstone is final and beats a live remote version
 * (keep-deleted in decideInbound), but a removed work must revive under the same identity when
 * reopened, and the revival must reach other devices. So removal is a newer state (removedAt), like
 * a reset that raises the revision with an empty snapshot. Under whole-record LWW both converge.
 */

export const RUNTIME_CONVERSATION_ID_PREFIX = "runtime-conversation";

export const runtimeConversationIdFor = (
	storyId: string,
	slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
): string => `${RUNTIME_CONVERSATION_ID_PREFIX}:${storyId}:${slot}`;

export interface RuntimeConversationRecord extends RuntimeSaveSyncMeta {
	/** `runtimeConversationIdFor(storyId, slot)`. */
	id: string;
	storyId: string;
	slot: RuntimeSaveSlot;
	/**
	 * Last confirmed work title. It is a display value, not authority. An empty string means the title
	 * is not yet known.
	 */
	title: string;
	/** Time of the first successful open (ISO 8601). Later opens do not change it. */
	createdAt: string;
	/** Time of the last successful open (ISO 8601). This is the library's activity axis. */
	updatedAt: string;
	/**
	 * Whether the work was removed from the library. null means it is listed. Progress has no meaning
	 * here.
	 */
	removedAt: string | null;
}

/**
 * Whether the row is shown in the library. It is hidden by either a protocol tombstone or a list
 * removal.
 */
export const isVisibleRuntimeConversation = (
	record: RuntimeConversationRecord,
): boolean => record.deletedAt === null && record.removedAt === null;

/**
 * Pure check: may a library row be created? Both play screens call this function. Only one
 * condition creates a row: after checking entitlement, the server returned a playback response of
 * kind runtime. Opening the address, starting the VM, and committing save state are not conditions.
 * The first implies no entitlement, and the other two would omit runtimes that never write save
 * state. A missing work, no entitlement, a required purchase, a corrupt response (null) and a chat
 * work (chat) create nothing. It also waits until the title is settled, whether the detail arrived
 * or its lookup failed. Writing an empty title and then the real one right away would make one open
 * into two writes, and an untitled row would flash for a frame.
 */
/**
 * Session key for play-start telemetry: exactly the library row's id. A runtime play has no room,
 * so the conversation rule of one room, one start cannot apply. Instead, the first session that
 * opens this work and slot for an account counts as the start. The key is derived deterministically
 * from work and slot, so reopening, opening on another device, or resetting the playthrough all hit
 * the server's idempotency key and no second row is created. A runtime's play start therefore
 * counts once per account. The analytics copy says so. The key is not random. A fresh key per
 * session would make each app open count as a start, and that count cannot be placed on the same
 * scale as conversations' rooms created.
 */
export const runtimePlayStartSessionKey = (
	storyId: string,
	slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
): string => runtimeConversationIdFor(storyId, slot);

/**
 * Whether to report the play start now: the session is running and this screen has not reported
 * yet. 'running' is the boundary because it defines a session that can write locally. The playback
 * response arriving, the library row being created and the VM starting are all earlier. Reporting
 * at any of them would count opens that later fail artifact compatibility as starts. Once per
 * screen stops re-renders and restarts from repeating the request. The server's idempotency key is
 * the final authority; this function only reduces the requests.
 */
export function runtimePlayStartDue(input: {
	running: boolean;
	reported: boolean;
}): boolean {
	return input.running && !input.reported;
}

export function runtimeConversationPresenceAllowed(input: {
	/**
	 * Kind of the playback response: chat or runtime. null if not yet received or the request failed.
	 */
	playbackKind: "chat" | "runtime" | null;
	/**
	 * Whether the work title is settled: it arrived, or its lookup failed and there is nothing more to
	 * wait for.
	 */
	storyResolved: boolean;
}): boolean {
	return input.playbackKind === "runtime" && input.storyResolved;
}

/**
 * Records one successful open: creates or updates the row. A null title keeps the title already
 * known. A failed work-detail lookup must not blank the library row while playback still opens. If
 * no title was ever known, it is an empty string. What to show there is the screen's decision,
 * since this pure package carries no UI copy.
 */
export interface RuntimeConversationTouch {
	storyId: string;
	slot?: RuntimeSaveSlot;
	title: string | null;
	/** ISO 8601, produced by the caller's clock. The store never reads Date.now(). */
	now: string;
}

export interface RuntimeConversationRemoval {
	storyId: string;
	slot?: RuntimeSaveSlot;
	now: string;
}

/**
 * Platform-neutral port: Dexie on web and SQLite on mobile implement the same contract. It is a
 * separate port from RuntimeSaveStore on purpose. The save port sits inside the playthrough
 * lifecycle's ownership procedure (stop, flush, dispose, next session). Library metadata there
 * would add a participant to that procedure, and recording a row would become a question of scope
 * ownership. These writes happen outside that procedure, once, when entitlement is confirmed. There
 * is no delete. Removing from the list is remove, which is not a deletion.
 */
export interface RuntimeConversationStore {
	get(
		storyId: string,
		slot?: RuntimeSaveSlot,
	): Promise<RuntimeConversationRecord | null>;
	/**
	 * All rows in the library, ordered updatedAt DESC, id DESC. Removed rows and tombstones are not
	 * returned.
	 */
	list(): Promise<RuntimeConversationRecord[]>;
	/**
	 * Creates or updates. createdAt is kept, updatedAt advances, and the removed mark is cleared. The
	 * revision is issued inside the store's transaction, for the same reason as RuntimeSaveStore.
	 */
	touch(write: RuntimeConversationTouch): Promise<RuntimeConversationRecord>;
	/**
	 * Removes the row from the library. A missing row is a no-op (null). Progress is never touched.
	 */
	remove(
		write: RuntimeConversationRemoval,
	): Promise<RuntimeConversationRecord | null>;
}

/**
 * The create and update rule, shared by all three adapters. Revision, dirty and serverVersion are
 * set by each adapter's transaction, so they are absent here. This function decides only value
 * rules: createdAt on first open, keeping the known title, and clearing the removed mark.
 */
export function nextRuntimeConversation(
	previous: RuntimeConversationRecord | null,
	write: RuntimeConversationTouch,
): Omit<RuntimeConversationRecord, "rev" | "dirty" | "serverVersion"> {
	const slot = write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT;
	return {
		id: runtimeConversationIdFor(write.storyId, slot),
		storyId: write.storyId,
		slot,
		title: write.title ?? previous?.title ?? "",
		createdAt: previous?.createdAt ?? write.now,
		updatedAt: write.now,
		removedAt: null,
		deletedAt: null,
	};
}

export const RUNTIME_CONVERSATION_SYNC_TYPE = "runtime.conversation";
export const RUNTIME_CONVERSATION_SYNC_SCHEMA_VERSION = 1;

const ConversationData = z.object({
	storyId: z.string().min(1),
	slot: z.enum(RUNTIME_SAVE_SLOTS),
	title: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	removedAt: z.string().nullable(),
});

/**
 * runtime.conversation: whole-record HLC LWW. Fields are not merged. If title, activity and removal
 * each won separately, a state nobody wrote could appear, such as a row removed on device A coming
 * back with B's new title. The winner is the whole record. Under that rule, removal and reopening
 * are both newer states and converge deterministically.
 */
export const runtimeConversationSyncCodec = {
	type: RUNTIME_CONVERSATION_SYNC_TYPE,
	schemaVersion: RUNTIME_CONVERSATION_SYNC_SCHEMA_VERSION,
	encode: (record: RuntimeConversationRecord): unknown => ({
		storyId: record.storyId,
		slot: record.slot,
		title: record.title,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		removedAt: record.removedAt,
	}),
	decode(input: {
		id: string;
		schemaVersion: number;
		rev: Rev;
		deletedAt: string | null;
		data: unknown;
	}): RuntimeConversationRecord | null {
		const parsed = ConversationData.safeParse(input.data);
		if (!parsed.success) return null;
		if (!isRuntimeSaveSlot(parsed.data.slot)) return null;
		return {
			id: input.id,
			storyId: parsed.data.storyId,
			slot: parsed.data.slot,
			title: parsed.data.title,
			createdAt: parsed.data.createdAt,
			updatedAt: parsed.data.updatedAt,
			removedAt: parsed.data.removedAt,
			deletedAt: input.deletedAt,
			rev: input.rev,
			dirty: 0,
			serverVersion: 0,
		};
	},
	merge(
		local: RuntimeConversationRecord,
		remote: RuntimeConversationRecord,
	): { record: RuntimeConversationRecord; remoteWins: boolean } {
		const remoteWins = compareRev(remote.rev, local.rev) >= 0;
		return {
			record: remoteWins
				? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
				: local,
			remoteWins,
		};
	},
	revOf: (record: RuntimeConversationRecord): Rev => record.rev,
};
