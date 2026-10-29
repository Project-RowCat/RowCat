import type { SyncController, SyncTransport } from "@rowcat/sync";
import { createSyncController, nobleAead } from "@rowcat/sync";
import type { MobileLocalScope } from "../local-data/activation.ts";
import { nowIso } from "../local-data/clock.ts";
import {
	createMobileAutoSync,
	type MobileAutoSync,
	type MobileLifecycleSource,
	type MobileNetworkSource,
} from "./auto-sync.ts";
import { syncCodecRegistry } from "./registry.ts";

/**
 * Assembly of the sync runtime, without React: one controller and one auto-sync per scope. It is
 * split out of the React wiring (`provider.tsx`) so it can be verified without a simulator. The
 * ownership decision (an old runtime must not write to a new scope after an account switch) and the
 * setup, recovery and pairing order are render-independent rules; `runtime.test.ts` checks them.
 *
 * Nothing is reimplemented here: encryption, keyring, recovery codes, pairing, HLC, merge,
 * pull/push and the state machine all come from `@rowcat/sync`. This file only plugs this scope's
 * ports into that controller. Codecs use the same assembly as web (`registry.ts`), so both
 * platforms produce the same bytes.
 *
 * AEAD is `nobleAead` because Hermes has no `crypto.subtle`. The pure-JS implementation uses the
 * same byte format as the web's accelerated path, so ciphertext decrypts across platforms and the
 * app adds no crypto library. Key-material randomness comes from `crypto.getRandomValues`,
 * installed at app entry (`lib/secure-random.ts`).
 *
 * Ownership is the scope instance. `ownsScope(scope)` compares by reference, so an old runtime is
 * closed even for `Alice -> sign out -> Alice` (same id, new connection). Comparing member id
 * strings cannot see that switch.
 */
export interface MobileSyncRuntime {
	viewerId: string;
	controller: SyncController;
	autoSync: MobileAutoSync;
}

export interface MobileSyncRuntimeOptions {
	scope: MobileLocalScope;
	ownsScope: (candidate: MobileLocalScope) => boolean;
	transport: SyncTransport;
	lifecycle: MobileLifecycleSource;
	network: MobileNetworkSource;
	timing?: { localDebounceMs?: number; lifecycleWindowMs?: number };
}

export function createMobileSyncRuntime(
	options: MobileSyncRuntimeOptions,
): MobileSyncRuntime {
	const { scope, ownsScope, transport, lifecycle, network, timing } = options;
	const ownsStore = (): boolean => ownsScope(scope);

	const controller = createSyncController({
		owner: scope.viewerId,
		registry: syncCodecRegistry,
		store: scope.stores.sync,
		transport,
		aead: nobleAead,
		deviceKey: scope.stores.deviceKey,
		clock: { nowIso, nowMs: () => Date.now() },
		ownsStore,
	});

	const autoSync = createMobileAutoSync({
		controller,
		mutations: scope.stores.mutations,
		preference: scope.stores.autoSyncPreference,
		ownsStore,
		lifecycle,
		network,
		...(timing ? { timing } : {}),
	});

	return { viewerId: scope.viewerId, controller, autoSync };
}
