import type { ChatPersonaSnapshot } from "@rowcat/chat";
import type { Story, Viewer } from "@rowcat/domain";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { useLocalPersonas } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { type StartFailureReason, startStoryChat } from "./start-story-chat.ts";
import { StoryPersonaDialog } from "./story-persona-dialog.tsx";

/**
 * Intent and display of `Start conversation`. The hook does not own any screen shape.
 *
 * Two places start a chat: the work detail's main action and the gallery preview's `Start`. Both
 * must do the same work: send guests to login, block duplicate runs within the same tick, and map
 * failures to messages. If each component repeats this procedure, fixing one leaves the other
 * broken. The component missing the lock would create two rooms.
 *
 * The order (scope, acquire, room, navigate) stays in `startStoryChat`. Opening the local store
 * stays in `LocalDataScopeProvider`. This hook keeps only React state and the router. The play
 * snapshot is requested only on press, so calling the hook makes no request.
 *
 * The file is `.tsx` because the hook returns one node, the role picker dialog. If each caller drew
 * that dialog itself, the two screens could follow different procedures. `useRoomManagement` has
 * the same shape for the same reason.
 */

/**
 * `storage` and `unknown` share one message on purpose, since the user can do the same thing for
 * both: retry. Spelling out the cause, such as 'could not open browser storage', only means
 * something to someone who knows the cause and otherwise causes alarm. Causes are kept in logs and
 * metrics.
 *
 * Only `play_unavailable` gets its own message, because retrying never changes its result. The user
 * has already seen the work in a list or detail view, so the message does not reveal more than the
 * server's existence hiding allows.
 */
export const startFailureMessage = (reason: StartFailureReason): string =>
	translator("story")(`startFailure.${reason}`);

/**
 * The room was created, but navigating to it failed.
 *
 * This message sits outside the failure table (`startFailureMessage`) because the fact is
 * different. Every entry there means the start failed; here the start succeeded. In the same table,
 * the screen would eventually suggest retrying, and a retry creates another room.
 * `start-story-chat.ts` documents this at length.
 *
 * For that reason the message points to a place to return to, not to a retry.
 */
export const startNavigateFailureMessage = (): string =>
	translator("story")("navigateFailure");

export interface StoryStart {
	/**
	 * Progress state for display only. Duplicate runs are blocked by the synchronous lock below, not
	 * by this flag.
	 */
	pending: boolean;
	failure: StartFailureReason | null;
	start: () => void;
	/**
	 * The role picker dialog. The caller renders it once in its own tree.
	 *
	 * The hook returns a node, as `useRoomManagement` does, because two callers use it (the work
	 * detail's main action and the gallery preview). If each drew the dialog separately, the two
	 * screens could follow different procedures. The node is `null` while closed, so a screen that
	 * never opens the dialog does not mount its tree.
	 */
	dialog: ReactNode;
}

