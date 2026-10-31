import type { RowCatClient } from "@rowcat/sdk";
import type { SyncRequestOptions, SyncTransport } from "@rowcat/sync";

/**
 * Adapts `RowCatClient` to `SyncTransport`; the counterpart of web `local-sync/transport.ts`.
 *
 * It keeps `@rowcat/sdk` and `@rowcat/sync` unaware of each other. If feature components began
 * calling `client.sync.pull(...)` directly, transport and orchestration would mix on screen and a
 * second execution path would appear that skips single-run, backoff and ownership checks. So this
 * adapter is the only app code that touches the SDK's sync surface (a static scan enforces it in
 * `features/sync/sync-boundaries.test.ts`).
 *
 * It only translates the cancellation signal type. `@rowcat/sync` knows only `{ aborted: boolean }`
 * to avoid DOM types, while the values passed here are real `AbortSignal`s, so the cast holds at
 * runtime.
 *
 * There is no wake-up stream. The web listens over SSE for early remote changes, but carrying a
 * browser SSE lifecycle over to Expo would keep a connection open in the background. Convergence
 * here comes from startup, local changes, foreground return, reconnect and manual sync; native
 * remote wake-up is a deliberately deferred extension (see the header of
 * `local-sync/provider.tsx`).
 */
const toSdkOptions = (
	options?: SyncRequestOptions,
): { signal?: AbortSignal } | undefined =>
	options?.signal ? { signal: options.signal as AbortSignal } : undefined;

export const createSyncTransport = (client: RowCatClient): SyncTransport => ({
	getKeyring: (options) => client.sync.getKeyring(toSdkOptions(options)),
	setupKeyring: (input, options) =>
		client.sync.setupKeyring(input, toSdkOptions(options)),
	rewrapKeyring: (input, options) =>
		client.sync.rewrapKeyring(input, toSdkOptions(options)),
	resetKeyring: (options) => client.sync.resetKeyring(toSdkOptions(options)),
	verifyKeyring: (input, options) =>
		client.sync.verifyKeyring(input, toSdkOptions(options)),
	pull: (input, options) => client.sync.pull(input, toSdkOptions(options)),
	push: (input, options) => client.sync.push(input, toSdkOptions(options)),
	startPairing: (input, options) =>
		client.sync.startPairing(input, toSdkOptions(options)),
	readPairing: (input, options) =>
		client.sync.readPairing(input, toSdkOptions(options)),
	approvePairing: (input, options) =>
		client.sync.approvePairing(input, toSdkOptions(options)),
	cancelPairing: (input, options) =>
		client.sync.cancelPairing(input, toSdkOptions(options)),
	/** Whose session this is; the controller checks it before every run (`SyncTransport.sessionOwner`). */
	sessionOwner: async (options) =>
		(await client.me.get(toSdkOptions(options)))?.id ?? null,
});
