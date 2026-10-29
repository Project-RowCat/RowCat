import {
	type AppendMessageInput,
	type AssistantContinuation,
	applyRoomIntensity,
	applyRoomNarration,
	applyRoomPersona,
	applyRoomUserNote,
	CHAT_CHARACTER_MAX_PER_ROOM,
	CHAT_MEMORY_MAX_PER_ROOM,
	CHAT_MESSAGE_PAGE_SIZE,
	type ChatCharacter,
	ChatCharacterLimitError,
	type ChatIntensity,
	type ChatMaintenancePlan,
	type ChatMemory,
	ChatMemoryLimitError,
	type ChatMessage,
	type ChatNarrationSettings,
	type ChatPersona,
	type ChatPersonaSnapshot,
	type ChatRoom,
	ChatRoomMissingError,
	type ChatStore,
	type ChatSummary,
	type ChatTailMode,
	type ChatTailRewrite,
	type CreateCharacterInput,
	type CreateMemoryInput,
	type CreatePersonaInput,
	type CreateRoomInput,
	createCharacterRecord,
	createMemoryRecord,
	createMessageRecord,
	createPersonaRecord,
	createRoomRecord,
	createSummaryRecord,
	extendAssistantRecord,
	isAutoMemory,
	isLiveChatRecord,
	maintenanceStillApplies,
	markCascadeDeleted,
	markLocalDelete,
	markLocalUpdate,
	mergeMemorySource,
	nextSummaryEpoch,
	planMaintenanceRewind,
	requireCharacterName,
	requireCharacterPrompt,
	requireChatUserNote,
	requireEditableRole,
	requireMemoryContent,
	requireMessageContent,
	requirePersonaDescription,
	requirePersonaName,
	requireRoomTitle,
	rewindChangesAnything,
	selectChatTail,
	sortCharacters,
	sortMemories,
	sortPersonas,
	summaryIdFor,
	type UpdateCharacterPatch,
	type UpdateMemoryPatch,
	type UpdateMessagePatch,
	type UpdatePersonaPatch,
} from "@rowcat/chat";
import { newLocalId, nowIso } from "#/lib/local-data/clock.ts";
import type { LocalDb } from "#/lib/local-data/db.ts";
import { nextRev, nextRevs } from "#/lib/local-data/hlc.ts";

/**
 * The IndexedDB implementation of ChatStore. Three port contracts must actually hold here:
 * ascending query order, deleted items never visible, and atomicity. The rest is transcribing Dexie
 * calls; if this file grows long, rules have usually leaked in. Atomicity's scope is wider now.
 * Writing a record includes issuing its revision, and the clock state that issued it is stored in
 * the `syncState` row, so every write transaction also locks that table. If they were split, the
 * record would be saved while the clock stayed put, and the next write would issue the same
 * revision again, making two versions indistinguishable.
 */

/**
 * Upper bound for 'all messages of this room' in a composite key. IndexedDB orders keys as number <
 * date < string < binary < array, so an empty array sorts above any string: [roomId, []] is above
 * every [roomId, time, id]. The lower bound is just [roomId], since a shorter array with the same
 * prefix sorts first. Dexie.minKey and maxKey are not used: as composite key components they are
 * rejected (fake-indexeddb does so), while relying on the key-order rule behaves the same on every
 * engine.
 */
const MAX_COMPONENT: unknown[] = [];