export function useStoryStart({
	story,
	viewer,
}: {
	story: Story;
	viewer: Viewer | null;
}): StoryStart {
	const navigate = useNavigate();
	/** Where the user returns after logging in: the screen they were trying to start from. */
	const here = useRouterState({ select: (state) => state.location.href });
	/**
	 * `ensureStore` is safe to call while the scope is still opening. If the member is already
	 * confirmed, activation starts directly and is awaited. So callers' buttons do not need to lock
	 * themselves based on `status`: even the first click right after hydration succeeds.
	 */
	const { ensureStore, ownsStore } = useChatScope();
	/**
	 * The only basis for deciding whether to open the picker: whether the library has anything to
	 * choose.
	 *
	 * The dialog subscribes to the list itself, since it draws the list. This hook only counts items,
	 * and one extra subscription is the cost of that check. The alternative, always opening the
	 * dialog, would add a step with nothing to choose for users who have not created a role yet.
	 */
	const { items: personas, loading: personasLoading } = useLocalPersonas();

	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<StartFailureReason | null>(null);
	/** The role picker is open. No room exists yet. */
	const [picking, setPicking] = useState(false);
	const startingRef = useRef(false);

	const run = async (persona: ChatPersonaSnapshot | null) => {
		/**
		 * Guests never reach this point, because `start` above sends them to login.
		 *
		 * The local database is split per member. A room created before identity is confirmed could not
		 * be assigned to an account, and merging guest data into a login later would need a new rule.
		 *
		 * The check remains because this function has two callers: direct start and the dialog's `Start conversation`.
		 * The session can drop while the dialog is open, and the closure would then hold a viewer who is
		 * now a guest.
		 */
		if (!viewer) {
			void navigate({ to: "/login", search: { redirect: here } });
			return;
		}

		/**
		 * The lock is checked here too, not only in `startStoryChat`.
		 *
		 * If a second click reaches that far, this hook's `finally` clears `pending` before the first run
		 * finishes, and the button looks pressable again.
		 */
		if (startingRef.current) return;

		setPending(true);
		setFailure(null);
		try {
			const outcome = await startStoryChat({
				storyId: story.id,
				lock: startingRef,
				ensureStore,
				/*
				 * Ownership is decided by the scope, so `viewer.id` is not compared here.
				 *
				 * The id stays the same when the same account logs in again, but the database connection is
				 * closed and reopened. An id check alone would miss that.
				 */
				stillOwnsStore: ownsStore,
				play: (storyId) => getRowCatClient().stories.play(storyId),
				/** The room id doubles as the server's idempotency key: one room means one start. */
				recordPlayStart: (roomId) =>
					getRowCatClient().stories.recordPlayStart(story.id, {
						sessionKey: roomId,
						kind: "chat",
					}),
				/** The persona is already chosen. Picking it happened outside this function. */
				persona,
				navigate: (roomId) =>
					navigate({ to: "/chat/$roomId", params: { roomId } }),
			});
			/**
			 * On failure the user stays on the calling screen. Creating an empty room and navigating would
			 * leave the user with an empty conversation, and cleaning that up is a chore the flow should
			 * never have imposed.
			 *
			 * A `stale` outcome shows no message. It happens when the user changes accounts during the
			 * start, and the screen has already changed a lot by then (account in the header, favorites,
			 * login state). An error message there would look unrelated. If the user still wants the work,
			 * pressing again under the new account starts over.
			 *
			 * Implementation terms (scope, ownership, store instance) never appear on screen.
			 */
			if (outcome.status === "failed") setFailure(outcome.reason);
			/**
			 * When only navigation fails, the message is a toast and is not stored in `failure`.
			 *
			 * One caller is the gallery preview box, which closes when start is pressed, so an inline
			 * message would sit on a surface that is disappearing. `failure` also means 'could not start',
			 * so the button next to it would suggest retrying, and a retry would create another room.
			 */
			if (outcome.status === "started" && !outcome.navigated)
				showErrorToast(startNavigateFailureMessage());
			/**
			 * The picker closes only after the start finishes. Closing it earlier would leave a blank screen
			 * for a few frames before navigation completes, and a failure message would appear where the
			 * dialog had just been. If navigation succeeded, this component is already unmounted and the
			 * assignment does nothing.
			 */
			if (outcome.status !== "busy") setPicking(false);
		} finally {
			setPending(false);
		}
	};

	/**
	 * A guest's click does not open the picker either. It goes straight to login.
	 *
	 * The order matters. If the picker opened first, a guest would see an empty library, press `Start
	 * conversation`, and only then be sent to login.
	 */
	const start = () => {
		if (!viewer) {
			void navigate({ to: "/login", search: { redirect: here } });
			return;
		}
		/**
		 * Runtime works do not create a room. They go to their own screen.
		 *
		 * This branch changes only what `start` means for runtime works (see §98). The guest check above
		 * does not depend on play mode, so it stays where it is.
		 *
		 * No eligibility check is added here. The server's play gate decides eligibility, and both play
		 * modes pass through that same gate.
		 *
		 * The role picker does not open either. A persona is the vocabulary of a conversation (a copy is
		 * stored in the room), and runtime has no such concept. Opening the picker would ask for a choice
		 * that is never used.
		 */
		if (story.playMode === "runtime") {
			/**
			 * The destination is the runtime address inside the conversation canvas,
			 * `/chat/runtime/:storyId`.
			 *
			 * The old `/stories/:id/play` stays only as a compatibility route that redirects here. New
			 * navigation to it would cost an extra redirect every time.
			 */
			void navigate({
				to: "/chat/runtime/$storyId",
				params: { storyId: story.id },
			});
			return;
		}
		/**
		 * The picker is shown only when there is something to choose.
		 *
		 * With an empty library, start immediately, as before this feature existed. A picker with a
		 * single option would add a step and ask nothing. Users can still create a persona from the
		 * `Personas` item in the conversation list or from the persona tab in room settings.
		 */
		void (async () => {
			const count = personasLoading
				? await readLibraryCount()
				: personas.length;
			if (count === 0) {
				await run(null);
				return;
			}
			setFailure(null);
			setPicking(true);
		})();
	};

	/**
	 * **Not loaded is not empty.** The library subscription answers a moment after the page opens, and
	 * until then its `items` is `[]`. Read as empty, a press in that window started the conversation in
	 * the work's default role for someone whose library has roles to pick, and nothing on screen said a
	 * choice had been skipped (browser journey 16 caught it). So while the subscription has not answered,
	 * the press reads the store once and decides on that.
	 *
	 * Mobile keeps starting at once in that window, for a reason its dialog has and this one does not: it
	 * would draw an empty list while the store opens. This dialog draws its own loading state.
	 */
	const readLibraryCount = async (): Promise<number> => {
		const store = await ensureStore();
		/** No store: the start path names that failure itself (`storage`), so this answers empty and lets it. */
		if (!store) return 0;
		try {
			return (await store.listPersonas()).length;
		} catch {
			/** A store that cannot list is one the start will fail on too, and that failure is spoken there. */
			return 0;
		}
	};

	return {
		pending,
		failure,
		start,
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
