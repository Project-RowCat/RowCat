import { deviceValueStorage } from "../device-storage.ts";
import { API_ORIGIN, INSTANCE_SELECTION_ENABLED, WEB_ORIGIN } from "../env.ts";
import type { LocalScope } from "../local-scope.ts";
import {
	type ActiveInstance,
	type ActiveInstanceSource,
	createActiveInstanceSource,
} from "./active-instance.ts";
import {
	createInstanceRegistry,
	type InstanceRegistry,
} from "./instance-registry.ts";

/**
 * The one registry and active instance of this device: the device store, the build's home origins and the
 * build's flag. Kept apart from the pure modules because the device store loads `expo-sqlite`, which the
 * test graph cannot; the rules live there and are checked by value.
 *
 * `allowInsecure` is `__DEV__`: a development build reaches a server on the same Wi-Fi over http, and a
 * release build never treats a local address as a server.
 */
let registry: InstanceRegistry | null = null;
let active: ActiveInstanceSource | null = null;

export function deviceInstanceRegistry(): InstanceRegistry {
	registry ??= createInstanceRegistry({
		storage: deviceValueStorage("rowcat.instances"),
		enabled: INSTANCE_SELECTION_ENABLED,
		homeOrigin: API_ORIGIN,
		allowInsecure: __DEV__,
	});
	return registry;
}

export function activeInstanceSource(): ActiveInstanceSource {
	active ??= createActiveInstanceSource({
		registry: deviceInstanceRegistry(),
		homeOrigin: API_ORIGIN,
		homeWebOrigin: WEB_ORIGIN,
	});
	return active;
}

export const activeInstance = (): ActiveInstance =>
	activeInstanceSource().current();

/** The local scope of a member **on the active instance** — every per-member name starts here. */
export const activeLocalScope = (memberId: string): LocalScope => ({
	instance: activeInstance().instance,
	memberId,
});

/** Where links into the web go on the active instance, or `null` (do not draw the link). */
export const activeWebOrigin = (): string | null => activeInstance().webOrigin;
