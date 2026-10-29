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
import { newLocalId, nowIso } from "./clock.ts";
import { nextRev, nextRevs } from "./hlc.ts";
import type { MobileDatabase, SqlRunner } from "./sqlite.ts";
import {
	chatCharacterTable,
	chatMemoryTable,
	chatMessageTable,
	chatPersonaTable,
	chatRoomTable,
	chatSummaryTable,
	type SqlRow,
} from "./tables.ts";

/**
 * `ChatStore` on SQLite, with the same contract, order and transaction boundaries as the web's
 * Dexie implementation.
 *
 * Both adapters must agree because of sync: if a browser and a phone editing the same room see
 * "what gets written together" differently, the divergence does not show on screen. It shows up at
 * the **next sync**, and what disappears then is the user's conversation.
 *
 * Nothing new is decided here. The rules live in `@rowcat/chat`'s pure functions
 * (`createRoomRecord`, `markLocalUpdate`, `selectChatTail`, `sortMemories`). This file calls them
 * in the same order and commits the results in one transaction.
 *
 * Only the syntax differs from Dexie:
 *
 * ```text
 * Dexie   db.transaction("rw", [tables], cb)   declares the table list up front
 * SQLite  db.transaction(cb)                   the connection is the scope
 * ```
 *
 * The SQLite form looks looser but is stronger: Dexie rejects a touch outside its declared tables,
 * whereas here the scope is the whole database. That is why `applyPull` can write conversations,
 * authoring and the cursor in one transaction without extra setup (`sync-store.ts`).
 */

const liveRows = <T extends { deletedAt: string | null }>(
	rows: SqlRow[],
	map: (row: SqlRow) => T,
): T[] => rows.map(map).filter(isLiveChatRecord);

