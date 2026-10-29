import { APP_NAME } from "@rowcat/domain";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsAiPage } from "#/features/settings/settings-ai-page.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Overrides only the title. Auth checks, noindex and the shell belong to the parent layout;
 * repeating them here would miss one when a category is added.
 *
 * The `/settings/ai` address exists so that leaving `Conversation settings` goes to the provider section directly,
 * instead of to `/settings`, where users had to scroll for it.
 */
export const Route = createFileRoute("/(app)/settings/ai")({
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.aiSettings", { app: APP_NAME }) },
		],
	}),
	component: SettingsAiPage,
});
