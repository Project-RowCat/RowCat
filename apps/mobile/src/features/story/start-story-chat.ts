import type { ChatPersonaSnapshot, ChatStore } from "@rowcat/chat";
import {
	STORY_PLAY_ERROR_CODE,
	type StoryChatSeedDto,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * The order of `startStoryChat`. It lives outside the screen because the order of irreversible
 * steps is the contract:
 *
 * ```text
 * 1. wait for the local scope to open         (the store is bound to a confirmed member)
 * 2. fetch the play snapshot once from server (GET /stories/:id/play)
 * 3. re-check ownership                       ← just before writing the room
 * 4. create the room locally (SQLite)
 * 5. re-check ownership                       ← just before navigating
 * 6. only then navigate to /chat/:roomId
 * ```
 *
 * The whole point of this function is that a failure at any step does not trigger the next one. No
 * room means no navigation. The order is independent of rendering, so each failure path can be
 * checked on its own; the screen only maps the result to copy.
 *
 * Steps 3 and 5 exist because step 1's guarantee has a shelf life. The store was valid when it was
 * received, and two more awaits (fetch, write) follow. A logout or account switch in between leaves
 * the closure holding a store that belongs to another account or a closed connection, so ownership
 * is asked again right before each irreversible action.
 *
 * ## Room identity is not sent to the server
 *
 * `/play` takes only the story id. Room id, SQLite row id and the device-local conversation id have
 * no slot in the request (the contract says so), and the server returns only a `ChatSeed`. The
 * room's identity is created on the device, which is the substance of local-first. If that boundary
 * blurs, a room list endpoint on the server is only a matter of time.
 *
 * ## Same order on the web, in a different file
 *
 * `apps/web/src/features/story/start-story-chat.ts` holds the same table. It is not moved into a
 * shared package because of layering: this function reads both `@rowcat/chat` (store port) and
 * `@rowcat/sdk` (error classification), and no package in this repository sits above both (`chat`
 * cannot depend on sdk). Rather than create a package for one function, the order is pinned by a
 * test (`start-story-chat.test.ts`, the same matrix as the web test of the same name).
 */

/**
 * Internal failure branches. Not one-to-one with the screen copy.
 *
 * `storage` and `unknown` show the same copy but stay apart: a local store that cannot be opened
 * (disk, permissions) and a server that did not provide the seed need fixes in entirely different
 * places. Folding them into one value would make it impossible to tell which side a "conversation
 * does not start" report comes from.
 */
export type StartFailureReason = "play_unavailable" | "storage" | "unknown";

export type StartStoryChatOutcome =
	/**
	 * The room was created. The product of this operation is the room, not the navigation.
	 *
	 * `navigated: false` means the room exists but the screen did not move there. It is not folded
	 * into `failed`: that would show "try again", and a user who follows it creates a second room for
	 * the same story (the start path has no deduplication and must not — several conversations on one
	 * story are normal). The room that was created is not deleted.
	 */
	| { status: "started"; roomId: string; navigated: boolean }
	/** Already in progress. Not a failure, so the screen changes nothing. */
	| { status: "busy" }
	/**
	 * The scope that started this is no longer active: the user logged out or switched accounts
	 * mid-flight.
	 *
	 * Kept apart from `failed` because neither the story nor the store is at fault. Folding it into
	 * `play_unavailable` would mark a healthy story as unplayable; folding it into `storage` would
	 * point the user at device storage. Both point at the wrong thing.
	 */
	| { status: "stale" }
	| { status: "failed"; reason: StartFailureReason };

export interface StartStoryChatInput {
	storyId: string;
	/**
	 * Synchronous guard against duplicate runs within the same tick.
	 *
	 * React state cannot do this: `setState` lands on the next render, so two events in one tick both
	 * see "not running" and create two rooms. A ref is visible immediately, so that window does not
	 * exist.
	 *
	 * A server-side idempotency key or a global room lock is not used for the same reason. A path this
	 * lock cannot stop (starting concurrently from another device) should produce two rooms.
	 */
	lock: { current: boolean };
	ensureStore: () => Promise<ChatStore | null>;
	/**
	 * Whether this store is still the active scope's, checked **now**.
	 *
	 * This is a predicate on purpose. The function knows nothing of React or SQLite and must not: how
	 * ownership is decided differs per platform, but when to ask is the same everywhere, and that
	 * ordering is what this function must hold.
	 *
	 * Synchronous on purpose: awaiting inside the check would let its answer go stale during the check
	 * itself.
	 */
	stillOwnsStore: (store: ChatStore) => boolean;
	play: (storyId: string) => Promise<StoryChatSeedDto>;
	/**
	 * Play-start record. Called **once**, after the room has actually been created (the same place as
	 * on the web).
	 *
	 * This position defines the event: after `createRoom` succeeds and ownership is confirmed, not
	 * after `play` succeeds. It is not awaited and failures are swallowed — the server is idempotent
	 * on the room id, so there is no retry.
	 */
	recordPlayStart?: (roomId: string) => Promise<unknown>;
	/**
	 * The role the user plays in this conversation — a value already decided.
	 *
	 * Choosing happens outside this function (`story-persona-dialog.tsx`). Reading the library or
	 * opening a dialog here would merge "choose" and "start" into one action, and a user who cancelled
	 * would still get a room.
	 *
	 * The value is applied when the room is created, not afterwards. It is written in the same
	 * transaction as the room (an argument to `createRoom`), so the first frame that draws the opening
	 * already shows the right name. Applying it later leaves a gap in which a user who sends a first
	 * turn starts a conversation where the model received a different name than the screen showed.
	 *
	 * `null` or omitted means no override: the story's suggestion applies. The parent value is not
	 * copied in (`persona.ts` in `@rowcat/chat`).
	 */
	persona?: ChatPersonaSnapshot | null;
	/** Navigate. Returns a promise by contract — native stack navigation is async too. */
	navigate: (roomId: string) => Promise<unknown>;
}

/**
 * Branches of the play-snapshot fetch failure.
 *
 * Only `story_play_unavailable` is separated. That code means "the story is visible but has no play
 * payload", and the user already knows the story is visible from opening its detail, so disclosing
 * it does not break the server's existence hiding.
 *
 * Everything else folds into one value. 404 in particular: the server returns the same 404 for a
 * missing story and for one the viewer cannot see (private, archived, operator-hidden, adult gate,
 * blocked). If the screen spelled out "this is private", anyone enumerating ids could confirm the
 * existence of other people's private stories.
 */
function playFailureReason(error: unknown): StartFailureReason {
	if (!isRowCatApiError(error)) return "unknown";
	if (error.code === STORY_PLAY_ERROR_CODE.unavailable)
		return "play_unavailable";
	return "unknown";
}

export async function startStoryChat({
	storyId,
	lock,
	ensureStore,
	stillOwnsStore,
	play,
	persona,
	navigate,
	recordPlayStart,
}: StartStoryChatInput): Promise<StartStoryChatOutcome> {
	if (lock.current) return { status: "busy" };
	// Lock before the first `await` — a second call in the same tick cannot get past this point.
	lock.current = true;

	try {
		/**
		 * The store comes **first**. If the snapshot were fetched first and the store turned out to be
		 * missing, the body would be downloaded for nothing — it would not even remain on the device.
		 *
		 * Guests stop here too (`ensureStore` returns `null`). Creating a room before identity is
		 * confirmed leaves no way to decide which account owns it, and would force a new rule later
		 * ("merge guest data into the signed-in account").
		 */
		const store = await ensureStore();
		if (!store) return { status: "failed", reason: "storage" };

		let seed: StoryChatSeedDto;
		try {
			seed = await play(storyId);
		} catch (error) {
			return { status: "failed", reason: playFailureReason(error) };
		}

		/**
		 * The first irreversible boundary.
		 *
		 * If the account changed while the snapshot was in flight, this store now belongs to the previous
		 * member. Stopping here leaves nothing behind: the snapshot disappears from memory, and no
		 * unrequested room appears on the device.
		 *
		 * **Do not reopen the previous scope to finish.** That would break the rule that only one
		 * database is open at a time, and nobody could explain when a logged-out account's file gets
		 * reopened.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		let roomId: string;
		try {
			/**
			 * Copy the snapshot **into** the room. Keeping only the story id and refetching on every open is
			 * not the approach: then as soon as the story is edited, made private or deleted, an
			 * already-started conversation cannot be opened, and it cannot be read on a plane.
			 * `originStoryId` is provenance only, not the source of truth for content.
			 */
			const room = await store.createRoom({
				originStoryId: storyId,
				seed,
				/**
				 * With no override, the key itself is not passed. `undefined` and `null` mean the same thing,
				 * but if both shapes live in the store, the same fact is stored as two different objects, and
				 * that difference shows up only as "applying the same page twice gives different results"
				 * (`applyRoomPersona` in `@rowcat/chat`).
				 */
				...(persona ? { persona } : {}),
			});
			roomId = room.id;
		} catch {
			/**
			 * A local write failed — this is not a play-payload problem. Not falling back to memory or
			 * AsyncStorage, because a room created that way vanishes when the app restarts. That is worse
			 * than no room: the user believes the conversation started.
			 *
			 * The error is not logged. This app's product path contains no `console` calls
			 * (`lib/boundaries.test.ts`), and the values flowing here include the story's play snapshot.
			 */
			return { status: "failed", reason: "storage" };
		}

		/**
		 * The second boundary — ownership may have changed **during** the room write.
		 *
		 * This window is much narrower than the one above (a single local write), but navigating from
		 * here is worse: it would hand the currently signed-in account the **previous account's room
		 * address**. That screen would look for a room outside its own scope and end at "conversation not
		 * found".
		 *
		 * The room already created is not deleted. Deleting it would mean reopening the previous member's
		 * database (the thing decided against just above), and that cost outweighs "an empty room remains
		 * on the previous account's device". A local write and a navigation cannot be made one
		 * transaction, so this window can be narrowed but not removed.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		/**
		 * The play start is recorded only after the room is confirmed as this account's — that is the
		 * event boundary. Failures are swallowed without waiting.
		 */
		void recordPlayStart?.(roomId).catch(() => {});

		/**
		 * Navigation happens after the room is confirmed — and **a navigation failure is not a start
		 * failure.**
		 *
		 * This `try` stands apart on purpose. Falling through to the outer catch would report the
		 * already-created room as `failed`, and the screen would suggest retrying. Following that
		 * suggestion creates a second room: the user lost the navigation, but the cost would be a
		 * duplicate conversation.
		 */
		try {
			await navigate(roomId);
		} catch {
			return { status: "started", roomId, navigated: false };
		}
		return { status: "started", roomId, navigated: true };
	} catch {
		return { status: "failed", reason: "unknown" };
	} finally {
		lock.current = false;
	}
}
