import type { ChatPersonaSnapshot } from "@rowcat/chat";
import type { Story } from "@rowcat/domain";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { useChatScope } from "../../lib/local-data/scope.tsx";
import { useLocalPersonas } from "../../lib/local-data/use-personas.ts";
import type { ViewerAction } from "../../lib/viewer-action.ts";
import {
	type StartFailureReason,
	type StartStoryChatOutcome,
	startStoryChat,
} from "./start-story-chat.ts";
import { StoryPersonaDialog } from "./story-persona-dialog.tsx";

/**
 * The **intent and display** of `Start conversation` — this hook owns no screen shape.
 *
 * The order (scope → acquire → room → navigate) belongs to `startStoryChat`, and the way the local
 * store is opened belongs to `MobileLocalDataProvider`. What remains here is React state and
 * navigation.
 *
 * The play snapshot is fetched **only on press**. Calling this hook sends no request, so the cheap
 * property of opening a work's detail is preserved.
 *
 * ## Identity decisions are not made again here
 *
 * The viewer's four states (`allowed`, `sign-in`, `restricted`, `unverified`) are answered by the
 * one decision that favourites and comments already use (`lib/viewer-action.ts`). If conversation
 * start wrote its own interpretation, the copies would eventually diverge, and the diverged side
 * would **present the sign-in screen to someone whose session is alive**. So this hook receives
 * that value.
 *
 * Doing nothing on `unverified` is the point of that decision. Sending someone to sign in while
 * identity cannot be verified reads as "you have been signed out", and starting anyway would create
 * a room with no owner.
 */

/**
 * Failure copy.
 *
 * `storage` and `unknown` sharing one message is deliberate: what the user can do is the same (try
 * again). Carrying the branches straight into copy would produce things like "could not open device
 * storage", which means something only to someone who knows the cause and only causes alarm to
 * everyone else.
 *
 * Only `play_unavailable` is stated separately — it is the one branch where trying again changes
 * nothing. The user already sees from this screen that the work exists and is viewable, so this
 * copy does not cross the existence hiding the server maintains.
 */
export const START_FAILURE_MESSAGE: Record<StartFailureReason, string> = {
	play_unavailable: "A conversation can't be started for this story yet.",
	storage: "Couldn't start the conversation. Please try again in a moment.",
	unknown: "Couldn't start the conversation. Please try again in a moment.",
};

/** Shown to a member under restriction. Does not let them press a request the server would refuse. */
export const START_RESTRICTED_MESSAGE =
	"Your account status doesn't allow starting a conversation.";

export interface StoryStart {
	/** Progress state for display. Duplicate runs are blocked by the synchronous lock itself. */
	pending: boolean;
	failure: string | null;
	start: () => void;
	/**
	 * The role-picking dialog shown before starting — `null` when it is not open.
	 *
	 * The hook emits the node because the dialog's lifetime belongs to this hook. If the screen opened
	 * it with its own state, "when it opens" (when the library is non-empty) and "where the picked
	 * value goes" (the arguments of `startStoryChat`) would split across two places, and a path that
	 * creates the room first would appear between them.
	 */
	dialog: ReactNode | null;
}

