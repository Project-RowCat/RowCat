import { APP_NAME } from "@rowcat/domain";
import { createFileRoute } from "@tanstack/react-router";
import { ToolSettingsPage } from "#/features/tools/tool-settings-page.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Overrides only the title; auth, noindex and the shell come from the parent layout (route.tsx).
 * Like personas, the ClientOnly boundary sits on the private values inside the page
 * (features/tools/tool-settings-page.tsx), not on the route.
 */
export const Route = createFileRoute("/(app)/settings/tools")({
	/**
	 * A fixed title. A tool name, and above all an http tool's address, would persist in browser
	 * history and tab lists where other people can see it.
	 */
	head: () => ({
		meta: [
			{
				title: translator("shell")("titles.toolSettings", { app: APP_NAME }),
			},
		],
	}),
	component: ToolSettingsPage,
});
