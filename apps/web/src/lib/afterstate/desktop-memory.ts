import {
	type AfterstatePort,
	eraseConversation,
	type MemoryBackendMode,
	parseMemoryBackendMode,
} from "@rowcat/chat";

/**
 * The memory backend in the web app.
 *
 * A browser has no afterstate engine (the engine does not build for `wasm32-unknown-unknown`;
 * see the Phase 11 report), so the web build is memory V2 and nothing here changes that. Inside the
 * desktop app the window's preload exposes the engine as `window.rowcatAfterstate`
 * (`apps/desktop/src/preload.cts`); only then can the backend be `afterstate` or `shadow`.
 *
 * The mode is a per-device setting kept in `localStorage` (`rowcat.memoryBackend`), default
 * `legacy`. It is a staged-rollout switch, not a user feature: switching back to `legacy` is the
 * rollback, and it touches no record (the index is derived; V2's records were never changed).
 */
interface DesktopAfterstate {
	protocol: string;
	call(memberKey: string, op: string, params: object): Promise<unknown>;
	destroy(memberKey: string): Promise<void>;
}

const PROTOCOL = "afterstate-bridge/1";
export const MEMORY_BACKEND_KEY = "rowcat.memoryBackend";

export function desktopAfterstate(): DesktopAfterstate | null {
	if (typeof window === "undefined") return null;
	const candidate = (window as { rowcatAfterstate?: DesktopAfterstate })
		.rowcatAfterstate;
	return candidate?.protocol === PROTOCOL ? candidate : null;
}

export function requestedMemoryBackend(): MemoryBackendMode {
	try {
		return parseMemoryBackendMode(
			globalThis.localStorage?.getItem(MEMORY_BACKEND_KEY),
		);
	} catch {
		return "legacy";
	}
}

/** The member's port, or null (plain browser, or the desktop build without the engine). */
export function desktopMemoryPort(memberKey: string): AfterstatePort | null {
	const desktop = desktopAfterstate();
	if (!desktop) return null;
	return {
		call: async <T>(op: string, params: object) =>
			(await desktop.call(memberKey, op, params)) as T,
	};
}

/**
 * Erases a deleted room from the member's index at once. The sweep at the next start would catch it
 * too, and recall already drops passages of records the store no longer has; this makes the
 * physical erasure immediate. Failures are logged without content and never undo the deletion.
 */
export async function eraseRoomMemory(
	memberKey: string | null,
	roomId: string,
): Promise<void> {
	const port = memberKey ? desktopMemoryPort(memberKey) : null;
	if (!port) return;
	try {
		await eraseConversation(port, roomId);
	} catch {
		console.warn("[chat] couldn't erase the room from the local memory index");
	}
}

/** Deletes the member's index files (account deletion, local reset). No-op outside desktop. */
export async function deleteDerivedMemory(memberKey: string): Promise<void> {
	const desktop = desktopAfterstate();
	if (!desktop) return;
	try {
		await desktop.destroy(memberKey);
	} catch {
		console.warn("[local-data] couldn't delete the local memory index");
	}
}