export function useStoryStart({
	story,
	action,
	returnPath,
}: {
	story: Story;
	/** The value decided by `lib/viewer-action.ts`. This hook does not interpret it again. */
	action: ViewerAction;
	/** Where to return after sign-in — already a validated internal app path. */
	returnPath: string;
}): StoryStart {
	const storyId = story.id;
	/** How this work plays — **the value the server projects**, not a guess from the screen. */
	const playMode = story.playMode;
	const router = useRouter();
	/**
	 * This call succeeds even while the scope is still opening — if the member is already confirmed,
	 * it takes over the activation and waits. So the button does not need to check storage state to
	 * lock itself: even the first press right after launch succeeds.
	 */
	const { ensureStore, ownsStore } = useChatScope();

	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const startingRef = useRef(false);
	/** Whether the picker dialog is open — **this hook's state** (the value before any room exists). */
	const [picking, setPicking] = useState(false);
	/**
	 * The library — **it only decides whether to open the dialog.** The list itself is read again by
	 * the dialog (same hook, so no extra round trip). It is read here because "is there anything to
	 * pick" is the button's decision.
	 */
	const { value: personas } = useLocalPersonas();

	/**
	 * Creates the room and navigates — **the role is already decided.**
	 *
	 * The point is that picking finishes outside this function (`story-persona-dialog.tsx`). Reading
	 * the library here would merge "choose" and "start" into one action, and a user who cancelled
	 * would still get a room.
	 */
	const run = useCallback(
		async (persona: ChatPersonaSnapshot | null) => {
			/**
			 * Eligibility is **checked again here.** The session may drop or the account may switch while
			 * the dialog is open, and the decision this closure holds is then stale — starting anyway would
			 * create a room with no owner. The store's ownership is asked again afterwards by
			 * `startStoryChat`, twice.
			 */
			if (action !== "allowed") return;
			/**
			 * The lock is checked **here too**. The decision itself lives in `startStoryChat`, but if a
			 * second press got that far, this hook's `finally` would clear `pending` before the first run
			 * finished, and the button would look pressable again.
			 */
			if (startingRef.current) return;

			setPending(true);
			setFailure(null);
			try {
				const outcome: StartStoryChatOutcome = await startStoryChat({
					storyId,
					lock: startingRef,
					ensureStore,
					/*
					 * Ownership is decided by the scope. The member id is not compared here because it is not
					 * enough: signing in again to the same account keeps the id, but the connection has closed and
					 * reopened.
					 */
					stillOwnsStore: ownsStore,
					play: (id) => getRowCatClient().stories.play(id),
					/** The room id is the server's idempotency key — one room is one start. */
					recordPlayStart: (roomId) =>
						getRowCatClient().stories.recordPlayStart(storyId, {
							sessionKey: roomId,
							kind: "chat",
						}),
					/** One value already decided — picking finished outside this function. */
					persona,
					navigate: async (roomId) => {
						router.push(`/chat/${encodeURIComponent(roomId)}`);
					},
				});
				/**
				 * On failure, the screen stays put. Creating an empty room and then navigating would leave the
				 * user with a conversation that has no content.
				 *
				 * `stale` shows no copy. It results from the user **themselves** switching accounts mid-start,
				 * and by then the screen has already changed substantially. Showing "could not start the
				 * conversation" over that would just add an error that seems unrelated to what they just did.
				 * Implementation terms (scope, ownership, store instance) never appear on screen in any case.
				 */
				if (outcome.status === "failed")
					setFailure(START_FAILURE_MESSAGE[outcome.reason]);
			} finally {
				setPending(false);
				setPicking(false);
			}
		},
		[action, ensureStore, ownsStore, router, storyId],
	);

	/**
	 * The button was pressed — **decide what to do** here.
	 *
	 * The picker opens **only when there is something to pick.** With an empty library, the action
	 * starts immediately, just as before this feature existed — a dialog with only one thing to pick
	 * adds a step and asks nothing (the web made the same call). The way to create a role is also
	 * available to that person (`Settings → Personas`, and the persona section of the conversation settings).
	 */
	const begin = useCallback(async () => {
		/**
		 * A guest's press sends them to sign in, rather than acquiring anything. Not calling a specific
		 * sign-in method directly follows the same rule as favourites and comments. It carries the page
		 * they were viewing, so after signing in they return to this work, and pressing again starts the
		 * conversation right away.
		 */
		if (action === "sign-in") {
			router.push({ pathname: "/login", params: { redirect: returnPath } });
			return;
		}
		if (action === "restricted") {
			setFailure(START_RESTRICTED_MESSAGE);
			return;
		}
		/**
		 * Identity **cannot be verified**. Go nowhere and send nothing — sending someone to sign in would
		 * evict a person whose session is alive, and starting anyway would create a room with no owner.
		 */
		if (action !== "allowed") return;

		if (startingRef.current) return;

		/**
		 * **A runtime work does not create a room** — it goes to its own screen.
		 *
		 * The only thing that differs here is what `start` means. The checks before this point (guest,
		 * restriction) are independent of play mode and stay above; no eligibility check is added to this
		 * branch, because that would make the two play modes' authorization diverge. The authority for
		 * eligibility is the server.
		 *
		 * The role picker does not appear either. A persona is a vocabulary of conversation (a copy is
		 * stamped on the room), and runtime has no such concept — showing the dialog would ask the user
		 * for a choice that is used nowhere.
		 */
		if (playMode === "runtime") {
			/**
			 * The destination is **the runtime address inside the conversation canvas**. The old
			 * `/stories/[id]/play` remains only as a compatibility address that redirects here — if new
			 * navigation used it, every press would take one extra redirect.
			 */
			router.push(`/chat/runtime/${encodeURIComponent(storyId)}`);
			return;
		}

		/**
		 * **With an empty library the dialog does not open.** The same holds while the store is still
		 * opening — showing it then would make the list look empty, and the user would read their role as
		 * having disappeared. Their `Start conversation` starts immediately, exactly as before this feature existed.
		 */
		if (personas.length === 0) {
			await run(null);
			return;
		}
		setFailure(null);
		setPicking(true);
	}, [action, personas.length, playMode, returnPath, router, run, storyId]);

	return {
		pending,
		failure,
		start: useCallback(() => {
			void begin();
		}, [begin]),
		dialog: picking ? (
			<StoryPersonaDialog
				pending={pending}
				onCancel={() => setPicking(false)}
				onStart={(persona) => {
					void run(persona);
				}}
			/>
		) : null,
	};
}
