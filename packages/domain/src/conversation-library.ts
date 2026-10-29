/**
 * Unified conversation library: chat rooms and runtime playthroughs share one list.
 * - chat: ChatRoom from @rowcat/chat
 * - runtime: RuntimeConversationRecord from @rowcat/runtime-persistence
 *
 * The file lives in the product domain because the two storage models stay apart: runtime
 * playthroughs do not use ChatRoom or ChatStore. Only the shape (id, title, activity time) lives
 * here; real records pass in as type arguments, and this package imports neither domain.
 *
 * Merge rule: each store sorts most-recent-first, but concatenating the two lists breaks that
 * order. The merge re-sorts once here (updatedAt DESC, id DESC), so web and mobile cannot show
 * different orders. Runtime rows are not grouped into their own section; they sit between chat
 * rooms by activity time.
 *
 * Copy, icons, and navigation are not here, because Korean text in the domain package would tie the
 * rules to one locale.
 */

export type ConversationLibraryKind = "chat" | "runtime";

/** Fields shared by both kinds. These are the only values a list row reads. */
export interface ConversationLibraryItem {
	id: string;
	title: string;
	/** Last activity time (ISO 8601). */
	updatedAt: string;
}

export type ConversationLibraryEntry<
	TChat extends ConversationLibraryItem,
	TRuntime extends ConversationLibraryItem & { storyId: string },
> =
	| {
			kind: "chat";
			id: string;
			title: string;
			updatedAt: string;
			room: TChat;
	  }
	| {
			kind: "runtime";
			id: string;
			title: string;
			updatedAt: string;
			storyId: string;
			conversation: TRuntime;
	  };

/**
 * Tie-break for equal timestamps: the id. This does not rely on the sort engine's stability
 * (room-library.ts makes the same choice). The ids of the two kinds come from separate namespaces,
 * so they cannot be equal.
 */
const byRecentActivity = (
	a: ConversationLibraryItem,
	b: ConversationLibraryItem,
): number =>
	a.updatedAt === b.updatedAt
		? a.id < b.id
			? 1
			: a.id > b.id
				? -1
				: 0
		: a.updatedAt < b.updatedAt
			? 1
			: -1;

/**
 * Merges two lists into one list sorted by most recent activity. It does not depend on input order:
 * the result is the same whichever store returns its rows first. That property is what keeps web
 * and app drawing the same library in the same order.
 */
export function mergeConversationLibrary<
	TChat extends ConversationLibraryItem,
	TRuntime extends ConversationLibraryItem & { storyId: string },
>(
	rooms: readonly TChat[],
	conversations: readonly TRuntime[],
): ConversationLibraryEntry<TChat, TRuntime>[] {
	const entries: ConversationLibraryEntry<TChat, TRuntime>[] = [
		...rooms.map(
			(room): ConversationLibraryEntry<TChat, TRuntime> => ({
				kind: "chat",
				id: room.id,
				title: room.title,
				updatedAt: room.updatedAt,
				room,
			}),
		),
		...conversations.map(
			(conversation): ConversationLibraryEntry<TChat, TRuntime> => ({
				kind: "runtime",
				id: conversation.id,
				title: conversation.title,
				updatedAt: conversation.updatedAt,
				storyId: conversation.storyId,
				conversation,
			}),
		),
	];
	return entries.sort(byRecentActivity);
}

/**
 * Identity of the currently open row: one of the two kinds, or none. The shell's route check yields
 * a room id or a story id, while a library row is highlighted by one id. This function links the
 * two. If each sidebar wrote `roomId ?? runtimeId` on its own, one app would someday fail to
 * highlight runtime rows.
 */
export function activeConversationEntryId(input: {
	activeRoomId: string | null;
	/**
	 * Library row id of the runtime playthrough screen. The app builds it with
	 * runtimeConversationIdFor.
	 */
	activeRuntimeConversationId: string | null;
}): string | null {
	return input.activeRoomId ?? input.activeRuntimeConversationId;
}
