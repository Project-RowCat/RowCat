import { requireOptionalNativeModule } from "expo";

/**
 * The embedded afterstate engine on iOS (static library, C ABI) and Android (shared library, JNI
 * shim). This file only adapts the native module to the port shape; what to index and what to
 * recall is `@rowcat/chat`'s (`conversation-memory.ts`).
 *
 * Loading is optional and lazy: a build without the module (a dev client that has not run
 * `prebuild`, a platform where it failed to link) gets `null`, and the conversation runs on memory
 * V2. Nothing here throws at import time.
 */
interface AfterstateMemoryNativeModule {
	readonly protocol: string;
	open(user: string): Promise<number>;
	call(handle: number, request: string): Promise<string>;
	cancel(handle: number, request: number): Promise<number>;
	close(handle: number): Promise<number>;
	destroy(handle: number): Promise<number>;
}

export interface NativeAfterstate {
	call<T>(op: string, params: object): Promise<T>;
	close(): Promise<void>;
	/** Closes and deletes this member's store files (account deletion, local reset). */
	destroy(): Promise<void>;
}

const PROTOCOL = "afterstate-bridge/1";

let cached: AfterstateMemoryNativeModule | null | undefined;

function nativeModule(): AfterstateMemoryNativeModule | null {
	if (cached === undefined) {
		try {
			const m =
				requireOptionalNativeModule<AfterstateMemoryNativeModule>(
					"AfterstateMemory",
				);
			cached = m && m.protocol === PROTOCOL ? m : null;
		} catch {
			cached = null;
		}
	}
	return cached;
}

/** Whether this build carries the engine. */
export const hasNativeAfterstate = (): boolean => nativeModule() !== null;

/**
 * Opens the member's store, or `null` without the engine. A closed handle answers `closed` from the
 * library itself, so a call racing a close is an error, never a crash.
 */
export async function openNativeAfterstate(
	memberId: string,
): Promise<NativeAfterstate | null> {
	const native = nativeModule();
	if (!native) return null;
	const handle = await native.open(memberId);
	let next = 1;
	return {
		async call<T>(op: string, params: object): Promise<T> {
			const id = next++;
			const raw = await native.call(handle, JSON.stringify({ id, op, params }));
			const response = JSON.parse(raw) as {
				ok: boolean;
				result?: T;
				error?: { code: string; message: string };
			};
			if (!response.ok)
				throw new Error(`afterstate ${op}: ${response.error?.code ?? "error"}`);
			return response.result as T;
		},
		close: async () => {
			await native.close(handle);
		},
		destroy: async () => {
			await native.destroy(handle);
		},
	};
}
