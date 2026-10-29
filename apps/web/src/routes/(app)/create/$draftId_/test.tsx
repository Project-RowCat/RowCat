import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { ClientOnly, createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PlaytestShell } from "#/features/playtest/playtest-shell.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Work test: runs a draft without publishing it.
 *
 * The $draftId_ folder name (trailing underscore) keeps this route from becoming a child of the
 * editor. Placing it as a plain $draftId/test.tsx would make $draftId.tsx a layout, so this screen
 * would render inside the editor tree, and the editor's autosave hook and subscriptions would stay
 * alive behind the test screen. The address (/create/:draftId/test) is unchanged.
 *
 * The folder form has one more reason. A sibling file ($draftId_.test.tsx) would match the vitest
 * test glob for *.test.tsx files under src, so the route module would be collected as a test file.
 * The failure would read 'this file has no tests', hiding that the route name is the cause.
 *
 * There is no loader. The draft is in this device's IndexedDB, not on the server, so there is
 * nothing to pre-fetch. The only request this screen sends to the server is one generation stream.
 * It does not publish, create a work, or call /play.
 *
 * The body is wrapped in ClientOnly and split with lazy. The content is the entire unpublished
 * manuscript, so it must not appear in server HTML, the document title, or server logs (the editor
 * uses the same boundary). ClientOnly blocks rendering, and lazy blocks loading.
 */
const PlaytestPage = lazy(() =>
	import("#/features/playtest/playtest-page.tsx").then((module) => ({
		default: module.PlaytestPage,
	})),
);

const Fallback = () => (
	<PlaytestShell>
		<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			{translator("shell")("loadingDraft")}
		</div>
	</PlaytestShell>
);

export const Route = createFileRoute("/(app)/create/$draftId_/test")({
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
	 * The two drafts are different documents, and this screen holds an in-progress generation and a
	 * temporary conversation. If the mount continued, A's streaming text would be drawn on B's screen,
	 * and saves would go to A's session. The data is fine, but the screen is out of sync, which is
	 * hard to notice. The chat room uses the same boundary for the same reason.
	 */
	remountDeps: ({ params }) => params.draftId,
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.playtest", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: PlaytestRoute,
});

function PlaytestRoute() {
	return (
		<ClientOnly fallback={<Fallback />}>
			<Suspense fallback={<Fallback />}>
				<PlaytestPage />
			</Suspense>
		</ClientOnly>
	);
}
