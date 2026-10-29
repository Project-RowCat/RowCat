import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Compatibility redirect only; this route renders no screen. The old address stays in bookmarks,
 * open tabs and saved navigation state, so it must not 404. Drawing the old UI here would give one
 * feature two canonical addresses.
 *
 * The canonical location is /settings/personas. The library moved out of the `Conversations` section because
 * it is account data, not a child of any conversation (see the header of
 * features/persona/persona-settings-page.tsx).
 *
 * The redirect runs in beforeLoad so no empty screen is painted or baked into SSR HTML. replace
 * prevents Back from looping. Login checks stay in the destination's parent layout
 * (settings/route.tsx) and are not repeated here.
 */
export const Route = createFileRoute("/(app)/personas/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/personas", replace: true });
	},
});
