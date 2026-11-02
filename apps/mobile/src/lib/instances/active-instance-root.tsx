import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { createMobileQueryClient } from "../query.ts";
import { activeInstanceSource } from "./device-registry.ts";

/**
 * The boundary below which **everything belongs to one server** — the query cache, identity, the local
 * scope, sync, push wiring (`docs/mobile/INSTANCES.md` §전환 · 로그아웃 · 취소된 자격).
 *
 * It keys that subtree by the active origin, so switching servers **unmounts all of it and mounts it
 * again** for the other one: the query cache is a fresh object (a reset, not an invalidation — no cell of
 * one server's data can be drawn under the other), the identity provider asks the new server's `/me`, and
 * the local scope closes one member database and opens another. That is the same path an account switch
 * already takes, which is why nothing below this line has to follow a server change in place.
 *
 * The query client is created here, once per mounted instance, for the reason the root used to give: a
 * client created per render discards the cache every time, and a module global would keep the previous
 * person's values — now also the previous server's.
 *
 * Outside this boundary sit only things that are the device's, not a server's: appearance, selection
 * haptics, the update-note seen fact.
 */
export function ActiveInstanceRoot({ children }: { children: ReactNode }) {
	const source = activeInstanceSource();
	const origin = useSyncExternalStore(
		source.subscribe,
		() => source.current().origin,
	);
	return <InstanceTree key={origin}>{children}</InstanceTree>;
}

function InstanceTree({ children }: { children: ReactNode }) {
	const queryClient = useMemo(() => createMobileQueryClient(), []);
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
