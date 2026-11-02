import type { LocalInstance } from "../local-scope.ts";
import type { InstanceRegistry } from "./instance-registry.ts";

/**
 * The server this app is talking to **right now** — the one value the network, auth and local-scope layers
 * read instead of the build's fixed origin (`docs/mobile/INSTANCES.md` §격리 · 순서 4).
 *
 * ```text
 * home      origin = the build's EXPO_PUBLIC_API_ORIGIN; web origin = EXPO_PUBLIC_WEB_ORIGIN
 * other     origin = the registered https origin;     web origin = none (links are not drawn)
 * ```
 *
 * **Read once, then changed only by `switchTo`.** The value comes from the device registry at first read and
 * is held for the life of the process; a switch saves to the registry first and only then notifies, so no
 * subscriber ever sees an instance the device would not reopen after a restart.
 *
 * **A switch is a remount, not a mutation.** The root keys the query cache, identity and local scope by the
 * active origin (`active-instance-root.tsx`), so a switch tears all of it down and builds it again for the
 * other server — the same path as an account switch. Nothing below the root follows the change in place,
 * which is why the clients that read this (`api.ts`, `auth.ts`) can cache per origin without ever serving
 * one server's session to another.
 *
 * Another instance gets **no web origin** for now. Links into the web (account deletion guide, password
 * reset, sharing) would otherwise point at the home server's site while the member is signed in elsewhere;
 * an absent web origin already means "do not draw the link" (`lib/public-web.ts`). A server stating its own
 * web origin is a later change.
 */

export interface ActiveInstance {
	readonly instance: LocalInstance;
	/** The API origin requests go to. */
	readonly origin: string;
	/** The web origin links go to, or `null` when there is none to send a member to. */
	readonly webOrigin: string | null;
}

export interface ActiveInstanceSource {
	current(): ActiveInstance;
	switchTo(instance: LocalInstance): Promise<void>;
	subscribe(listener: () => void): () => void;
}

export function createActiveInstanceSource(input: {
	registry: InstanceRegistry;
	homeOrigin: string;
	homeWebOrigin: string | null;
}): ActiveInstanceSource {
	const resolve = (instance: LocalInstance): ActiveInstance =>
		instance.kind === "home"
			? { instance, origin: input.homeOrigin, webOrigin: input.homeWebOrigin }
			: { instance, origin: instance.origin, webOrigin: null };

	let current: ActiveInstance | null = null;
	const listeners = new Set<() => void>();

	return {
		current() {
			current ??= resolve(input.registry.active());
			return current;
		},
		async switchTo(instance) {
			await input.registry.activate(instance);
			current = resolve(input.registry.active());
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
