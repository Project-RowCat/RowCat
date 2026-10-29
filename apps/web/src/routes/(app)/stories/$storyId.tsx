import { APP_NAME, isStoryDiscoverable, type Story } from "@rowcat/domain";
import { storyQueryOptions } from "@rowcat/query";
import { createFileRoute } from "@tanstack/react-router";
import { StoryDetailError } from "#/features/story/story-detail-error.tsx";
import { StoryDetailPage } from "#/features/story/story-detail-page.tsx";
import { StoryDetailShell } from "#/features/story/story-detail-shell.tsx";
import { StoryDetailSkeleton } from "#/features/story/story-detail-skeleton.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { metaDescription } from "#/lib/format/meta-description.ts";
import { translator } from "#/lib/i18n/current.ts";
import {
	preloadPersonalization,
	preloadViewer,
} from "#/lib/query/viewer-preload.ts";

/**
 * Turns a story description into a one-line preview. Folding and truncation are owned by
 * metaDescription.
 */
function previewText(story: Story): string {
	const text = metaDescription(story.description);
	/**
	 * If the description is empty, the creator's name is used instead. If there is no creator either
	 * (the story's author was erased with their account), the status text is omitted from search
	 * results, because it does not describe the story.
	 */
	if (!text)
		return story.creator
			? translator("shell")("titles.story", {
					name: story.creator.nickname,
					app: APP_NAME,
				})
			: `${story.title} · ${APP_NAME}`;
	return text;
}

/**
 * Keep this route thin: prefetch and boundary wiring only. The screen itself is owned by
 * features/story.
 *
 * The loader and the component share the same storyQueryOptions, so the component reads the cache
 * entry the server filled and only one request is made. The loader runs on the server for the first
 * visit and in the browser for later navigations; getRowCatClient() hides the difference. On the
 * server it carries the current request's cookie, so a creator opening their own private story
 * renders it.
 *
 * Views are not recorded here. The loader also runs for prefetch, revalidation and crawlers, none
 * of which is a view. The screen records a view after the detail renders in the browser.
 */
export const Route = createFileRoute("/(app)/stories/$storyId")({
	/**
	 * Story and viewer load in parallel because neither needs the other. Personalization is the only
	 * part that waits for the viewer, so guests never send that request.
	 *
	 * Requesting the viewer again here is intentional: Query merges identical keys, so this should not
	 * be coordinated by hand outside Query.
	 *
	 * Only the story query is thrown. Its failure is the server's verdict (missing, private, blocked
	 * and age-gated all return an indistinguishable 404), and swallowing it would drop that verdict.
	 * Access control stays with the Hono API; this loader neither hides nor shows a story based on the
	 * viewer.
	 */
	loader: async ({ context, params }) => {
		const client = getRowCatClient();
		const { queryClient } = context;
		const [story, viewer] = await Promise.all([
			queryClient.ensureQueryData(storyQueryOptions(client, params.storyId)),
			preloadViewer(queryClient, client),
		]);
		if (viewer) await preloadPersonalization(queryClient, client);
		/**
		 * The `head` below uses this value. The story is returned rather than fetched again for metadata:
		 * a second call to the same endpoint doubles server latency during SSR, and the two responses
		 * could differ.
		 */
		return story;
	},
	/**
	 * The detail page is server-rendered, so crawlers and link previews see real story information.
	 *
	 * If the loader threw, loaderData is absent and nothing is emitted. Putting the title of a story
	 * the viewer cannot see into meta tags would undo the server's concealment.
	 */
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const description = previewText(loaderData);
		return {
			meta: [
				{ title: `${loaderData.title} | ${APP_NAME}` },
				{ name: "description", content: description },
				{ property: "og:type", content: "article" },
				{ property: "og:title", content: loaderData.title },
				{ property: "og:description", content: description },
				// The cover URL is absolute and passes through the same exposure boundary as the story.
				...(loaderData.coverUrl
					? [{ property: "og:image", content: loaderData.coverUrl }]
					: []),
				/**
				 * Link-only stories are kept out of search indexes. Link publication promises the story is not
				 * listed, and a stored copy would list it in someone else's index.
				 *
				 * This is a request, not access control: crawlers may ignore it, and the server predicate
				 * (galleryWhere in services/story/index.ts) still decides what opens. robots.txt does not
				 * enumerate story paths, since that public file would become a list of the addresses meant to
				 * stay hidden.
				 *
				 * Preview tags stay. The card a recipient sees in a messenger was sent to them, not indexed.
				 */
				...(isStoryDiscoverable(loaderData.visibility)
					? []
					: [{ name: "robots", content: "noindex" }]),
			],
		};
	},
	component: StoryDetailPage,
	pendingComponent: () => (
		<StoryDetailShell>
			<StoryDetailSkeleton />
		</StoryDetailShell>
	),
	errorComponent: ({ error, reset }) => (
		<StoryDetailShell>
			<StoryDetailError error={error} reset={reset} />
		</StoryDetailShell>
	),
});
