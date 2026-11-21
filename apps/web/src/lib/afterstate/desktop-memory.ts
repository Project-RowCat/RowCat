import { type AfterstatePort, eraseConversation } from "@rowcat/chat";

/**
 * Long-term memory in the web app is afterstate, and only afterstate.
 *
 * A browser has no afterstate engine (the engine does not build for `wasm32-unknown-unknown`; see
 * the Phase 11 report). Inside the desktop app the window's preload exposes the engine as
 * `window.rowcatAfterstate` (`apps/desktop/src/preload.cts`). Without it the conversation still
 * works on its recent window and the memories the person wrote, and the memory screen says
 * long-term memory is unavailable on this device. There is no second engine to fall back to and no
 * switch that selects one.
 *
 * Earlier builds kept a per-device rollout switch in `localStorage` (`rowcat.memoryBackend`). It is
 * no longer read; `retireMemoryBackendSetting` removes the stale value once.
 */
interface DesktopAfterstate {
	protocol: string;
	call(memberKey: string, op: string, params: object): Promise<unknown>;
	destroy(memberKey: string): Promise<void>;
}

const PROTOCOL = "afterstate-bridge/1";
/** The retired rollout switch's key. Never read; only removed. */
export const RETIRED_MEMORY_BACKEND_KEY = "rowcat.memoryBackend";

export function desktopAfterstate(): DesktopAfterstate | null {
	if (typeof window === "undefined") return null;
	const candidate = (window as { rowcatAfterstate?: DesktopAfterstate })
		.rowcatAfterstate;
	return candidate?.protocol === PROTOCOL ? candidate : null;
}

/** Removes the retired rollout switch from this device's storage. Idempotent; never throws. */
export function retireMemoryBackendSetting(): void {
	try {
		globalThis.localStorage?.removeItem(RETIRED_MEMORY_BACKEND_KEY);
	} catch {
		// Storage unavailable (private mode, policy): nothing is read from it either.
	}
}

/**
 * One port object per member for the page's lifetime. The adapter keys per-room state (single-flight
 * maintenance, the indexing status a memory screen states) by the port's identity, so two callers —
 * the conversation and the memory dialog — must hold the same object.
 */
const ports = new Map<string, AfterstatePort>();

/** The member's port, or null (plain browser, or the desktop build without the engine). */
export function desktopMemoryPort(memberKey: string): AfterstatePort | null {
	const desktop = desktopAfterstate();
	if (!desktop) return null;
	let port = ports.get(memberKey);
	if (!port) {
		port = {
			call: async <T>(op: string, params: object) =>
				(await desktop.call(memberKey, op, params)) as T,
		};
		ports.set(memberKey, port);
	}
	return port;
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
