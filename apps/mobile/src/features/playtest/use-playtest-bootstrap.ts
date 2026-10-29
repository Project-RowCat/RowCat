import { useEffect, useState } from "react";
import { newLocalId } from "../../lib/local-data/clock.ts";
import { useAuthoringScope } from "../../lib/local-data/scope.tsx";
import { createPlaytestState, type PlaytestState } from "./playtest-session.ts";
import type { PlaytestSourceStatus } from "./playtest-state.ts";

/**
 * Reads one draft and opens the test — **once, when the screen mounts.**
 *
 * Not subscribing is the key difference from the editor. The editor must follow the draft as it
 * changes (`useLocalDraft`), but this screen must **not change**: if the system prompt changed
 * mid-conversation, nobody could explain what is being tested, and real conversations do not behave
 * that way either (a room keeps the seed it had at acquisition). The one operation that pulls in
 * another device's edits has its own name — `New test with the latest draft`.
 *
 * So it reads once and is done. It does not pass through the write signal (`useLocalLive`), so this
 * screen does not re-read when storage changes.
 *
 * The path entered from the editor has already flushed pending saves (`start-draft-playtest.ts`),
 * and a path entered directly by address sees the last saved version. Both going through the same
 * code is the point: passing the snapshot as a route parameter would leave a deep link with no such
 * value, and an unpublished manuscript would end up in the address.
 */

export interface PlaytestBootstrap {
	/** Current state of reading the draft. The screen state is built by a pure function on top of it. */
	status: PlaytestSourceStatus;
	/** Has a value only in `ready`. */
	state: PlaytestState | null;
}

export function usePlaytestBootstrap(draftId: string): PlaytestBootstrap {
	const { ensureStore, ownsStore } = useAuthoringScope();
	const [bootstrap, setBootstrap] = useState<PlaytestBootstrap>({
		status: "loading",
		state: null,
	});

	useEffect(() => {
		/**
		 * Keeps a late read from **overwriting the next draft's screen.** The route re-mounts with the
		 * draft id, so in practice it becomes a new hook instance, but on the path where the scope
		 * changes, the same instance reads twice.
		 */
		let alive = true;
		setBootstrap({ status: "loading", state: null });

		void (async () => {
			const store = await ensureStore();
			if (!alive) return;
			/**
			 * Guest, or the scope did not open. **Folding into `missing` here does not mean the screen draws
			 * it as is** — the screen state reads the session stage first (`resolvePlaytestScreenState`), so
			 * while login is being checked or storage is still opening, neutral waiting wins.
			 */
			if (!store) {
				setBootstrap({ status: "missing", state: null });
				return;
			}
			const source = await store.loadPublicationSource(draftId);
			if (!alive) return;
			/**
			 * The account changed during the read, so this value is the previous member's manuscript. **Draw
			 * nothing and change no state** — what remains on screen is cleared by the session stage anyway.
			 */
			if (!ownsStore(store)) return;
			if (!source) {
				setBootstrap({ status: "missing", state: null });
				return;
			}
			setBootstrap({
				status: "ready",
				state: createPlaytestState({ source, sessionId: newLocalId() }),
			});
		})();

		return () => {
			alive = false;
		};
	}, [draftId, ensureStore, ownsStore]);

	return bootstrap;
}
