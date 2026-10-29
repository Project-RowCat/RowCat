import { createFileRoute } from "@tanstack/react-router";
import { SettingsGeneralPage } from "#/features/settings/settings-general-page.tsx";

/**
 * This is the only general settings address; there is no `/settings/general` alias. Two addresses
 * would leave no answer to which one is canonical.
 *
 * A redirect would still bounce every saved `/settings` link (the header gear, the conversation
 * settings hint, bookmarks) for the sake of one extra word in the URL. Auth and the shell belong to
 * the parent layout (route.tsx); this file only decides which category this address is.
 */
export const Route = createFileRoute("/(app)/settings/")({
	component: SettingsGeneralPage,
});
