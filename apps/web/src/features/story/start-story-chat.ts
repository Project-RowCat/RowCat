import type { ChatPersonaSnapshot, ChatStore } from "@rowcat/chat";
import type { StoryChatSeedDto } from "@rowcat/contracts";
import { STORY_PLAY_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * The order of the start flow. It lives outside the component because the order of irreversible
 * steps is the logic.
 *
 * 0. The screen chooses the persona (outside this function), so it exists before the room does.
 * 1. Wait for the local scope to open (storage bound to the signed-in member).
 * 2. Fetch the play snapshot from the server, once.
 * 3. Re-check ownership just before the room is written.
 * 4. Create the room locally in IndexedDB.
 * 5. Re-check ownership just before navigation.
 * 6. Navigate to `/chat/:roomId`.
 *
 * Each step's failure must not trigger the next. Without a room there is no navigation.
 *
 * Step 0 is intentionally outside. The user picks in the UI, and this function receives a value
 * that is written with the room in one go. Applying it afterwards would show the default persona on
 * the opening frame, and a user who sent a turn in that window would start a conversation under a
 * name different from the one on screen.
 *
 * Checks 3 and 5 exist because step 1's guarantee has a lifetime. The store is valid only at the
 * moment it is returned, and the two later waits can see a logout or account switch. Pure
 * computation between the checks does not need one.
 */

/**
 * The internal failure reasons. They do not map one to one onto screen text.
 *
 * `storage` and `unknown` show the same message to the user but are kept apart. Failing to open
 * local storage (private mode, quota policy) and the server failing to respond need fixes in
 * entirely different places. Folding them into one value would make them look identical in logs,
 * and then no one could tell which side a 'conversation won't start' report came from.
 */
export type StartFailureReason = "play_unavailable" | "storage" | "unknown";

export type StartStoryChatOutcome =
	/**
	 * The room was created. This action's output is the room, not the navigation. `navigated: false`
	 * means the room exists but the move to its screen failed.
	 *
	 * That is why this axis exists, and why it is not folded into `failed`. Folding it would show `Please
	 * try again`, and a user who follows that creates a second room for the same work. Created rooms are
	 * not deleted either: they are real local data the user asked for, and they appear in the
	 * conversation list.
	 */
	| { status: "started"; roomId: string; navigated: boolean }
	/** Already in progress. This is not a failure, so the screen changes nothing. */
	| { status: "busy" }
	/**
	 * The start scope is no longer active: the user signed out or switched accounts mid-start.
	 *
	 * Kept separate from `failed` because neither the work nor the store has a problem. Folding it
	 * into `play_unavailable` would make a fine work look unstartable, and folding it into `storage`
	 * would send people to suspect browser storage. Both point at the wrong cause. Since the user's
	 * own action caused it, the screen does not treat it as an error: the start simply did not happen.
	 */
	| { status: "stale" }
	| { status: "failed"; reason: StartFailureReason };

export interface StartStoryChatInput {
	storyId: string;
	/**
	 * A synchronous lock that prevents duplicate runs within the same tick. React state cannot do
	 * this: `setState` applies only on the next render, so two double-click events in one tick both
	 * see 'not in progress' and both proceed, creating two rooms. A ref takes effect immediately, so
	 * there is no such window.
	 *
	 * Server idempotency and a global room lock are deliberately not added. The one path this lock
	 * cannot catch, starting from another tab at the same moment, is supposed to create two rooms.
	 */
	lock: { current: boolean };
	ensureStore: () => Promise<ChatStore | null>;
	/**
	 * Whether this store still belongs to the active scope. The predicate is passed in.
	 *
	 * This function knows nothing of React or Dexie and must not. How ownership is determined differs
	 * by platform (web uses `LocalDataScopeProvider`; mobile differs), but when to ask is the same
	 * everywhere, and that ordering is what this function must preserve. It is synchronous on purpose:
	 * awaiting inside the check would make the check itself stale.
	 */
	stillOwnsStore: (store: ChatStore) => boolean;
	play: (storyId: string) => Promise<StoryChatSeedDto>;
	/**
	 * The play-start record. Called once, after the room has actually been created.
	 *
	 * The location defines the event: not after `play` succeeds, but after `createRoom` succeeds and
	 * ownership is confirmed. Calling earlier would count starts whose local write failed or whose
	 * account changed. It is not awaited, because navigation should not depend on a metrics round
	 * trip. Failures are swallowed, and there is no retry, since the server treats the room id as
	 * idempotent. Optional: the test harness omits it.
	 */
	recordPlayStart?: (roomId: string) => Promise<unknown>;
	/**
	 * The persona for this conversation is a value, not a library id.
	 *
	 * When omitted or `null`, there is no override and the work's suggested counterpart is used. Do
	 * not copy the parent's value into this field. A copy would make 'the user explicitly picked this'
	 * indistinguishable from 'nothing was picked' (see `persona.ts` in `@rowcat/chat`).
	 */
	persona?: ChatPersonaSnapshot | null;
	/**
	 * Navigation. The contract returns a promise, because router navigation is actually asynchronous
	 * (loaders and pending boundaries). Without awaiting, the 'navigated' verdict would be reached
	 * before the move completes.
	 */
	navigate: (roomId: string) => Promise<unknown>;
}

/**
 * Failure reasons for fetching the play snapshot. Only `story_play_unavailable` is distinguished.
 * That code means the work is visible but has no play payload. The user already knows the work
 * exists, since they opened its detail, so disclosing this does not break the server's hiding of
 * existence.
 *
 * Everything else is folded into one reason, 404 in particular. The server returns the same 404 for
 * a missing work and for one the user cannot see (private, blocked, adult gate). If the screen
 * translated it into `it's private`, scanning ids would reveal the existence of other people's private
 * works.
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
	navigate,
	persona,
	recordPlayStart,
}: StartStoryChatInput): Promise<StartStoryChatOutcome> {
	if (lock.current) return { status: "busy" };
	// Lock before the first `await`. A second call in the same tick cannot get past this point.
	lock.current = true;

	try {
		/**
		 * Obtain the store first. Fetching the snapshot before knowing the store exists would download a
		 * body that never stays on the device, wasting time and bandwidth.
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
		 * The first irreversible boundary. If the account changed while the store was being acquired, the
		 * store now belongs to the previous member. Stopping here leaves nothing behind: the snapshot
		 * exists only in memory and is discarded, and no unrequested room is created on the device.
		 *
		 * Do not reopen the previous scope to finish. That would break the rule that one database is open
		 * at a time, and no one could explain when the logged-out account's store would reopen.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		let roomId: string;
		try {
			/**
			 * The snapshot is copied into the room. It is not kept as a work id that is re-fetched each time
			 * the room opens. If the work were later edited, made private, or deleted, a conversation
			 * already started would stop opening, and it could not be read offline, for example on a plane.
			 * `originStoryId` is only a provenance marker, not the source of truth for content.
			 */
			const room = await store.createRoom({
				originStoryId: storyId,
				seed,
				/*
				 * The persona is written in the same call as the room. Applying it afterwards would draw the
				 * work's default persona for one frame, and the second write could fail. What would remain is a
				 * conversation started under a persona the user did not choose.
				 */
				...(persona ? { persona } : {}),
			});
			roomId = room.id;
		} catch (error) {
			/**
			 * The local write failed. The cause is not the play payload.
			 *
			 * The code does not fall back to `localStorage` or memory. A room created that way disappears on
			 * reload while the user believes the conversation started. That is worse than having no room at
			 * all.
			 */
			console.error("[story] could not create the local room", error);
			return { status: "failed", reason: "storage" };
		}

		/**
		 * The second boundary: ownership may have changed during the room write. This window is much
		 * narrower than the one above (a single local write), but navigating through it is worse. The
		 * currently signed-in account would receive the previous account's room address, and that screen
		 * would look for a room outside its own scope and end at a 'no such conversation' state.
		 *
		 * The room already created is not deleted. Deleting it would mean reopening the previous member's
		 * database, which is what was ruled out above. Leaving an empty room on the previous account's
		 * device costs less than that. The room appears in that account's list when they sign back in,
		 * and deleting it is up to them then.
		 *
		 * A local write and a navigation cannot share one transaction, so this window cannot be removed,
		 * only narrowed.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		void recordPlayStart?.(roomId).catch(() => {});

		/**
		 * Navigation after the room is confirmed. Navigation failure is not start failure.
		 *
		 * This `try` stands alone on purpose. If it flowed into the outer catch below, the already
		 * created room would be reported as `failed`, and the screen would suggest retrying. Following
		 * that suggestion creates another room. The user lost only the navigation, but the cost would be
		 * a duplicate conversation.
		 */
		try {
			await navigate(roomId);
		} catch (error) {
			console.error("[story] could not navigate to the created room", error);
			return { status: "started", roomId, navigated: false };
		}
		return { status: "started", roomId, navigated: true };
	} catch (error) {
		console.error("[story] could not start the conversation", error);
		return { status: "failed", reason: "unknown" };
	} finally {
		lock.current = false;
	}
}