export function createChatStore(db: LocalDb): ChatStore {
	/**
	 * A live room. Call only inside a transaction. Not reviving deleted rooms is the point: every path
	 * that touches a room passes through here, so a late write for a room just deleted in another tab
	 * leaves the tombstone in place.
	 */
	async function liveRoom(id: string): Promise<ChatRoom | null> {
		const room = await db.rooms.get(id);
		return room && isLiveChatRecord(room) ? room : null;
	}

	/**
	 * Advances the room's activity time; call only inside an already open transaction. Does nothing if
	 * the room is missing or deleted. The message add, update and delete paths assume the room exists,
	 * but another tab may have cleared it in the meantime. Reviving it then would be worse than not
	 * throwing.
	 */
	async function touchRoomInTx(roomId: string, now: string): Promise<void> {
		const room = await liveRoom(roomId);
		if (!room) return;
		await db.rooms.put(markLocalUpdate(room, now, await nextRev(db)));
	}

	/**
	 * Returned for a rewrite with no anchor (nothing was done). Defined in one place so both
	 * operations return the same value.
	 */
	const NOT_APPLIED: ChatTailRewrite = { applied: false, removed: 0 };

	/**
	 * One tail rewrite, shared by edit and `delete from here`. It must be a single transaction:
	 * splitting the anchor update, the tail tombstones and the room activity time would commit an
	 * edited message whose old replies are still present. The UI renders committed state as settled.
	 * The read starts at the anchor, so only the rows to be deleted are loaded. The selection rule
	 * stays in selectChatTail. Human-written memories are not touched: they are settings the user
	 * wrote for the room, and deleting them because an old chat was deleted would silently erase them.
	 * Automatic maintenance output (summary, auto memories) is derived from history, so
	 * planMaintenanceRewind runs in the same transaction (rewindMaintenanceInTx). Otherwise a
	 * generation started in between would include a summary of deleted turns.
	 */
	async function rewriteTail(
		anchorId: string,
		mode: ChatTailMode,
		/** For an edit, the content to save; otherwise null. The anchor survives only in `after` mode. */
		content: string | null,
	): Promise<ChatTailRewrite> {
		const now = nowIso();
		return db.transaction(
			"rw",
			[db.messages, db.rooms, db.chatMemories, db.chatSummaries, db.syncState],
			async () => {
				const anchor = await db.messages.get(anchorId);
				// If the anchor disappeared or was deleted in the meantime, do not revive it. Do nothing.
				if (!anchor || !isLiveChatRecord(anchor)) return NOT_APPLIED;
				const room = await liveRoom(anchor.roomId);
				// Another tab deleted the whole room. Writing over that tombstone would revive the deleted
				// chat.
				if (!room) return NOT_APPLIED;

				const rows = await db.messages
					.where("[roomId+createdAt+id]")
					.between(
						// The lower bound is the anchor itself (inclusive). Filtering out what precedes it in `after`
						// mode is the pure rule's job.
						[anchor.roomId, anchor.createdAt, anchor.id],
						[anchor.roomId, MAX_COMPONENT],
						true,
						true,
					)
					.toArray();
				const tail = selectChatTail(
					rows.filter(isLiveChatRecord),
					anchorId,
					mode,
				);
				// Liveness was checked above, so this should not happen. If it does, the code fails toward
				// deleting nothing.
				if (!tail) return NOT_APPLIED;

				/**
				 * Revisions are issued all at once. One logical operation reads the wall clock once
				 * (`nextRevs`) and assigns each record a different value from it. Using one value for all would
				 * leave a later merge unable to order the records. Calling Date.now() per record would make one
				 * edit look like it spanned several milliseconds.
				 */
				const revs = await nextRevs(
					db,
					tail.length + (content === null ? 1 : 2),
				);
				let issued = 0;

				if (content !== null)
					await db.messages.put(
						markLocalUpdate({ ...anchor, content }, now, revs[issued++]),
					);

				/**
				 * Each tail message gets its own tombstone (dirty plus a new revision). This differs from the
				 * room-delete cascade, because there is no parent tombstone to stand in for them. Without a
				 * marker, other devices would think the messages they still know exist and re-upload them.
				 */
				await db.messages.bulkPut(
					tail.map((message) => markLocalDelete(message, now, revs[issued++])),
				);

				/**
				 * The room's activity time also advances. A history rewrite is a visible change to the
				 * conversation, so it follows the same rule as add, update and delete. Leaving it out would
				 * keep the just-edited chat at an old position in the list.
				 */
				await db.rooms.put(markLocalUpdate(room, now, revs[issued++]));

				/**
				 * The rewind uses the first tail message's time as the cutoff. That value fully expresses
				 * 'everything from here on is gone', because the tail is always a contiguous range.
				 */
				const cutoff = tail[0]?.createdAt;
				if (cutoff) await rewindMaintenanceInTx(anchor.roomId, cutoff, now);

				return { applied: true, removed: tail.length };
			},
		);
	}

	/**
	 * Rewinds maintenance state when history is cut, inside an already open transaction. All rules
	 * live in the pure function (planMaintenanceRewind); this only writes its decisions into records.
	 * If nothing needs to change, nothing is written. Ordinary edits and regenerations happen in the
	 * recent raw range and usually end here. Issuing a useless revision would turn the summary record
	 * into a push candidate on every edit.
	 */
	async function rewindMaintenanceInTx(
		roomId: string,
		cutoffCreatedAt: string,
		now: string,
	): Promise<void> {
		const stored = await db.chatSummaries.get(summaryIdFor(roomId));
		const summary = stored && isLiveChatRecord(stored) ? stored : null;
		const memories = (
			await db.chatMemories.where("roomId").equals(roomId).toArray()
		).filter(isLiveChatRecord);

		const rewind = planMaintenanceRewind({
			summary,
			memories,
			cutoffCreatedAt,
		});
		if (!rewindChangesAnything(rewind)) return;

		const revs = await nextRevs(
			db,
			rewind.staleMemoryIds.length + (rewind.resetSummary ? 1 : 0),
		);
		let issued = 0;

		if (rewind.resetSummary) {
			/**
			 * The summary is discarded but its record is kept. Deleting the row would leave no way to tell
			 * other devices (a tombstone is needed), and there would be no place for the generation counter
			 * to increase. That integer is what lets a merge prefer the rewind over the old state (see
			 * ChatSummary.epoch).
			 */
			const base =
				summary ??
				createSummaryRecord(
					{ roomId, summary: "", frontier: null },
					{ now, rev: revs[issued] },
				);
			await db.chatSummaries.put(
				markLocalUpdate(
					{
						...base,
						summary: "",
						frontier: null,
						epoch: nextSummaryEpoch(summary),
					},
					now,
					revs[issued++],
				),
			);
		}

		/**
		 * Stale auto memories each get their own tombstone, the same rule as tail messages, because no
		 * parent tombstone stands in for them. Without a marker, other devices would revive memories they
		 * still know.
		 */
		if (rewind.staleMemoryIds.length > 0) {
			const byId = new Map(memories.map((memory) => [memory.id, memory]));
			const stale = rewind.staleMemoryIds
				.map((id) => byId.get(id))
				.filter((memory): memory is ChatMemory => memory !== undefined);
			await db.chatMemories.bulkPut(
				stale.map((memory) => markLocalDelete(memory, now, revs[issued++])),
			);
		}
	}

	return {
		async createRoom(input: CreateRoomInput): Promise<ChatRoom> {
			return db.transaction("rw", [db.rooms, db.syncState], async () => {
				const room = createRoomRecord(input, {
					id: newLocalId(),
					/*
					 * The routing-friendly key is a second random value, independent of the room id. It uses the
					 * same issuer but not the same value. Deriving it from the room id would make it another form
					 * of that id, so upstream could trace the same conversation.
					 */
					routingSessionId: newLocalId(),
					now: nowIso(),
					rev: await nextRev(db),
				});
				/**
				 * `add`, not `put`. A freshly generated UUID that already exists is a bug, not a collision;
				 * silently overwriting would erase someone else's room.
				 */
				await db.rooms.add(room);
				return room;
			});
		},

		getRoom: (id) => liveRoom(id),

		async listRooms(): Promise<ChatRoom[]> {
			// Walks the index in reverse; no in-memory sort is needed afterwards.
			const rows = await db.rooms.orderBy("updatedAt").reverse().toArray();
			return rows.filter(isLiveChatRecord);
		},

		async listRecentMessages(
			roomId: string,
			input?: { limit?: number; before?: string },
		): Promise<ChatMessage[]> {
			const limit = input?.limit ?? CHAT_MESSAGE_PAGE_SIZE;

			/**
			 * A deleted room returns an empty list. Its message rows still exist (the room tombstone stands
			 * in for the subtree, so messages get no per-row tombstones), but that is a storage detail. A
			 * deleted chat left visible would make users read the deletion as having failed.
			 */
			if (!(await liveRoom(roomId))) return [];

			/**
			 * The cursor's reference point is read from the message itself. If the caller passed a
			 * timestamp, it could diverge from the record (for example a display-formatted time), and a
			 * misaligned cursor silently skips messages.
			 */
			let upperBound: unknown[] = [roomId, MAX_COMPONENT];
			if (input?.before) {
				const cursor = await db.messages.get(input.before);
				if (!cursor || cursor.roomId !== roomId) return [];
				upperBound = [roomId, cursor.createdAt, cursor.id];
			}

			const page = await db.messages
				.where("[roomId+createdAt+id]")
				.between(
					// See the note on the constant above: a shorter array with the same prefix sorts before a
					// longer one.
					[roomId],
					upperBound,
					true,
					// The upper bound is exclusive: the cursor message itself is already on screen.
					false,
				)
				/**
				 * Walks from the newest message with the cursor and counts `limit` items after filtering out
				 * tombstones. Reading the whole room and slicing would load years of messages into memory.
				 * Defect note: an earlier version sliced before filtering. This result is also the generation
				 * history window (CHAT_HISTORY_LIMIT), so in a room where thirty lines were deleted with
				 * `delete from here`, cutting forty and then removing tombstones left only ten lines. The turns
				 * in between disappeared from both the summary and the raw text the model sees. The one-row
				 * `before` lookup (whether more exists) also answered 'none' when the immediately preceding row
				 * was a tombstone. Dexie's `filter` runs before `limit` and only counts rows that pass, so the
				 * exact count comes from the same order axis. This avoids adding `deletedAt` to the index,
				 * which would add write cost to the autosaved table.
				 */
				.reverse()
				.filter(isLiveChatRecord)
				.limit(limit)
				.toArray();

			// The store scans newest-first because that is cheaper, but the contract requires display order
			// (ascending).
			return page.reverse();
		},

		async listAllMessages(roomId: string): Promise<ChatMessage[]> {
			// Same reason as above: a deleted room returns empty. Search does not revive deleted
			// conversations either.
			if (!(await liveRoom(roomId))) return [];

			/*
			 * Walks the same composite index forward, once. The cursor is already ascending, so nothing
			 * needs reversing or sorting in memory. This is the only query without a `limit`, so its cost
			 * scales with room size. That is accepted because opening the search window is the only place
			 * that pays it. The message history uses page queries.
			 */
			const rows = await db.messages
				.where("[roomId+createdAt+id]")
				.between([roomId], [roomId, MAX_COMPONENT], true, false)
				.toArray();
			return rows.filter(isLiveChatRecord);
		},

		async appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
			const now = nowIso();
			/**
			 * One transaction. Splitting it could leave the state 'message saved but the room still at its
			 * months-old position' if the browser died in between. To the user, those were one action.
			 */
			return db.transaction(
				"rw",
				[db.messages, db.rooms, db.syncState],
				async () => {
					const room = await db.rooms.get(input.roomId);
					const live = room !== undefined && isLiveChatRecord(room);

					/**
					 * The message and the room receive different revisions (the message first). A shared value
					 * would leave a later merge unable to order them, and the two records sync as separate units,
					 * so each needs its own version.
					 */
					const [messageRev, roomRev] = await nextRevs(db, live ? 2 : 1);

					const created = createMessageRecord(input, {
						id: newLocalId(),
						now,
						rev: messageRev,
					});
					/**
					 * A message attached to a deleted room is saved already deleted. This path opens when a late
					 * stream end arrives after the user already cleared the room. If a live message were kept, the
					 * query (which checks the room first) would hide it, but the row would be an orphan that the
					 * next delete misses.
					 */
					const message =
						live || room === undefined
							? created
							: { ...created, deletedAt: room.deletedAt };
					await db.messages.add(message);
					if (room && live)
						await db.rooms.put(markLocalUpdate(room, now, roomRev));
					return message;
				},
			);
		},

		async updateMessage(id: string, patch: UpdateMessagePatch): Promise<void> {
			const now = nowIso();
			await db.transaction(
				"rw",
				[db.messages, db.rooms, db.syncState],
				async () => {
					const current = await db.messages.get(id);
					// Does not revive a message that disappeared or was deleted in the meantime; per the contract,
					// it is silently skipped.
					if (!current || !isLiveChatRecord(current)) return;
					await db.messages.put(
						markLocalUpdate({ ...current, ...patch }, now, await nextRev(db)),
					);
					await touchRoomInTx(current.roomId, now);
				},
			);
		},

		async extendMessage(
			id: string,
			continuation: AssistantContinuation,
		): Promise<void> {
			const now = nowIso();
			await db.transaction(
				"rw",
				[db.messages, db.rooms, db.syncState],
				async () => {
					const current = await db.messages.get(id);
					// Does not append to a message that disappeared or was deleted in the meantime; per the
					// contract, it is silently skipped.
					if (!current || !isLiveChatRecord(current)) return;
					/**
					 * The merge rule is one shared pure function; mobile SQLite calls the same one. It reads,
					 * derives and writes inside the transaction, so no other write can slip in between and be
					 * silently overwritten.
					 */
					const next = extendAssistantRecord(current, continuation);
					if (!next) return;
					await db.messages.put(markLocalUpdate(next, now, await nextRev(db)));
					await touchRoomInTx(current.roomId, now);
				},
			);
		},

		async touchRoom(roomId: string): Promise<void> {
			const now = nowIso();
			/**
			 * The callback must be an async function. Returning another async function's promise directly
			 * (`() => touchRoomInTx(...)`) means Dexie cannot count the follow-up operations as part of its
			 * transaction, and it commits before the first await (PrematureCommitError). This spot actually
			 * hit that symptom. It stayed hidden because no path touched a live room before: a deleted room
			 * is bounced on the first read.
			 */
			await db.transaction("rw", [db.rooms, db.syncState], async () => {
				await touchRoomInTx(roomId, now);
			});
		},

		async renameRoom(id: string, title: string): Promise<void> {
			/**
			 * Validation runs outside the transaction. A rule violation is a value that cannot be stored, so
			 * there is no reason to lock the database. Throwing inside a Dexie transaction callback would
			 * wrap the failure in a transaction abort, while the screen needs `ChatRoomTitleError`.
			 */
			const next = requireRoomTitle(title);
			const now = nowIso();
			await db.transaction("rw", [db.rooms, db.syncState], async () => {
				/**
				 * The room is re-read inside the transaction. Spreading a caller's captured room object (`{
				 * ...capturedRoom, title }`) would revert the activity time and revision set by another path in
				 * the meantime, which really happens when a rename runs during a generation. So no write in
				 * this store saves a record received from outside; it takes only the patch. If the room is
				 * deleted, do nothing. A late rename that overwrote the tombstone would revive the deleted
				 * chat.
				 */
				const room = await liveRoom(id);
				if (!room) return;
				/**
				 * One revision. Title, updatedAt and dirty change together as one edit. serverVersion stays,
				 * since local edits do not change the server-confirmed version. markLocalUpdate owns that rule.
				 */
				await db.rooms.put(
					markLocalUpdate({ ...room, title: next }, now, await nextRev(db)),
				);
			});
		},

		/**
		 * Chooses the role the user takes in this room; same shape as renameRoom. Validation outside the
		 * transaction, re-reading the room inside it, and a single revision all follow the same reasons
		 * as renameRoom (see its comments). Only the field differs.
		 */
		async setRoomPersona(
			roomId: string,
			persona: ChatPersonaSnapshot | null,
		): Promise<void> {
			/*
			 * Validation runs outside the transaction, for the same reason as renameRoom. The screen needs
			 * `ChatPersonaNameError` rather than a wrapped transaction abort.
			 */
			const next: ChatPersonaSnapshot | null = persona
				? {
						name: requirePersonaName(persona.name),
						description: requirePersonaDescription(persona.description),
					}
				: null;
			const now = nowIso();
			await db.transaction("rw", [db.rooms, db.syncState], async () => {
				const room = await liveRoom(roomId);
				if (!room) return;
				/*
				 * Applied through the shared function. With no override it does not create the key
				 * (applyRoomPersona), so rooms that predate this axis and rooms whose override was just cleared
				 * keep the same shape.
				 */
				await db.rooms.put(
					markLocalUpdate(applyRoomPersona(room, next), now, await nextRev(db)),
				);
			});
		},

		async setRoomNarration(
			roomId: string,
			narration: ChatNarrationSettings | null,
		): Promise<void> {
			const now = nowIso();
			await db.transaction("rw", [db.rooms, db.syncState], async () => {
				const room = await liveRoom(roomId);
				if (!room) return;
				/*
				 * The same rule as above: with no narration pack, the key is not created (applyRoomNarration).
				 * Rooms that predate this axis and rooms just turned off keep the same shape, so a two-device
				 * round trip is idempotent. There is nothing to validate, so no value is built outside the
				 * transaction. The type already narrows the vocabulary, and a stored old-version value is
				 * absorbed by the reader (readNarrationSettings).
				 */
				await db.rooms.put(
					markLocalUpdate(
						applyRoomNarration(room, narration),
						now,
						await nextRev(db),
					),
				);
			});
		},

		async setRoomIntensity(
			roomId: string,
			intensity: ChatIntensity | null,
		): Promise<void> {
			const now = nowIso();
			await db.transaction("rw", [db.rooms, db.syncState], async () => {
				const room = await liveRoom(roomId);
				if (!room) return;
				/*
				 * The same rule as the two above: at the default, the key is not created (applyRoomIntensity).
				 * The rating is not re-checked here. The port's comment explains why: the judgment would then
				 * live in three places, and a value the user picked during a brief auth interruption would be
				 * lost.
				 */
				await db.rooms.put(
					markLocalUpdate(
						applyRoomIntensity(room, intensity),
						now,
						await nextRev(db),
					),
				);
			});
		},

		async setRoomUserNote(
			roomId: string,
			userNote: string | null,
		): Promise<void> {
			/*
			 * The gate runs outside the transaction, unlike narration mode, for the same reason as memories.
			 * A value can be rejected (over the limit). If that judgment sat inside the transaction,
			 * throwing would roll back the open transaction, and Dexie would report the rollback as its own
			 * failure. The screen would get 'save failed' and lose what was wrong.
			 */
			const note = requireChatUserNote(userNote);
			const now = nowIso();
			await db.transaction("rw", [db.rooms, db.syncState], async () => {
				const room = await liveRoom(roomId);
				if (!room) return;
				/*
				 * The same rule as the two above: without a note, the key is not created (applyRoomUserNote).
				 * Rooms that predate this axis and rooms just cleared keep the same shape, so a two-device
				 * round trip is idempotent.
				 */
				await db.rooms.put(
					markLocalUpdate(
						applyRoomUserNote(room, note),
						now,
						await nextRev(db),
					),
				);
			});
		},

		/**
		 * Secures the room's routing-friendly key. It differs from renameRoom in two places. First, if a
		 * key already exists, nothing is written. This runs every turn, and writing would re-upload the
		 * room record each time for no change. Second, it does not advance `updatedAt`. This is an
		 * internal backfill of an old record, not conversation activity. Advancing it would move a
		 * months-old chat to the top for a reason the user never took, so markLocalUpdate (which advances
		 * activity time) is not used. The value is issued by the store (newLocalId): a random value
		 * unrelated to the room id, which callers cannot choose. Returns null for a deleted or missing
		 * room; it does not revive it.
		 */
		async ensureRoomRoutingSession(roomId: string): Promise<string | null> {
			return db.transaction("rw", [db.rooms, db.syncState], async () => {
				const room = await liveRoom(roomId);
				if (!room) return null;
				if (room.routingSessionId) return room.routingSessionId;
				const routingSessionId = newLocalId();
				await db.rooms.put({
					...room,
					routingSessionId,
					dirty: 1,
					rev: await nextRev(db),
				});
				return routingSessionId;
			});
		},

		async deleteRoom(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(
				"rw",
				[
					db.rooms,
					db.messages,
					db.chatMemories,
					db.chatSummaries,
					db.chatCharacters,
					db.syncState,
				],
				async () => {
					const room = await liveRoom(id);
					// A missing or already-deleted room is a no-op. Clearing the same room in two tabs really
					// happens.
					if (!room) return;

					await db.rooms.put(markLocalDelete(room, now, await nextRev(db)));

					/**
					 * Messages are deleted in the same transaction, without revisions. A room can hold thousands
					 * of messages, and a revision each would turn one deletion into thousands of pushes. Only the
					 * room tombstone goes over the wire; the receiving device runs the same cascade again. The
					 * rationale and the cost are documented on markCascadeDeleted in @rowcat/chat.
					 */
					const messages = await db.messages
						.where("roomId")
						.equals(id)
						.toArray();
					await db.messages.bulkPut(
						messages
							.filter(isLiveChatRecord)
							.map((message) => markCascadeDeleted(message, now)),
					);

					/**
					 * Memories are carried along in the same transaction, under the same rule. If left alone,
					 * those rows would appear in no query (queries check the room first) yet remain live records,
					 * so the next sync would upload memories with no parent. A receiving device gets them with the
					 * room tombstone but has no basis to delete them. The cascade runs on the side that applies
					 * the tombstone; it does not search for live children later (applyTombstone in
					 * local-sync/store.ts).
					 */
					const memories = await db.chatMemories
						.where("roomId")
						.equals(id)
						.toArray();
					await db.chatMemories.bulkPut(
						memories
							.filter(isLiveChatRecord)
							.map((memory) => markCascadeDeleted(memory, now)),
					);

					/**
					 * The summary is carried along by the same rule: it is the room's third child. There is one
					 * row per room, so bulkPut and revision savings look meaningless. The rule is applied
					 * symmetrically anyway. If only this record were revised, it would be pushed together with the
					 * room tombstone, and the receiver would process it once in the cascade and again on its own
					 * tombstone.
					 */
					const summary = await db.chatSummaries.get(summaryIdFor(id));
					if (summary && isLiveChatRecord(summary))
						await db.chatSummaries.put(markCascadeDeleted(summary, now));

					/**
					 * A character added to the room is the room's fourth child, and it is carried along by the
					 * same rule. This cascade was missing for a while. Those rows kept deletedAt null and dirty,
					 * appeared in no query, and the next sync re-uploaded the characters of a deleted room as live
					 * records. This list must match the receiving side's cascade (applyTombstone).
					 */
					const characters = await db.chatCharacters
						.where("roomId")
						.equals(id)
						.toArray();
					await db.chatCharacters.bulkPut(
						characters
							.filter(isLiveChatRecord)
							.map((character) => markCascadeDeleted(character, now)),
					);
				},
			);
		},

		/*
		 * Memory section. Memories diverge from rooms and messages at one point: editing a memory does
		 * not advance the room's activity time. That value is the conversation's activity axis, and list
		 * ordering reads it. Memory curation is not conversation: editing one memory of an old room would
		 * bring that room to the top, and the user would see an untouched chat as recent. Memories have
		 * their own revision as an independent sync unit, so there is no reason to touch the parent.
		 */

		async listMemories(roomId: string): Promise<ChatMemory[]> {
			/**
			 * A memory of a deleted room counts as absent. The cascade has already tombstoned each row, so
			 * the filter below would be enough alone. Checking the room first is more exact: it closes the
			 * path where a row leaks to the screen if the cascade missed one.
			 */
			if (!(await liveRoom(roomId))) return [];
			const rows = await db.chatMemories
				.where("roomId")
				.equals(roomId)
				.toArray();
			// The store decides the order (a port contract), so the screen and context assembly see the same
			// order.
			return sortMemories(rows.filter(isLiveChatRecord));
		},

		async createMemory(input: CreateMemoryInput): Promise<ChatMemory> {
			/**
			 * Validation runs outside the transaction, for the same reason as renameRoom: the error type
			 * must survive. The screen needs `ChatMemoryContentError`.
			 */
			const content = requireMemoryContent(input.content);
			const now = nowIso();
			return db.transaction(
				"rw",
				[db.chatMemories, db.rooms, db.syncState],
				async () => {
					/**
					 * Not created for a missing or deleted room. Another tab may have a memory window open for a
					 * room that was just deleted, and the user may click add there. Creating the row would produce
					 * an orphan that appears on no screen and is pushed in the next sync. Reviving the room record
					 * would be worse: the deleted chat would come back.
					 */
					const room = await liveRoom(input.roomId);
					if (!room) throw new ChatRoomMissingError(input.roomId);

					/**
					 * The count cap is also enforced by the store. Hiding the button does not stop two tabs from
					 * adding at the same time. The counted set is live memories, so it must use the same predicate
					 * as the screen list.
					 */
					const live = (
						await db.chatMemories.where("roomId").equals(input.roomId).toArray()
					).filter(isLiveChatRecord);
					if (live.length >= CHAT_MEMORY_MAX_PER_ROOM)
						throw new ChatMemoryLimitError();

					const memory = createMemoryRecord(
						{ ...input, content },
						{ id: newLocalId(), now, rev: await nextRev(db) },
					);
					await db.chatMemories.add(memory);
					return memory;
				},
			);
		},

		async updateMemory(id: string, patch: UpdateMemoryPatch): Promise<void> {
			// Validates content only when it is provided. A pin toggle does not touch content.
			const content =
				patch.content === undefined
					? undefined
					: requireMemoryContent(patch.content);
			const now = nowIso();
			await db.transaction("rw", [db.chatMemories, db.syncState], async () => {
				const current = await db.chatMemories.get(id);
				/**
				 * A missing or already-deleted memory is silently skipped. If the room was deleted, its
				 * memories are also tombstoned by the cascade and hit the same condition. There is no
				 * structural path to revive a deleted room through a memory edit.
				 */
				if (!current || !isLiveChatRecord(current)) return;
				const source = mergeMemorySource(current.source, patch.source);
				const next: ChatMemory = {
					...current,
					...(content !== undefined ? { content } : {}),
					...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
					source,
					/**
					 * Promotion clears the origin time. That value means 'which span of the conversation this fact
					 * came from'. A sentence a person rewrote is no longer derived from that span. Keeping it
					 * would let a history rewrite see that time and delete the user's text.
					 */
					originAt: source === "auto" ? current.originAt : null,
				};
				// One edit, one revision. serverVersion is unchanged, as with every local edit (see
				// markLocalUpdate).
				await db.chatMemories.put(
					markLocalUpdate(next, now, await nextRev(db)),
				);
			});
		},

		async listCharacters(roomId: string): Promise<ChatCharacter[]> {
			/**
			 * A character of a deleted room counts as absent, for the same reason as the memory list: the
			 * room is checked first.
			 */
			if (!(await liveRoom(roomId))) return [];
			const rows = await db.chatCharacters
				.where("roomId")
				.equals(roomId)
				.toArray();
			// The store decides the order, so the screen and prompt assembly see the same order.
			return sortCharacters(rows.filter(isLiveChatRecord));
		},

		async createCharacter(input: CreateCharacterInput): Promise<ChatCharacter> {
			/**
			 * Validation runs outside the transaction, for the same reason as memories (the error type is
			 * preserved).
			 */
			const name = requireCharacterName(input.name);
			const prompt = requireCharacterPrompt(input.prompt ?? "");
			const now = nowIso();
			return db.transaction(
				"rw",
				[db.chatCharacters, db.rooms, db.syncState],
				async () => {
					/**
					 * Not created for a missing or deleted room. Another tab may have a character settings window
					 * open for a just-deleted room, and creating a row there would produce an orphan that appears
					 * nowhere and is pushed in the next sync.
					 */
					const room = await liveRoom(input.roomId);
					if (!room) throw new ChatRoomMissingError(input.roomId);

					/**
					 * The count cap is also counted by the store. Hiding the button does not stop simultaneous
					 * adds from two tabs. The counted set is live characters, so it must use the same predicate as
					 * the screen list.
					 */
					const live = (
						await db.chatCharacters
							.where("roomId")
							.equals(input.roomId)
							.toArray()
					).filter(isLiveChatRecord);
					if (live.length >= CHAT_CHARACTER_MAX_PER_ROOM)
						throw new ChatCharacterLimitError();

					const character = createCharacterRecord(
						{ roomId: input.roomId, name, prompt },
						{ id: newLocalId(), now, rev: await nextRev(db) },
					);
					await db.chatCharacters.add(character);
					return character;
				},
			);
		},

		async updateCharacter(
			id: string,
			patch: UpdateCharacterPatch,
		): Promise<void> {
			/**
			 * Only the provided fields are validated, so an edit that changes only the name does not hit the
			 * prompt rule.
			 */
			const name =
				patch.name === undefined ? undefined : requireCharacterName(patch.name);
			const prompt =
				patch.prompt === undefined
					? undefined
					: requireCharacterPrompt(patch.prompt);
			const now = nowIso();
			await db.transaction(
				"rw",
				[db.chatCharacters, db.syncState],
				async () => {
					const current = await db.chatCharacters.get(id);
					/**
					 * A missing or already-deleted character is silently skipped. If the room was deleted, its
					 * characters are tombstoned by the cascade and hit the same condition. There is no structural
					 * path to revive a deleted room through a character edit. The room's activity time is not
					 * advanced, the same judgment as memory edits. Rewording an old room's character description
					 * must not move that chat to the top, so this transaction does not include db.rooms.
					 */
					if (!current || !isLiveChatRecord(current)) return;
					const next: ChatCharacter = {
						...current,
						...(name !== undefined ? { name } : {}),
						...(prompt !== undefined ? { prompt } : {}),
					};
					await db.chatCharacters.put(
						markLocalUpdate(next, now, await nextRev(db)),
					);
				},
			);
		},

		async deleteCharacter(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(
				"rw",
				[db.chatCharacters, db.syncState],
				async () => {
					const current = await db.chatCharacters.get(id);
					// Idempotent: clearing the same character in two tabs really happens.
					if (!current || !isLiveChatRecord(current)) return;
					/**
					 * Soft delete. Removing the row would leave no way to tell other devices about the deletion,
					 * and they would re-upload the character they still hold on their next sync.
					 */
					await db.chatCharacters.put(
						markLocalDelete(current, now, await nextRev(db)),
					);
				},
			);
		},

		async deleteMemory(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction("rw", [db.chatMemories, db.syncState], async () => {
				const current = await db.chatMemories.get(id);
				// Idempotent: clearing the same memory in two tabs really happens.
				if (!current || !isLiveChatRecord(current)) return;
				await db.chatMemories.put(
					markLocalDelete(current, now, await nextRev(db)),
				);
			});
		},

		async deleteMessage(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(
				"rw",
				[
					db.messages,
					db.rooms,
					db.chatMemories,
					db.chatSummaries,
					db.syncState,
				],
				async () => {
					const current = await db.messages.get(id);
					if (!current || !isLiveChatRecord(current)) return;
					await db.messages.put(
						markLocalDelete(current, now, await nextRev(db)),
					);
					/**
					 * A single-message delete also goes through the rewind. This operation does not touch the
					 * tail, but the summary may already have read the message being deleted. The summary would
					 * then narrate an utterance that no longer exists, and that fact is silent if only this path
					 * skips it.
					 */
					await rewindMaintenanceInTx(current.roomId, current.createdAt, now);
					/**
					 * Deleting a message also advances the room's activity time, following the same rule as add
					 * and update.
					 */
					await touchRoomInTx(current.roomId, now);
				},
			);
		},

		async editUserMessage(
			id: string,
			content: string,
		): Promise<ChatTailRewrite> {
			/**
			 * Validation runs outside the transaction, for the same reason as the rename. The screen needs
			 * `ChatMessageContentError`.
			 */
			const next = requireMessageContent(content);
			const target = await db.messages.get(id);
			// A missing or already-deleted message is not an error; nothing happened.
			if (!target || !isLiveChatRecord(target)) return NOT_APPLIED;
			/**
			 * The role is also checked from outside. Roles do not change after creation, so there is no
			 * reason to re-read inside the transaction. This failure is a caller bug, not user input, so it
			 * should surface as is (the screen does not draw edit controls on assistant messages).
			 */
			requireEditableRole(target.role, "user");
			return rewriteTail(id, "after", next);
		},

		/**
		 * Assistant edit: the same transaction and tail mode as the user edit. The only difference is the
		 * role gate, which is why this method exists separately (see the ChatStore header). The write
		 * rules are not repeated here, so the two edits cannot diverge on revision issuing, tombstones,
		 * room activity time or maintenance rewind.
		 */
		async editAssistantMessage(
			id: string,
			content: string,
		): Promise<ChatTailRewrite> {
			const next = requireMessageContent(content);
			const target = await db.messages.get(id);
			if (!target || !isLiveChatRecord(target)) return NOT_APPLIED;
			requireEditableRole(target.role, "assistant");
			return rewriteTail(id, "after", next);
		},

		deleteFromMessage: (id: string): Promise<ChatTailRewrite> =>
			rewriteTail(id, "from", null),

		async getSummary(roomId: string): Promise<ChatSummary | null> {
			/** Nothing from a deleted room is visible, the same rule as the other queries. */
			if (!(await liveRoom(roomId))) return null;
			const stored = await db.chatSummaries.get(summaryIdFor(roomId));
			return stored && isLiveChatRecord(stored) ? stored : null;
		},

		async applyMemoryMaintenance(
			plan: ChatMaintenancePlan & { roomId: string },
		): Promise<boolean> {
			const now = nowIso();
			return db.transaction(
				"rw",
				[db.rooms, db.chatMemories, db.chatSummaries, db.syncState],
				async () => {
					/** Maintenance does not revive a deleted room. */
					const room = await liveRoom(plan.roomId);
					if (!room) return false;

					const stored = await db.chatSummaries.get(summaryIdFor(plan.roomId));
					const summary = stored && isLiveChatRecord(stored) ? stored : null;

					/**
					 * Optimistic concurrency, inside the transaction. Checking outside and writing inside leaves a
					 * window, and history rewrites or another device's pull can slip into it. The plan was built
					 * from a snapshot seconds ago. If the generation or frontier has moved, the plan's values
					 * refer to a conversation that no longer exists.
					 */
					if (!maintenanceStillApplies(plan, summary)) return false;

					const live = (
						await db.chatMemories.where("roomId").equals(plan.roomId).toArray()
					).filter(isLiveChatRecord);
					const byId = new Map(live.map((memory) => [memory.id, memory]));

					/**
					 * Revisions are issued all at once. Re-reading the clock per operation would record one
					 * maintenance run as spanning several milliseconds, and sharing one value would leave merges
					 * unable to order them. One extra revision is needed for the summary row.
					 */
					const revs = await nextRevs(db, plan.operations.length + 1);
					let issued = 0;

					for (const operation of plan.operations) {
						if (operation.type === "add") {
							await db.chatMemories.add(
								createMemoryRecord(
									{
										roomId: plan.roomId,
										content: operation.content,
										source: "auto",
										originAt: plan.through.createdAt,
									},
									{ id: newLocalId(), now, rev: revs[issued++] },
								),
							);
							continue;
						}

						const target = byId.get(operation.memoryId);
						/**
						 * The store does not trust the plan. The pure plan already filters out manual memories
						 * (planMemoryMaintenance), but the user may have edited an auto memory and promoted it in the
						 * meantime (promoteMemoryPatch). Then this operation would delete or overwrite a sentence a
						 * person just wrote. If the target is gone or has become manual, only that operation is
						 * skipped. Rolling back the whole plan would discard the batch's progress, and the same range
						 * would be reprocessed forever.
						 */
						if (!target || !isAutoMemory(target)) {
							issued++;
							continue;
						}

						await db.chatMemories.put(
							operation.type === "remove"
								? markLocalDelete(target, now, revs[issued++])
								: markLocalUpdate(
										{
											...target,
											content: operation.content,
											originAt: plan.through.createdAt,
										},
										now,
										revs[issued++],
									),
						);
					}

					const base =
						summary ??
						createSummaryRecord(
							{ roomId: plan.roomId, summary: "", frontier: null },
							{ now, rev: revs[issued] },
						);
					await db.chatSummaries.put(
						markLocalUpdate(
							{
								...base,
								summary: plan.summary,
								frontier: plan.through,
							},
							now,
							revs[issued++],
						),
					);

					/**
					 * Does not advance the room's activity time. The same judgment as memory edits, with a
					 * stronger reason: maintenance is not something the user did. Advancing it would let a
					 * background task move the conversation to the top, and the user would see a chat they did not
					 * touch as recent.
					 */
					return true;
				},
			);
		},

		/*
		 * Persona library section. It differs from memories and summaries in one way, which is the whole
		 * point of this section: it does not touch the room at all. No operation takes a room id, and
		 * touchRoomInTx is never called. The library is an account asset, not a child of a conversation,
		 * so deleting a persona never reaches a conversation (a room holds a copy of the value).
		 */

		async listPersonas(): Promise<ChatPersona[]> {
			/*
			 * Scans the index in reverse, with no in-memory sort. The authority on order is sortPersonas:
			 * the rule that breaks ties between two rows with the same timestamp by id lives there, and the
			 * index alone does not guarantee that second axis.
			 */
			const rows = await db.chatPersonas
				.orderBy("updatedAt")
				.reverse()
				.toArray();
			return sortPersonas(rows.filter(isLiveChatRecord));
		},

		async getPersona(id: string): Promise<ChatPersona | null> {
			const persona = await db.chatPersonas.get(id);
			return persona && isLiveChatRecord(persona) ? persona : null;
		},

		async createPersona(input: CreatePersonaInput): Promise<ChatPersona> {
			return db.transaction("rw", [db.chatPersonas, db.syncState], async () => {
				const persona = createPersonaRecord(input, {
					id: newLocalId(),
					now: nowIso(),
					rev: await nextRev(db),
				});
				/*
				 * `add`, not `put`, as in createRoom. A newly generated UUID that already exists is a bug, and
				 * silently overwriting would erase someone else's persona.
				 */
				await db.chatPersonas.add(persona);
				return persona;
			});
		},

		async updatePersona(id: string, patch: UpdatePersonaPatch): Promise<void> {
			/*
			 * Validation runs outside the transaction, for the same reason as setRoomPersona (error types
			 * are preserved).
			 */
			const next: UpdatePersonaPatch = {
				...(patch.name !== undefined
					? { name: requirePersonaName(patch.name) }
					: {}),
				...(patch.description !== undefined
					? { description: requirePersonaDescription(patch.description) }
					: {}),
			};
			const now = nowIso();
			await db.transaction("rw", [db.chatPersonas, db.syncState], async () => {
				const persona = await db.chatPersonas.get(id);
				// A missing or already-deleted persona is a no-op (idempotent).
				if (!persona || !isLiveChatRecord(persona)) return;
				await db.chatPersonas.put(
					markLocalUpdate({ ...persona, ...next }, now, await nextRev(db)),
				);
			});
		},

		async deletePersona(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction("rw", [db.chatPersonas, db.syncState], async () => {
				const persona = await db.chatPersonas.get(id);
				if (!persona || !isLiveChatRecord(persona)) return;
				/*
				 * The room table is not part of this transaction. That absence is this operation's contract:
				 * since no room is locked, no path can change rooms from here. A conversation already running
				 * on this persona keeps its own copy and continues with it.
				 */
				await db.chatPersonas.put(
					markLocalDelete(persona, now, await nextRev(db)),
				);
			});
		},
	};
}
