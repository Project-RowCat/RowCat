import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { ClientOnly, createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { validateCreateSearch } from "#/features/create/create-search.ts";
import { CreateShell } from "#/features/create/create-shell.tsx";
import { CreateHomeSkeleton } from "#/features/create/create-skeleton.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Create: the home of the creative workspace, with no loader.
 *
 * This screen draws two kinds of resource (drafts and published works). One of them is server
 * state, yet the route has no loader by design: a draft must not make the server a precondition.
 * Awaiting /me/stories here would show an error to someone with a dropped network the moment they
 * open /create, even though their drafts are safely on the device. The server query runs inside its
 * own boundary when the section that draws it mounts (published-work-list.tsx).
 *
 * Drafts live in this device's IndexedDB, not PostgreSQL, so the server has nothing to pre-fetch.
 * Same boundary as the chat screen.
 *
 * The body is wrapped in ClientOnly. The server renders only the frame, and the list is filled in
 * by the browser after hydration. Rendering on the server would crash without IndexedDB or, worse,
 * send draft titles in the server HTML. The title of an unpublished manuscript belongs to the user
 * alone and must not appear in server logs either.
 *
 * The body is split with lazy for the same boundary: the editor and Dexie stay out of the server
 * bundle's static graph. ClientOnly blocks rendering, and lazy blocks loading.
 */
const CreateHomePage = lazy(() =>
	import("#/features/create/create-home-page.tsx").then((module) => ({
		default: module.CreateHomePage,
	})),
);

export const Route = createFileRoute("/(app)/create/")({
	/**
	 * Which tab is active is held by the address (?view=published).
	 *
	 * If it were React state, reload, back navigation, and link sharing would each need separate
	 * handling. More importantly, a user who opens a work's detail page and comes back would lose the
	 * tab they were on. The reason the parser is lenient (an invalid value does not break the whole
	 * screen) is in that file's header.
	 */
	validateSearch: validateCreateSearch,
	/**
	 * Creation requires authentication.
	 *
	 * The local database is split per member. Before identity is confirmed, a draft cannot be assigned
	 * to an account. The rule 'merge guest data into the logged-in account' would then have to be
	 * designed, and that is out of scope for this slice.
	 *
	 * The check runs in beforeLoad, not in the component, to avoid flicker. A component check would
	 * draw an empty list once before it disappeared. The lookup uses the same viewerQueryOptions as
	 * the root loader, so /me is not requested twice.
	 */
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({
				to: "/login",
				// Returns here after login. Validation is done again by the login route.
				search: { redirect: location.href },
			});
	},
	/**
	 * Fixed title. A draft title used as the document title would stay in browser history and the tab
	 * list, where others can see it. The chat screen follows the same rule for the same reason.
	 */
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.create", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: CreateIndexRoute,
});

function CreateIndexRoute() {
	return (
		<ClientOnly
			fallback={
				<CreateShell>
					<CreateHomeSkeleton />
				</CreateShell>
			}
		>
			<Suspense
				fallback={
					<CreateShell>
						<CreateHomeSkeleton />
					</CreateShell>
				}
			>
				<CreateHomePage />
			</Suspense>
		</ClientOnly>
	);
}
