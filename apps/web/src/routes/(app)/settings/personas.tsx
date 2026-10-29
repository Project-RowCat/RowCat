import { APP_NAME } from "@rowcat/domain";
import { createFileRoute } from "@tanstack/react-router";
import { PersonaSettingsPage } from "#/features/persona/persona-settings-page.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Overrides only the title; auth, noindex and the shell come from the parent layout (route.tsx).
 *
 * No ClientOnly boundary here. Wrapping the whole route made the server send an empty body and wait
 * for hydration, even for text that is not private. The boundary sits on values inside the page
 * instead (features/persona/persona-settings-page.tsx): title, description and placeholders render
 * on the server, and only role names and descriptions wait for the client.
 */
export const Route = createFileRoute("/(app)/settings/personas")({
	/**
	 * A fixed title. A role name would persist in browser history and tab lists, where other people
	 * can see it. The conversation list follows the same rule for the same reason.
	 */
	head: () => ({
		meta: [
			{
				title: translator("shell")("titles.personaSettings", { app: APP_NAME }),
			},
		],
	}),
	component: PersonaSettingsPage,
});
