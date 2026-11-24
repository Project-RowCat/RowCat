import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader } from "#/features/settings/settings-parts.tsx";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { ToolLibrarySkeleton } from "./tool-library-skeleton.tsx";

/**
 * The tool library: the account's own chat tools, one category of the settings workspace.
 *
 * Same boundary as the persona library (features/persona/persona-settings-page.tsx), for the same
 * reason and with more at stake: tool names, descriptions, endpoint addresses and header values
 * (often keys) live only in this device's IndexedDB. The server draws the category title and
 * description; only the browser draws the list. ClientOnly keeps the values out of the server
 * HTML, and lazy keeps Dexie and the list out of the server's module graph
 * (tools-boundaries.test.ts guards both).
 *
 * Which rooms a tool is on in is not decided here. Each room decides that in its own settings
 * (room-settings/tools.tsx); this page decides what a tool is and whether it starts on.
 */

const ToolLibraryContent = lazy(() =>
	import("./tool-library-content.tsx").then((module) => ({
		default: module.ToolLibraryContent,
	})),
);

export function ToolSettingsPage() {
	const { t } = useTranslation("tools");
	return (
		<PageEnter>
			<SettingsPageHeader
				title={t("page.title")}
				description={t("page.description")}
			/>

			<div className="mt-6">
				<ToolLibraryBoundary />
			</div>
		</PageEnter>
	);
}

/** The last node the server renders; the same placeholder on both sides of the handoff. */
function ToolLibraryBoundary() {
	const fallback = <ToolLibrarySkeleton />;
	return (
		<ClientOnly fallback={fallback}>
			<Suspense fallback={fallback}>
				<ToolLibraryContent />
			</Suspense>
		</ClientOnly>
	);
}
