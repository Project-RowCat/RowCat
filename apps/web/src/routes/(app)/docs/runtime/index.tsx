import { APP_NAME } from "@rowcat/domain";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { runtimeDocDocumentTitle } from "#/features/docs/runtime-docs-nav.ts";
import { RuntimeDocPage } from "#/features/docs/runtime-docs-page.tsx";
import { findRuntimeDocEntry } from "#/generated/runtime-docs.ts";

/**
 * /docs/runtime: the first page of the creator runtime public docs.
 *
 * It is public. There is no loader, viewer lookup, or guard. People read it whether or not they
 * have a draft with runtime enabled, and whether or not they are logged in. Some arrive from the
 * studio, others from search. The shell decision is in shell-route.ts, and this screen falls to the
 * public document path (the entry gate does not stand in front).
 *
 * Only the manifest is imported. The generated module imported here, runtime-docs.ts, holds only
 * titles and slugs. The body is imported by the screen component, which is code-split. This is the
 * only place that keeps document bodies out of the main bundle through the route tree.
 */
export const Route = createFileRoute("/(app)/docs/runtime/")({
	head: () => {
		const entry = findRuntimeDocEntry("");
		return {
			meta: [
				{ title: entry ? runtimeDocDocumentTitle(entry) : APP_NAME },
				...(entry ? [{ name: "description", content: entry.description }] : []),
			],
		};
	},
	component: RuntimeDocsIndexRoute,
});

function RuntimeDocsIndexRoute() {
	const entry = findRuntimeDocEntry("");
	/**
	 * The generator guarantees that index.md exists. This branch is unreachable, so it throws instead
	 * of rendering an empty screen.
	 */
	if (!entry) throw notFound();
	return <RuntimeDocPage entry={entry} />;
}
