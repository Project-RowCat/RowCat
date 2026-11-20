import {
	type ChatStore,
	type ConversationMemoryRuntime,
	sweepDeletedRooms,
} from "@rowcat/chat";
import { useEffect, useMemo } from "react";
import { desktopMemoryPort, requestedMemoryBackend } from "./desktop-memory.ts";

const swept = new Set<string>();

/**
 * The member's memory runtime, or null (legacy mode, plain browser). Once per member and page load
 * it sweeps the index: rooms deleted while it was closed (another device's deletion arriving by
 * sync) are erased before they could be recalled.
 */
export function useMemoryRuntime(
	viewerId: string | null,
	store: ChatStore | null,
): ConversationMemoryRuntime | null {
	const runtime = useMemo(() => {
		if (!viewerId) return null;
		const mode = requestedMemoryBackend();
		const port = mode === "legacy" ? null : desktopMemoryPort(viewerId);
		return port ? { mode, port } : null;
	}, [viewerId]);
	useEffect(() => {
		if (!runtime?.port || !store || !viewerId || swept.has(viewerId)) return;
		swept.add(viewerId);
		const port = runtime.port;
		void (async () => {
			try {
				await sweepDeletedRooms(port, store);
			} catch {
				swept.delete(viewerId);
			}
		})();
	}, [runtime, store, viewerId]);
	return runtime;
}
