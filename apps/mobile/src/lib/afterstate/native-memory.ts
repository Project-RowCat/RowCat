import {
	type AfterstatePort,
	type ConversationMemoryRuntime,
	type MemoryBackendMode,
	parseMemoryBackendMode,
} from "@rowcat/chat";
import {
	hasNativeAfterstate,
	type NativeAfterstate,
	openNativeAfterstate,
} from "../../../modules/afterstate-memory/index.ts";

/**
 * The memory backend on mobile.
 *
 * - **Mode** is a build setting (`EXPO_PUBLIC_MEMORY_BACKEND`: `legacy` | `afterstate` | `shadow`,
 *   default `legacy`). There is no user-facing switch yet: a staged rollout turns it on per build,
 *   and rollback is shipping `legacy` (no record is touched either way; the index is only derived).
 * - **Store**: one per member scope, opened when the member's local scope opens and closed with it,
 *   deleted with the member's local data (`deleteDerivedMemory`, called from the purge).
 * - Without the native module (a build that did not vendor the engine), everything is `legacy`.
 */
export const requestedMemoryBackend = (): MemoryBackendMode =>
	parseMemoryBackendMode(process.env.EXPO_PUBLIC_MEMORY_BACKEND);

export interface OpenMemoryRuntime {
	runtime: ConversationMemoryRuntime;
	close(): Promise<void>;
}

/** Opens the member's index, or `null` (legacy mode, no engine, open failure). Never throws. */
export async function openMemoryRuntime(
	scopeKey: string,
	mode: MemoryBackendMode = requestedMemoryBackend(),
): Promise<OpenMemoryRuntime | null> {
	if (mode === "legacy" || !hasNativeAfterstate()) return null;
	let store: NativeAfterstate | null = null;
	try {
		store = await openNativeAfterstate(scopeKey);
	} catch {
		return null;
	}
	if (!store) return null;
	const opened = store;
	const port: AfterstatePort = {
		call: (op, params) => opened.call(op, params),
	};
	return {
		runtime: { mode, port },
		close: () => opened.close(),
	};
}

/**
 * Deletes a member's index files (account deletion, local reset, instance removal). Opening first is
 * how the library locates the member's file; without the engine there is nothing to delete.
 */
export async function deleteDerivedMemory(scopeKey: string): Promise<void> {
	if (!hasNativeAfterstate()) return;
	const store = await openNativeAfterstate(scopeKey);
	await store?.destroy();
}
