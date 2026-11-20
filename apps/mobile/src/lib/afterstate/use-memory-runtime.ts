import {
	type ChatStore,
	type ConversationMemoryRuntime,
	sweepDeletedRooms,
} from "@rowcat/chat";
import { useEffect, useState } from "react";
import { openMemoryRuntime } from "./native-memory.ts";

/**
 * The memory runtime of the open scope (its key: `MobileLocalScope.scopeKey`), `null` otherwise (and always in
 * legacy mode or without the engine). Opens once per member, closes when the member changes or the
 * screen tree unmounts.
 *
 * After opening it sweeps: rooms deleted while the index was closed (on another device, delivered
 * by sync as tombstones) are erased from the index before any recall can run.
 */
export function useMemoryRuntime(
	scopeKey: string | null,
	store: ChatStore | null,
): ConversationMemoryRuntime | null {
	const [runtime, setRuntime] = useState<ConversationMemoryRuntime | null>(
		null,
	);
	useEffect(() => {
		if (!scopeKey || !store) {
			setRuntime(null);
			return;
		}
		let closed = false;
		let close: (() => Promise<void>) | null = null;
		void (async () => {
			const opened = await openMemoryRuntime(scopeKey);
			if (!opened) return;
			if (closed) {
				await opened.close();
				return;
			}
			close = opened.close;
			try {
				if (opened.runtime.port)
					await sweepDeletedRooms(opened.runtime.port, store);
			} catch {
				// A failed sweep leaves recall's own store check as the guard.
			}
			if (!closed) setRuntime(opened.runtime);
		})();
		return () => {
			closed = true;
			setRuntime(null);
			void close?.();
		};
	}, [scopeKey, store]);
	return runtime;
}
