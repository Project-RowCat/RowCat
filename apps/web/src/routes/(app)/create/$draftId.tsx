import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { ClientOnly, createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { DraftEditorShell } from "#/features/create/create-shell.tsx";
import { DraftEditorSkeleton } from "#/features/create/create-skeleton.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Draft editor. Same boundary as /create: no loader, ClientOnly, and a fixed title. The rule is
 * stronger here. The body of this screen is the entire unpublished manuscript. It must not appear
 * in server HTML, the document title, or server logs (the editor already uses the same boundary).
 *
 * Keeping the draft id in the URL is safe. It is a UUID created locally, and knowing the value
 * alone does not let anyone open anything on another device, because databases are split per
 * member.
 */
const DraftEditorPage = lazy(() =>
	import("#/features/create/editor/page.tsx").then((module) => ({
		default: module.DraftEditorPage,
	})),
);

export const Route = createFileRoute("/(app)/create/$draftId")({
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({ to: "/login", search: { redirect: location.href } });
	},
	/**
	 * Remounts the editor when the draft changes.
	 *
	 * The two drafts are different documents. If the mount continued, editor state kept outside render
	 * (the last intended counterpart, focus, scroll position) would flow into the next draft. The
	 * symptom is quiet: a value used in A remains in B's input.
	 *
	 * Pending autosave is not lost at this boundary. Queue entries carry the draft id together with
	 * the storage instance that was current then (autosave-queue.ts). When the editor unmounts, the
	 * autosave hook's cleanup flushes them (use-draft-autosave.ts). So if the user edits A and picks B
	 * from the list before the debounce finishes, A's last edit still saves to A. This is why no
	 * navigation surface creates a second save path.
	 */
	remountDeps: ({ params }) => params.draftId,
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.create", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: CreateDraftRoute,
});

function CreateDraftRoute() {
	return (
		<ClientOnly
			fallback={
				<DraftEditorShell>
					<DraftEditorSkeleton />
				</DraftEditorShell>
			}
		>
			<Suspense
				fallback={
					<DraftEditorShell>
						<DraftEditorSkeleton />
					</DraftEditorShell>
				}
			>
				<DraftEditorPage />
			</Suspense>
		</ClientOnly>
	);
}
