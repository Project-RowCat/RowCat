import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { ClientOnly, createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { RuntimeStudioShell } from "#/features/runtime-studio/layout/shell.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Runtime studio: a code project for one draft.
 *
 * The $draftId_ folder name (trailing underscore) keeps this route from becoming a child of the
 * editor. As a child, the editor tree would stay alive behind the studio, along with the editor's
 * autosave hook and subscriptions. The work test uses the same arrangement for the same reason. The
 * address is still /create/:draftId/runtime.
 *
 * There is no loader. Both the draft and its code project are in this device's IndexedDB, not on
 * the server, so there is nothing to pre-fetch. No request leaves the server from this screen. (The
 * work test at least had a generation stream.)
 *
 * The body is wrapped in ClientOnly and split with lazy, for two reasons. The content is an
 * unpublished manuscript, so it must not appear in server HTML, the document title, or server logs
 * (the editor uses the same boundary). Monaco is the largest dependency in this app, so people
 * opening other screens should not download its bytes. ClientOnly blocks rendering, and lazy blocks
 * loading.
 */
const RuntimeStudioPage = lazy(() =>
	import("#/features/runtime-studio/runtime-studio-page.tsx").then(
		(module) => ({
			default: module.RuntimeStudioPage,
		}),
	),
);

const Fallback = () => (
	<RuntimeStudioShell>
		<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			{translator("shell")("loadingProject")}
		</div>
	</RuntimeStudioShell>
);

export const Route = createFileRoute("/(app)/create/$draftId_/runtime")({
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({ to: "/login", search: { redirect: location.href } });
	},
	/**
	 * Remounts the screen when the draft changes.
	 *
	 * The two drafts are different projects. If the mount continued, open tabs, expanded folders, and
	 * Monaco models would flow into the next draft. The symptom is quiet: A's file is gone from B's
	 * explorer but still shows in a tab, and clicking that tab opens a model that does not exist in B.
	 */
	remountDeps: ({ params }) => params.draftId,
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.runtimeStudio", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: RuntimeStudioRoute,
});

function RuntimeStudioRoute() {
	return (
		<ClientOnly fallback={<Fallback />}>
			<Suspense fallback={<Fallback />}>
				<RuntimeStudioPage />
			</Suspense>
		</ClientOnly>
	);
}
