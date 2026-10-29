import type { SyncWakeEvent } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import type { SyncRequestOptions, SyncTransport } from "@rowcat/sync";

/**
 * Thin adapter from RowCatClient to SyncTransport. Keeps @rowcat/sdk and @rowcat/sync unaware of
 * each other, so transport and orchestration do not merge. A later Expo client can reuse the SDK
 * with a different sync engine.
 *
 * It only translates the abort signal type. @rowcat/sync types the signal as { aborted: boolean }
 * to avoid DOM types. The web passes a real AbortSignal, so the cast holds at runtime. Typing the
 * port with DOM types would let the package see document and window.
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
});

/**
 * Opens the wake stream, keeping endpoint details out of feature code. wake.ts only sees an async
 * iterable of SyncWakeEvent that takes an abort signal, so tests can inject a fake stream.
 *
 * It lives here rather than in @rowcat/sync because SSE is a web transport detail. An Expo build
 * can honor the same SyncWakeEvent contract with another mechanism, such as push notifications. If
 * the shared package knew about streams, that choice would be lost.
 */
export type SyncWakeStream = (
	signal: AbortSignal,
) => AsyncIterable<SyncWakeEvent>;

export const createSyncWakeStream =
	(client: RowCatClient): SyncWakeStream =>
	(signal) =>
		client.sync.wakeStream({ signal });