export function createChatStore(db: MobileDatabase): ChatStore {
	const readRoom = async (
		tx: SqlRunner,
		id: string,
	): Promise<ChatRoom | null> => {
		const row = await tx.first<SqlRow>("SELECT * FROM chat_room WHERE id = ?", [
			id,
		]);
		return row ? chatRoomTable.fromRow(row) : null;
	};

	const liveRoom = async (
		tx: SqlRunner,
		id: string,
	): Promise<ChatRoom | null> => {
		const room = await readRoom(tx, id);
		return room && isLiveChatRecord(room) ? room : null;
	};

	const readMessage = async (
		tx: SqlRunner,
		id: string,
	): Promise<ChatMessage | null> => {
		const row = await tx.first<SqlRow>(
			"SELECT * FROM chat_message WHERE id = ?",
			[id],
		);
		return row ? chatMessageTable.fromRow(row) : null;
	};

	/** Bumps only the room's activity time. Must run inside an already-open transaction. */
	const touchRoomInTx = async (
		tx: SqlRunner,
		roomId: string,
		now: string,
	): Promise<void> => {
		const room = await liveRoom(tx, roomId);
		if (!room) return;
		await chatRoomTable.upsert(
			tx,
			markLocalUpdate(room, now, await nextRev(tx)),
		);
	};

	const NOT_APPLIED: ChatTailRewrite = { applied: false, removed: 0 };

	/**
	 * Tail rewrite: one operation shared by edit, regenerate and delete-from-here.
	 *
	 * Anchor check, tail selection, (for edit) anchor update, tail tombstones and the room's activity
	 * time all run in one transaction. Splitting them would commit "the edited utterance plus an old
	 * response not produced from it", which the screen would draw as a confirmed conversation.
	 *
	 * Each tail tombstone gets its own revision. Room deletion's cascade differs here: one room
	 * tombstone stands in for the whole subtree there, but no parent tombstone exists here. Without a
	 * marker per message, another device would revive the messages it still holds.
	 */
	const rewriteTail = (
		anchorId: string,
		mode: ChatTailMode,
		content: string | null,
	): Promise<ChatTailRewrite> => {
		const now = nowIso();
		return db.transaction(async (tx) => {
			const anchor = await readMessage(tx, anchorId);
			if (!anchor || !isLiveChatRecord(anchor)) return NOT_APPLIED;
			const room = await liveRoom(tx, anchor.roomId);
			if (!room) return NOT_APPLIED;

			const rows = await tx.all<SqlRow>(
				`SELECT * FROM chat_message
				 WHERE room_id = ?
				   AND (created_at > ? OR (created_at = ? AND id >= ?))
				 ORDER BY created_at ASC, id ASC`,
				[anchor.roomId, anchor.createdAt, anchor.createdAt, anchor.id],
			);
			const tail = selectChatTail(
				liveRows(rows, chatMessageTable.fromRow),
				anchorId,
				mode,
			);
			if (!tail) return NOT_APPLIED;

			const revs = await nextRevs(tx, tail.length + (content === null ? 1 : 2));
			let issued = 0;
			if (content !== null)
				await chatMessageTable.upsert(
					tx,
					markLocalUpdate({ ...anchor, content }, now, revs[issued++]),
				);
			for (const message of tail)
				await chatMessageTable.upsert(
					tx,
					markLocalDelete(message, now, revs[issued++]),
				);
			await chatRoomTable.upsert(
				tx,
				markLocalUpdate(room, now, revs[issued++]),
			);

			/**
			 * The cutoff is the first tail message's timestamp. That value states "everything from here on
			 * is gone", since the tail is always one contiguous span.
			 */
			const cutoff = tail[0]?.createdAt;
			if (cutoff) await rewindMaintenanceInTx(tx, anchor.roomId, cutoff, now);

			return { applied: true, removed: tail.length };
		});
	};

	/**
	 * Rewinds maintenance state after history was cut, inside an already-open transaction.
	 *
	 * The rules live in the pure `planMaintenanceRewind`; this function only writes its decision to
	 * records. The web function of the same name does the same job and only the SQL differs. Two
	 * copies of the rule would let one edit delete different things on two devices.
	 *
	 * If nothing changes, nothing is written. Ordinary edits and regenerations happen inside the
	 * recent verbatim window and usually end here. Issuing a useless revision on this path would turn
	 * a single edit into a push of the summary record.
	 */
	const rewindMaintenanceInTx = async (
		tx: SqlRunner,
		roomId: string,
		cutoffCreatedAt: string,
		now: string,
	): Promise<void> => {
		const summaryRow = await tx.first<SqlRow>(
			"SELECT * FROM chat_summary WHERE id = ? AND deleted_at IS NULL",
			[summaryIdFor(roomId)],
		);
		const summary = summaryRow ? chatSummaryTable.fromRow(summaryRow) : null;
		const memories = (
			await tx.all<SqlRow>(
				"SELECT * FROM chat_memory WHERE room_id = ? AND deleted_at IS NULL",
				[roomId],
			)
		).map(chatMemoryTable.fromRow);

		const rewind = planMaintenanceRewind({
			summary,
			memories,
			cutoffCreatedAt,
		});
		if (!rewindChangesAnything(rewind)) return;

		const revs = await nextRevs(
			tx,
			rewind.staleMemoryIds.length + (rewind.resetSummary ? 1 : 0),
		);
		let issued = 0;

		if (rewind.resetSummary) {
			/**
			 * The summary is discarded but its record is kept. Deleting the row would leave no way to tell
			 * other devices (a tombstone is needed), and it would remove the slot where the epoch goes up.
			 * That integer is the only thing that lets the merge prefer the rewind (see
			 * `ChatSummary.epoch`).
			 */
			const base =
				summary ??
				createSummaryRecord(
					{ roomId, summary: "", frontier: null },
					{ now, rev: revs[issued] },
				);
			await chatSummaryTable.upsert(
				tx,
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
		 * Stale auto memories each get their own tombstone, the same rule as tail messages. No parent
		 * tombstone stands in for them, so without a marker another device would still consider its copy
		 * live and re-upload it.
		 */
		const byId = new Map(memories.map((memory) => [memory.id, memory]));
		for (const id of rewind.staleMemoryIds) {
			const memory = byId.get(id);
			if (!memory) continue;
			await chatMemoryTable.upsert(
				tx,
				markLocalDelete(memory, now, revs[issued++]),
			);
		}
	};

	return {
		createRoom: (input: CreateRoomInput): Promise<ChatRoom> =>
			db.transaction(async (tx) => {
				const room = createRoomRecord(input, {
					id: newLocalId(),
					/*
					 * The routing key is a second random value, independent of the room id. It uses the same
					 * issuer but not the same value. Deriving it from the room id would make it another
					 * representation of that id, and upstream could then link the same conversation back together.
					 */
					routingSessionId: newLocalId(),
					now: nowIso(),
					rev: await nextRev(tx),
				});
				await chatRoomTable.upsert(tx, room);
				return room;
			}),

		getRoom: (id) => liveRoom(db, id),

		/**
		 * Sorted by recent activity. Sorting in SQL looks different from the web, but the axis is the
		 * same: `(updatedAt desc, id desc)` exactly as `compareRoomsByRecency` defines it. Stating the
		 * tie-break explicitly is more honest than relying on index order.
		 */
		async listRooms(): Promise<ChatRoom[]> {
			const rows = await db.all<SqlRow>(
				`SELECT * FROM chat_room WHERE deleted_at IS NULL
				 ORDER BY updated_at DESC, id DESC`,
			);
			return rows.map(chatRoomTable.fromRow);
		},

		/**
		 * Returns the most recent page, **in ascending order.**
		 *
		 * The store is cheapest to scan newest-first (reverse index + LIMIT), but exporting that order
		 * would make every caller reverse it. `before` is a cursor for messages strictly older than that
		 * one, with the boundary excluded. A `(createdAt, id)` cursor means paging further back never
		 * duplicates or drops a message.
		 *
		 * Tombstones are filtered **before** the cut (`deleted_at IS NULL`, same as web). ⚠️ This was
		 * once filtered after cutting, which was a defect. This result is also the generation history
		 * window. In a room where "delete from here" removed thirty lines, cutting forty and then
		 * dropping tombstones left only ten. Auto-maintenance keeps the forty most recent live messages,
		 * so the turns in between vanished from both the summary and the verbatim history. The screen's
		 * `hasOlder = length >= limit` also became false, leaving no way to load older messages.
		 */
		async listRecentMessages(
			roomId: string,
			input?: { limit?: number; before?: string },
		): Promise<ChatMessage[]> {
			const limit = input?.limit ?? CHAT_MESSAGE_PAGE_SIZE;
			if (!(await liveRoom(db, roomId))) return [];
			let rows: SqlRow[];
			if (input?.before) {
				const cursor = await readMessage(db, input.before);
				if (!cursor || cursor.roomId !== roomId) return [];
				rows = await db.all<SqlRow>(
					`SELECT * FROM chat_message
					 WHERE room_id = ? AND deleted_at IS NULL
					   AND (created_at < ? OR (created_at = ? AND id < ?))
					 ORDER BY created_at DESC, id DESC
					 LIMIT ?`,
					[roomId, cursor.createdAt, cursor.createdAt, cursor.id, limit],
				);
			} else {
				rows = await db.all<SqlRow>(
					`SELECT * FROM chat_message WHERE room_id = ? AND deleted_at IS NULL
					 ORDER BY created_at DESC, id DESC LIMIT ?`,
					[roomId, limit],
				);
			}
			return liveRows(rows, chatMessageTable.fromRow).reverse();
		},

		async listAllMessages(roomId: string): Promise<ChatMessage[]> {
			if (!(await liveRoom(db, roomId))) return [];
			const rows = await db.all<SqlRow>(
				`SELECT * FROM chat_message WHERE room_id = ?
				 ORDER BY created_at ASC, id ASC`,
				[roomId],
			);
			return liveRows(rows, chatMessageTable.fromRow);
		},

		/**
		 * Appends a message and bumps the room's activity time **in the same transaction.**
		 *
		 * A message arriving late for a deleted room inherits the room's deletion time instead of
		 * reviving it. Another tab sometimes deletes the room before the stream finishes. If only the
		 * message stayed live, the next sync would push it as an orphan.
		 */
		appendMessage: (input: AppendMessageInput): Promise<ChatMessage> => {
			const now = nowIso();
			return db.transaction(async (tx) => {
				const room = await readRoom(tx, input.roomId);
				const live = room !== null && isLiveChatRecord(room);
				const [messageRev, roomRev] = await nextRevs(tx, live ? 2 : 1);
				const created = createMessageRecord(input, {
					id: newLocalId(),
					now,
					rev: messageRev,
				});
				const message =
					live || room === null
						? created
						: { ...created, deletedAt: room.deletedAt };
				await chatMessageTable.upsert(tx, message);
				if (room && live)
					await chatRoomTable.upsert(tx, markLocalUpdate(room, now, roomRev));
				return message;
			});
		},

		async updateMessage(id: string, patch: UpdateMessagePatch): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const current = await readMessage(tx, id);
				if (!current || !isLiveChatRecord(current)) return;
				await chatMessageTable.upsert(
					tx,
					markLocalUpdate({ ...current, ...patch }, now, await nextRev(tx)),
				);
				await touchRoomInTx(tx, current.roomId, now);
			});
		},

		async extendMessage(
			id: string,
			continuation: AssistantContinuation,
		): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const current = await readMessage(tx, id);
				// Does not append to a message that vanished or was deleted in the meantime (silently skipped,
				// per the contract).
				if (!current || !isLiveChatRecord(current)) return;
				/**
				 * The merge rule is one shared pure function. The web's Dexie calls the same one. Read, derive
				 * and write all happen **inside** the transaction, so no other write can slip in between and be
				 * silently overwritten.
				 */
				const next = extendAssistantRecord(current, continuation);
				if (!next) return;
				await chatMessageTable.upsert(
					tx,
					markLocalUpdate(next, now, await nextRev(tx)),
				);
				await touchRoomInTx(tx, current.roomId, now);
			});
		},

		async touchRoom(roomId: string): Promise<void> {
			const now = nowIso();
			await db.transaction((tx) => touchRoomInTx(tx, roomId, now));
		},

		async renameRoom(id: string, title: string): Promise<void> {
			/**
			 * The store re-checks the title rule. Skipping it because the screen already validates would
			 * fork the rule the day web and mobile each have a screen. A value that breaks the rule would
			 * travel through sync to other devices.
			 */
			const next = requireRoomTitle(title);
			const now = nowIso();
			await db.transaction(async (tx) => {
				const room = await liveRoom(tx, id);
				if (!room) return;
				await chatRoomTable.upsert(
					tx,
					markLocalUpdate({ ...room, title: next }, now, await nextRev(tx)),
				);
			});
		},

		/**
		 * Sets the persona the user plays in this room. It has the same shape as `renameRoom`.
		 *
		 * It re-validates the value, re-reads the room inside the transaction, and issues one revision,
		 * for the same reasons. Only the field differs.
		 *
		 * **Never rewrites a speaker stored in messages.** This transaction never touches `chat_message`,
		 * and that is the contract. Turns already exchanged keep the role they had then.
		 */
		async setRoomPersona(
			roomId: string,
			persona: ChatPersonaSnapshot | null,
		): Promise<void> {
			const next: ChatPersonaSnapshot | null = persona
				? {
						name: requirePersonaName(persona.name),
						description: requirePersonaDescription(persona.description),
					}
				: null;
			const now = nowIso();
			await db.transaction(async (tx) => {
				const room = await liveRoom(tx, roomId);
				if (!room) return;
				/*
				 * Applying it is delegated to the shared function. Without an override it does **not create the
				 * key at all** (`applyRoomPersona`). The web calls the same function, so both apps' records
				 * share one shape, and two-device round trips converge on the same result.
				 */
				await chatRoomTable.upsert(
					tx,
					markLocalUpdate(applyRoomPersona(room, next), now, await nextRev(tx)),
				);
			});
		},

		async setRoomNarration(
			roomId: string,
			narration: ChatNarrationSettings | null,
		): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const room = await liveRoom(tx, roomId);
				if (!room) return;
				/*
				 * Calls the **same function** as web (`applyRoomNarration`). Without a pack the key is not
				 * created at all, so both apps' records share one shape and two-device round trips converge on
				 * the same result.
				 */
				await chatRoomTable.upsert(
					tx,
					markLocalUpdate(
						applyRoomNarration(room, narration),
						now,
						await nextRev(tx),
					),
				);
			});
		},

		async setRoomIntensity(
			roomId: string,
			intensity: ChatIntensity | null,
		): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const room = await liveRoom(tx, roomId);
				if (!room) return;
				/*
				 * Calls the **same function** as web (`applyRoomIntensity`). The default creates no key at all.
				 * Not re-checking the rating here is also the same as web (see the port comment).
				 */
				await chatRoomTable.upsert(
					tx,
					markLocalUpdate(
						applyRoomIntensity(room, intensity),
						now,
						await nextRev(tx),
					),
				);
			});
		},

		async setRoomUserNote(
			roomId: string,
			userNote: string | null,
		): Promise<void> {
			/*
			 * The gate sits **outside the transaction**, as on web, for the same reason. Some values are
			 * rejected (over the limit). If that check ran inside the transaction, throwing would roll back
			 * the open transaction, and the screen would receive only "save failed" and lose which part was
			 * wrong.
			 */
			const note = requireChatUserNote(userNote);
			const now = nowIso();
			await db.transaction(async (tx) => {
				const room = await liveRoom(tx, roomId);
				if (!room) return;
				/*
				 * Calls the **same function** as web (`applyRoomUserNote`). Without a note the key is not
				 * created at all, so both apps' records share one shape and two-device round trips converge on
				 * the same result.
				 */
				await chatRoomTable.upsert(
					tx,
					markLocalUpdate(
						applyRoomUserNote(room, note),
						now,
						await nextRev(tx),
					),
				);
			});
		},

		/**
		 * Secures this room's routing key. It follows the **same rule** as the web function of the same
		 * name.
		 *
		 * There are two intentional differences. **If a key already exists, nothing is written.** This
		 * runs every turn, so writing would re-upload the room record each time. And **`updatedAt` is not
		 * bumped.** This fills in an older record as internal housekeeping, not conversation activity.
		 * Bumping it would float a months-old conversation to the top of the list for a reason the user
		 * never chose. That is why `markLocalUpdate` is not used, since its contract bumps the activity
		 * time.
		 *
		 * Returns `null` for a deleted or missing room. It does not revive it.
		 */
		async ensureRoomRoutingSession(roomId: string): Promise<string | null> {
			return db.transaction(async (tx) => {
				const room = await liveRoom(tx, roomId);
				if (!room) return null;
				if (room.routingSessionId) return room.routingSessionId;
				const routingSessionId = newLocalId();
				await chatRoomTable.upsert(tx, {
					...room,
					routingSessionId,
					dirty: 1,
					rev: await nextRev(tx),
				});
				return routingSessionId;
			});
		},

		/**
		 * Soft-deletes a room, **together with its four children (messages, memories, summary,
		 * characters) in the same transaction.**
		 *
		 * Children get only `deletedAt` (`markCascadeDeleted`). Revisions and dirty flags are not raised,
		 * because the room tombstone stands in for the whole subtree. Raising them would turn one
		 * deletion into a push of thousands of records. So children are cleared with one `UPDATE`
		 * statement per table, not read and rewritten row by row.
		 */
		async deleteRoom(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const room = await liveRoom(tx, id);
				if (!room) return;
				await chatRoomTable.upsert(
					tx,
					markLocalDelete(room, now, await nextRev(tx)),
				);
				/**
				 * What `markCascadeDeleted` does is exactly these two statements: it stamps `deletedAt` on live
				 * children. It is not called row by row because a room can hold thousands of messages. The rule
				 * still cannot fork, because that function touches **no** other field (`chat-store.test.ts`'s
				 * cascade check guards it).
				 */
				await tx.run(
					"UPDATE chat_message SET deleted_at = ? WHERE room_id = ? AND deleted_at IS NULL",
					[now, id],
				);
				await tx.run(
					"UPDATE chat_memory SET deleted_at = ? WHERE room_id = ? AND deleted_at IS NULL",
					[now, id],
				);
				/**
				 * The summary follows the same rule. It is the room's **third child**. Missing it would leave
				 * an orphan summary alive on this device, and the next outbound collection would re-upload
				 * **the summary of an already-deleted room** to the server.
				 */
				await tx.run(
					"UPDATE chat_summary SET deleted_at = ? WHERE room_id = ? AND deleted_at IS NULL",
					[now, id],
				);
				/**
				 * The room's characters are the **fourth child**. This was once missing. The row kept no
				 * `deleted_at` and stayed dirty, so the next sync re-uploaded **a character from a deleted room
				 * as a live record.**
				 */
				await tx.run(
					"UPDATE chat_character SET deleted_at = ? WHERE room_id = ? AND deleted_at IS NULL",
					[now, id],
				);
			});
		},

		async deleteMessage(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const current = await readMessage(tx, id);
				if (!current || !isLiveChatRecord(current)) return;
				await chatMessageTable.upsert(
					tx,
					markLocalDelete(current, now, await nextRev(tx)),
				);
				await touchRoomInTx(tx, current.roomId, now);
				/**
				 * Single-message deletion also goes through the rewind. This operation does not touch the tail,
				 * but **the summary may already have read the message.** The summary would then describe an
				 * utterance that no longer exists, and that fact would be silent if only this path skipped the
				 * rewind.
				 */
				await rewindMaintenanceInTx(tx, current.roomId, current.createdAt, now);
			});
		},

		async editUserMessage(
			id: string,
			content: string,
		): Promise<ChatTailRewrite> {
			const next = requireMessageContent(content);
			const target = await readMessage(db, id);
			if (!target || !isLiveChatRecord(target)) return NOT_APPLIED;
			requireEditableRole(target.role, "user");
			return rewriteTail(id, "after", next);
		},

		/**
		 * Assistant edit. Same shape as the web's Dexie version. The only difference is the role gate.
		 * The write rule lives in `rewriteTail` alone.
		 */
		async editAssistantMessage(
			id: string,
			content: string,
		): Promise<ChatTailRewrite> {
			const next = requireMessageContent(content);
			const target = await readMessage(db, id);
			if (!target || !isLiveChatRecord(target)) return NOT_APPLIED;
			requireEditableRole(target.role, "assistant");
			return rewriteTail(id, "after", next);
		},

		deleteFromMessage: (id: string): Promise<ChatTailRewrite> =>
			rewriteTail(id, "from", null),

		/* ── Memories ── */

		async listMemories(roomId: string): Promise<ChatMemory[]> {
			if (!(await liveRoom(db, roomId))) return [];
			const rows = await db.all<SqlRow>(
				"SELECT * FROM chat_memory WHERE room_id = ? AND deleted_at IS NULL",
				[roomId],
			);
			return sortMemories(rows.map(chatMemoryTable.fromRow));
		},

		createMemory(input: CreateMemoryInput): Promise<ChatMemory> {
			const content = requireMemoryContent(input.content);
			const now = nowIso();
			return db.transaction(async (tx) => {
				const room = await liveRoom(tx, input.roomId);
				if (!room) throw new ChatRoomMissingError(input.roomId);
				const count = await tx.first<{ n: number }>(
					"SELECT COUNT(*) AS n FROM chat_memory WHERE room_id = ? AND deleted_at IS NULL",
					[input.roomId],
				);
				if ((count?.n ?? 0) >= CHAT_MEMORY_MAX_PER_ROOM)
					throw new ChatMemoryLimitError();
				const memory = createMemoryRecord(
					{ ...input, content },
					{ id: newLocalId(), now, rev: await nextRev(tx) },
				);
				await chatMemoryTable.upsert(tx, memory);
				return memory;
			});
		},

		async updateMemory(id: string, patch: UpdateMemoryPatch): Promise<void> {
			const content =
				patch.content === undefined
					? undefined
					: requireMemoryContent(patch.content);
			const now = nowIso();
			await db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(
					"SELECT * FROM chat_memory WHERE id = ?",
					[id],
				);
				const current = row ? chatMemoryTable.fromRow(row) : null;
				if (!current || !isLiveChatRecord(current)) return;
				const source = mergeMemorySource(current.source, patch.source);
				const next: ChatMemory = {
					...current,
					...(content !== undefined ? { content } : {}),
					...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
					source,
					/**
					 * Promotion clears the origin time. That value says "which part of the conversation this fact
					 * came from " A sentence a person rewrote is no longer derived from that part; keeping the
					 * timestamp would let a history rewind delete the user's text.
					 */
					originAt: source === "auto" ? current.originAt : null,
				};
				await chatMemoryTable.upsert(
					tx,
					markLocalUpdate(next, now, await nextRev(tx)),
				);
			});
		},

		/* ── Characters: the room's fourth child ─────────────────────────────────────── */

		async listCharacters(roomId: string): Promise<ChatCharacter[]> {
			/** A deleted room's characters count as absent, the same rule as other reads. */
			if (!(await liveRoom(db, roomId))) return [];
			const rows = await db.all<SqlRow>(
				"SELECT * FROM chat_character WHERE room_id = ? AND deleted_at IS NULL",
				[roomId],
			);
			/** The store owns the order, so the screen and prompt assembly see the same one. */
			return sortCharacters(rows.map(chatCharacterTable.fromRow));
		},

		createCharacter(input: CreateCharacterInput): Promise<ChatCharacter> {
			/** Validation runs outside the transaction, as on web, so the error's type is preserved. */
			const name = requireCharacterName(input.name);
			const prompt = requireCharacterPrompt(input.prompt ?? "");
			const now = nowIso();
			return db.transaction(async (tx) => {
				/** Never create under a missing or deleted room. That would leave an orphan record. */
				const room = await liveRoom(tx, input.roomId);
				if (!room) throw new ChatRoomMissingError(input.roomId);
				/** The count limit is also enforced **by the store**, since a button on screen alone cannot stop two windows. */
				const count = await tx.first<{ n: number }>(
					"SELECT COUNT(*) AS n FROM chat_character WHERE room_id = ? AND deleted_at IS NULL",
					[input.roomId],
				);
				if ((count?.n ?? 0) >= CHAT_CHARACTER_MAX_PER_ROOM)
					throw new ChatCharacterLimitError();
				const character = createCharacterRecord(
					{ roomId: input.roomId, name, prompt },
					{ id: newLocalId(), now, rev: await nextRev(tx) },
				);
				await chatCharacterTable.upsert(tx, character);
				return character;
			});
		},

		async updateCharacter(
			id: string,
			patch: UpdateCharacterPatch,
		): Promise<void> {
			const name =
				patch.name === undefined ? undefined : requireCharacterName(patch.name);
			const prompt =
				patch.prompt === undefined
					? undefined
					: requireCharacterPrompt(patch.prompt);
			const now = nowIso();
			await db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(
					"SELECT * FROM chat_character WHERE id = ?",
					[id],
				);
				const current = row ? chatCharacterTable.fromRow(row) : null;
				/**
				 * A missing or already-deleted character is silently skipped (idempotent). **The room's
				 * activity time is not bumped.** If polishing a character description in an old room lifted
				 * that conversation to the top of the list, the user would read it as something they never did
				 * (same judgment as web).
				 */
				if (!current || !isLiveChatRecord(current)) return;
				await chatCharacterTable.upsert(
					tx,
					markLocalUpdate(
						{
							...current,
							...(name !== undefined ? { name } : {}),
							...(prompt !== undefined ? { prompt } : {}),
						},
						now,
						await nextRev(tx),
					),
				);
			});
		},

		async deleteCharacter(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(
					"SELECT * FROM chat_character WHERE id = ?",
					[id],
				);
				const current = row ? chatCharacterTable.fromRow(row) : null;
				// Idempotent. Deleting the same character in two windows really does happen.
				if (!current || !isLiveChatRecord(current)) return;
				/** Soft delete. Removing the row would leave no way to tell other devices about the deletion. */
				await chatCharacterTable.upsert(
					tx,
					markLocalDelete(current, now, await nextRev(tx)),
				);
			});
		},

		/* ── Auto-maintenance ───────────────────────────────────────────────────── */

		async getSummary(roomId: string): Promise<ChatSummary | null> {
			/** Nothing from a deleted room is visible. Same rule as other reads. */
			if (!(await liveRoom(db, roomId))) return null;
			const row = await db.first<SqlRow>(
				"SELECT * FROM chat_summary WHERE id = ? AND deleted_at IS NULL",
				[summaryIdFor(roomId)],
			);
			return row ? chatSummaryTable.fromRow(row) : null;
		},

		applyMemoryMaintenance(
			plan: ChatMaintenancePlan & { roomId: string },
		): Promise<boolean> {
			const now = nowIso();
			return db.transaction(async (tx) => {
				/** Maintenance does not revive a deleted room. */
				const room = await liveRoom(tx, plan.roomId);
				if (!room) return false;

				const summaryRow = await tx.first<SqlRow>(
					"SELECT * FROM chat_summary WHERE id = ? AND deleted_at IS NULL",
					[summaryIdFor(plan.roomId)],
				);
				const summary = summaryRow
					? chatSummaryTable.fromRow(summaryRow)
					: null;

				/**
				 * **Optimistic concurrency. The check is inside the transaction.**
				 *
				 * Checking outside and writing inside leaves a window, and history rewrites and other devices'
				 * pulls can enter through it. The plan was built on a snapshot from seconds ago, so if the
				 * generation or frontier moved, the value is built on **a conversation that no longer exists**,
				 * and so it is stale.
				 */
				if (!maintenanceStillApplies(plan, summary)) return false;

				const live = (
					await tx.all<SqlRow>(
						"SELECT * FROM chat_memory WHERE room_id = ? AND deleted_at IS NULL",
						[plan.roomId],
					)
				).map(chatMemoryTable.fromRow);
				const byId = new Map(live.map((memory) => [memory.id, memory]));

				/**
				 * Revisions are issued **all at once.** Re-reading the wall clock per operation would record
				 * one maintenance run as spanning several milliseconds, and sharing one value would leave the
				 * merge unable to tell their order. The summary line needs one more.
				 */
				const revs = await nextRevs(tx, plan.operations.length + 1);
				let issued = 0;

				for (const operation of plan.operations) {
					if (operation.type === "add") {
						await chatMemoryTable.upsert(
							tx,
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
					 * **The store does not trust the plan.**
					 *
					 * The pure plan already filtered out manual memories (`planMemoryMaintenance`), but the user
					 * may have promoted an auto memory in the meantime (`promoteMemoryPatch`). Then this operation
					 * would delete or overwrite a sentence a person just wrote. If the target is gone or has
					 * become manual, skip only this operation. Rolling back the whole plan would erase the batch's
					 * progress, and the same span would be reprocessed forever.
					 */
					if (!target || !isAutoMemory(target)) {
						issued++;
						continue;
					}

					await chatMemoryTable.upsert(
						tx,
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
				await chatSummaryTable.upsert(
					tx,
					markLocalUpdate(
						{ ...base, summary: plan.summary, frontier: plan.through },
						now,
						revs[issued++],
					),
				);

				/**
				 * **Does not bump the room's activity time.** Same judgment as memory edits, with a stronger
				 * reason: maintenance is not something the user did. Bumping it would lift a conversation to
				 * the top of the list because of a background job, and the user would see a conversation marked
				 * recent that they never touched. This is the reason the timestamp stays put.
				 */
				return true;
			});
		},

		async deleteMemory(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(
					"SELECT * FROM chat_memory WHERE id = ?",
					[id],
				);
				const current = row ? chatMemoryTable.fromRow(row) : null;
				if (!current || !isLiveChatRecord(current)) return;
				await chatMemoryTable.upsert(
					tx,
					markLocalDelete(current, now, await nextRev(tx)),
				);
			});
		},

		/* ── Persona library ───────────────────────────────────────────────────────
		 *
		 * Unlike the memory and summary sections above, this section has one defining trait:
		 * **it never touches the room.** No operation takes a room id, and nothing calls `touchRoomInTx`. The library
		 * is an account asset, not a conversation's child, so deleting a persona never reaches any conversation.
		 * ────────────────────────────────────────────────────────────────────── */

		async listPersonas(): Promise<ChatPersona[]> {
			const rows = await db.all<SqlRow>(
				`SELECT * FROM chat_persona WHERE deleted_at IS NULL
				 ORDER BY updated_at DESC, id DESC`,
			);
			/*
			 * SQL already sorts on the same axis, but the **authority is `sortPersonas`**. The web calls the
			 * same function, so both apps draw their libraries in one order, fixed by that function alone.
			 */
			return sortPersonas(rows.map(chatPersonaTable.fromRow));
		},

		async getPersona(id: string): Promise<ChatPersona | null> {
			const row = await db.first<SqlRow>(
				"SELECT * FROM chat_persona WHERE id = ?",
				[id],
			);
			const persona = row ? chatPersonaTable.fromRow(row) : null;
			return persona && isLiveChatRecord(persona) ? persona : null;
		},

		createPersona: (input: CreatePersonaInput): Promise<ChatPersona> =>
			db.transaction(async (tx) => {
				const persona = createPersonaRecord(input, {
					id: newLocalId(),
					now: nowIso(),
					rev: await nextRev(tx),
				});
				await chatPersonaTable.upsert(tx, persona);
				return persona;
			}),

		async updatePersona(id: string, patch: UpdatePersonaPatch): Promise<void> {
			const next: UpdatePersonaPatch = {
				...(patch.name !== undefined
					? { name: requirePersonaName(patch.name) }
					: {}),
				...(patch.description !== undefined
					? { description: requirePersonaDescription(patch.description) }
					: {}),
			};
			const now = nowIso();
			await db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(
					"SELECT * FROM chat_persona WHERE id = ?",
					[id],
				);
				const current = row ? chatPersonaTable.fromRow(row) : null;
				if (!current || !isLiveChatRecord(current)) return;
				await chatPersonaTable.upsert(
					tx,
					markLocalUpdate({ ...current, ...next }, now, await nextRev(tx)),
				);
			});
		},

		async deletePersona(id: string): Promise<void> {
			const now = nowIso();
			await db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(
					"SELECT * FROM chat_persona WHERE id = ?",
					[id],
				);
				const current = row ? chatPersonaTable.fromRow(row) : null;
				if (!current || !isLiveChatRecord(current)) return;
				/*
				 * **Nothing in this transaction touches `chat_room`.** That absence is the contract of this
				 * operation. Conversations that used this persona keep their own copy and continue as they are.
				 */
				await chatPersonaTable.upsert(
					tx,
					markLocalDelete(current, now, await nextRev(tx)),
				);
			});
		},
	};
}
