import { type AfterstatePort, eraseConversation } from "@rowcat/chat";
import { browserMemoryPort, releaseBrowserMemory } from "./browser-memory.ts";

/**
 * Long-term memory in the web app is afterstate, and only afterstate.
 *
 * Electron uses the preload's WASM worker; a plain browser uses the same JSON bridge through
 * a per-member WASM worker. Both are derived indexes of the local store, never another source of
 * truth or a second memory algorithm. A browser index is rebuilt after a reload. Without either
 * transport, the existing unavailable state leaves the recent window and user-written memories.
 *
 * Earlier builds kept a per-device rollout switch in `localStorage` (`rowcat.memoryBackend`). It is
 * no longer read; `retireMemoryBackendSetting` removes the stale value once.
 */
interface DesktopAfterstate {
	protocol: string;
	call(memberKey: string, op: string, params: object): Promise<unknown>;
	destroy(memberKey: string): Promise<void>;
	release?(memberKey: string): Promise<void>;
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

/** The desktop Worker Thread transport takes precedence in Electron; browsers use bundled WASM. */
export function memoryPort(memberKey: string): AfterstatePort | null {
	return desktopMemoryPort(memberKey) ?? browserMemoryPort(memberKey);
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
	const port = memberKey ? memoryPort(memberKey) : null;
	if (!port) return;
	try {
		await eraseConversation(port, roomId);
	} catch {
		console.warn("[chat] couldn't erase the room from the local memory index");
	}
}

/** Deletes the member's derived index on either transport (account deletion, local reset). */
export async function deleteDerivedMemory(memberKey: string): Promise<void> {
	releaseBrowserMemory(memberKey);
	ports.delete(memberKey);
	const desktop = desktopAfterstate();
	if (!desktop) return;
	try {
		await desktop.destroy(memberKey);
	} catch {
		console.warn("[local-data] couldn't delete the local memory index");
	}
}

/** Drop plaintext worker state when the member scope closes. Ciphertext survives
 * sign-out; destruction is reserved for account deletion or explicit local reset. */
export function releaseMemory(memberKey: string): void {
	releaseBrowserMemory(memberKey);
	ports.delete(memberKey);
	void desktopAfterstate()
		?.release?.(memberKey)
		.catch(() => {
			console.warn("[chat] couldn't close the local memory worker");
		});
}
