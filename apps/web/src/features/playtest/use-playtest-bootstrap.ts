import { useEffect, useState } from "react";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { createPlaytestState, type PlaytestState } from "./playtest-session.ts";

/**
 * Reads one draft revision and opens the playtest, once, when the screen mounts.
 *
 * Not using `liveQuery` is the decisive difference from the editor's subscription. The editor must
 * follow the draft as it changes; this screen must not change. If the system prompt changed
 * mid-conversation, nobody could say what is being tested, and a real conversation does not roll
 * that way either (a room keeps the seed it had at acquisition). The only operation that pulls in
 * another tab's edit has its own name: `New test from latest draft`.
 *
 * The path from the editor has already flushed pending saves (`start-draft-playtest.ts`). A path
 * entered directly by URL sees the last saved revision.
 *
 * There is no loader either. Drafts are local-first: the server does not have this value, and this
 * screen must open offline too.
 */

export type PlaytestBootstrap =
	/**
	 * The scope is opening or the draft is being read. This is distinct from `missing` (see the flicker section, the
	 * flicker note).
	 */
	| { status: "loading"; state: null }
	/** Not a draft in this account. Guests also land here, since there is no database to open. */
	| { status: "missing"; state: null }
	| { status: "ready"; state: PlaytestState };

export function usePlaytestBootstrap(draftId: string): PlaytestBootstrap {
	const { ensureStore, ownsStore, status } = useAuthoringScope();
	const [bootstrap, setBootstrap] = useState<PlaytestBootstrap>({
		status: "loading",
		state: null,
	});

	useEffect(() => {
		/**
		 * Keeps a late read from overwriting the next draft's screen. The route remounts with the draft
		 * id, so in practice this is a new hook instance, but on the path where the scope changes the
		 * same instance reads twice.
		 */
		let alive = true;
		setBootstrap({ status: "loading", state: null });

		void (async () => {
			const store = await ensureStore();
			if (!alive) return;
			if (!store) {
				setBootstrap({ status: "missing", state: null });
				return;
			}
			const source = await store.loadPublicationSource(draftId);
			if (!alive) return;
			/**
			 * If the account changed during the read, this value is the previous member's manuscript. Do not
			 * render it: the route gate removes what is on screen anyway.
			 */
			if (!ownsStore(store)) return;
			if (!source) {
				setBootstrap({ status: "missing", state: null });
				return;
			}
			setBootstrap({
				status: "ready",
				state: createPlaytestState({
					source,
					sessionId: crypto.randomUUID(),
				}),
			});
		})();

		return () => {
			alive = false;
		};
	}, [draftId, ensureStore, ownsStore]);

	/**
	 * A guest falls straight to `missing`. Folding to `loading` would show a user whose session has
	 * ended a placeholder that never finishes, and an endless wait is worse than an error.
	 */
	if (status === "unavailable" && bootstrap.status !== "ready")
		return { status: "missing", state: null };
	return bootstrap;
}
