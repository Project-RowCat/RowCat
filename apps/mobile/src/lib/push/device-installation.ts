import { deviceValueStorage } from "../device-storage.ts";
import {
	createPushInstallationStore,
	PUSH_INSTALLATION_KEY,
	type PushInstallationStore,
} from "./installation.ts";

/**
 * Native wiring of the installation identity: one device key-value entry and one randomness source.
 *
 * All rules live in `installation.ts`; this file only decides *which key* and *where the random
 * bytes come from*. It is split out for the same reason the update-note seen fact is split: once a
 * file imports a native module it cannot be opened in Node, so the untestable code is kept minimal.
 *
 * Randomness comes from `crypto.getRandomValues`, installed at app entry (`lib/secure-random.ts`;
 * Hermes lacks that function, so that wiring comes first).
 */
export const pushInstallationStore: PushInstallationStore =
	createPushInstallationStore(
		deviceValueStorage(PUSH_INSTALLATION_KEY),
		(length) => crypto.getRandomValues(new Uint8Array(length)),
	);
