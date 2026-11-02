import { deviceValueStorage } from "../device-storage.ts";
import { API_ORIGIN, INSTANCE_SELECTION_ENABLED } from "../env.ts";
import {
	createInstanceRegistry,
	type InstanceRegistry,
} from "./instance-registry.ts";

/**
 * The one registry of this device: the device store, the build's home origin and the build's flag.
 * Kept apart from `instance-registry.ts` because the device store loads `expo-sqlite`, which the test
 * graph cannot; the rules live there and are checked by value.
 *
 * `allowInsecure` is `__DEV__`: a development build reaches a server on the same Wi-Fi over http, and a
 * release build never treats a local address as a server.
 */
let registry: InstanceRegistry | null = null;

export function deviceInstanceRegistry(): InstanceRegistry {
	registry ??= createInstanceRegistry({
		storage: deviceValueStorage("rowcat.instances"),
		enabled: INSTANCE_SELECTION_ENABLED,
		homeOrigin: API_ORIGIN,
		allowInsecure: __DEV__,
	});
	return registry;
}
