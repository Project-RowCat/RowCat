import { APP_NAME } from "@rowcat/domain";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Retired address. /stories/:storyId/play now redirects to /chat/runtime/:storyId.
 *
 * The route is kept because the old address may sit in browser history, bookmarks or deployed
 * clients, but it must not become a second playback surface (§9). Two screens would run the same
 * story differently.
 *
 * The redirect runs in beforeLoad. A navigate from a mounted component would flash the playback
 * screen and its VM for a frame, and Back would return here. replace swaps the history entry so
 * this component never renders.
 *
 * The $storyId_ folder suffix stays so the route is not nested under the detail route.
 */
export const Route = createFileRoute("/(app)/stories/$storyId_/play")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/chat/runtime/$storyId",
			params: { storyId: params.storyId },
			replace: true,
		});
	},
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.play", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: () => null,
});
