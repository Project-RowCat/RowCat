import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader } from "#/features/settings/settings-parts.tsx";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { PersonaLibrarySkeleton } from "./persona-library-skeleton.tsx";

/**
 * The persona library: the account's saved list of roles, one category of the settings workspace.
 * - Why settings: if editing required opening a conversation, the library would become a child of
 *   conversations. Personas are account assets, not children of any conversation (persona.ts in
 * @rowcat/chat). The earlier /personas page lived in the conversation section, which put the
 * account
 *   asset behind the conversation list and split width and typography from settings. The canonical
 *   route is /settings/personas and this file is that category's body.
 * - Room settings keep their selection view. That view decides which copy to embed in this
 *   conversation, not the list itself; the boundary between the two screens is that sentence.
 * - The boundary is by value, not by screen. The server draws the shell, nav list, category
 *   title, description and placeholder. The browser alone handles role names and descriptions, list
 *   state, the IndexedDB subscription and create/edit/delete.
 * - The whole body used to be ClientOnly, based on the claim that the list was the whole body.
 *   That was wrong: title and description are constants. Now ClientOnly wraps only the IndexedDB
 *   content, and this file imports no local-storage module (persona-boundaries.test.ts guards
 *   that).
 * - lazy is needed too: ClientOnly alone still pulls this page and Dexie into the server's static
 *   graph. Blocking render and blocking loading are different things.
 * - There is no server loader or query cache. Personas are in the device's IndexedDB, not
 *   PostgreSQL, so the server has nothing to prefetch.
 */

/**
 * The private body. The import sits inside the function, and that is half of the boundary: a static
 * import would pull Dexie and local storage into this module's graph, so the server would load all
 * of it just to draw a title.
 */
const PersonaLibraryContent = lazy(() =>
	import("./persona-library-content.tsx").then((module) => ({
		default: module.PersonaLibraryContent,
	})),
);

export function PersonaSettingsPage() {
	const { t } = useTranslation("persona");
	return (
		/*
		 * The enter animation wraps only the category body. The nav list and width belong to the settings
		 * shell and must stay in place when the category changes, so only what just arrived moves
		 * (settings-general-page.tsx uses the same rule). The transition is one per category. If the
		 * title, list and empty state each had their own enter, values would appear piece by piece on
		 * every arrival and the screen would not read as one arrival.
		 */
		<PageEnter>
			<SettingsPageHeader
				title={t("page.title")}
				description={t("page.description")}
			/>

			<div className="mt-6">
				<PersonaLibraryBoundary />
			</div>
		</PageEnter>
	);
}

/**
 * Where the private value waits. This is the last node the server renders. Two wrappers for
 * different reasons: ClientOnly blocks server rendering (role names must not reach the HTML);
 * Suspense waits in the browser for the chunk to arrive. The placeholder must be the same component
 * for both, so nothing changes at the handoff between them.
 */
function PersonaLibraryBoundary() {
	const fallback = <PersonaLibrarySkeleton />;
	return (
		<ClientOnly fallback={fallback}>
			<Suspense fallback={fallback}>
				<PersonaLibraryContent />
			</Suspense>
		</ClientOnly>
	);
}
