import {
	type AfterstatePort,
	type ConversationMemoryRuntime,
	eraseConversation,
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

/**
 * One native handle per member, shared by everyone who opens it (the chat screen, a room deletion):
 * each native `open` is a separate engine on the same file, and the bridge's erase fence and write
 * lock hold only within one. The handle closes when the last user closes it.
 */
const shared = new Map<
	string,
	{ store: Promise<NativeAfterstate | null>; users: number }
>();

async function acquire(scopeKey: string): Promise<NativeAfterstate | null> {
	let entry = shared.get(scopeKey);
	if (!entry) {
		entry = {
			store: openNativeAfterstate(scopeKey).catch(() => null),
			users: 0,
		};
		shared.set(scopeKey, entry);
	}
	entry.users++;
	const store = await entry.store;
	if (!store) await release(scopeKey);
	return store;
}

async function release(scopeKey: string): Promise<void> {
	const entry = shared.get(scopeKey);
	if (!entry) return;
	entry.users--;
	if (entry.users > 0) return;
	shared.delete(scopeKey);
	await (await entry.store)?.close();
}

/** Opens the member's index, or `null` (legacy mode, no engine, open failure). Never throws. */
export async function openMemoryRuntime(
	scopeKey: string,
	mode: MemoryBackendMode = requestedMemoryBackend(),
): Promise<OpenMemoryRuntime | null> {
	if (mode === "legacy" || !hasNativeAfterstate()) return null;
	const opened = await acquire(scopeKey);
	if (!opened) return null;
	const port: AfterstatePort = {
		call: (op, params) => opened.call(op, params),
	};
	let closed = false;
	return {
		runtime: { mode, port },
		close: async () => {
			if (closed) return;
			closed = true;
			await release(scopeKey);
		},
	};
}

/**
 * Erases a deleted room from the member's index at once (the web's `eraseRoomMemory`). The sweep at
 * the next open would catch it too, and recall already drops passages of records the store no longer
 * has; this makes the physical erasure immediate. A failure never undoes the deletion.
 */
export async function eraseRoomMemory(
	scopeKey: string | null,
	roomId: string,
): Promise<void> {
	if (!scopeKey) return;
	const opened = await openMemoryRuntime(scopeKey);
	if (!opened) return;
	try {
		if (opened.runtime.port)
			await eraseConversation(opened.runtime.port, roomId);
	} catch {
		// Nothing is logged (no console in product paths, `boundaries.test.ts`). The sweep at the next
		// open erases the room, and recall already drops passages of records the store no longer has.
	} finally {
		await opened.close();
	}
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
