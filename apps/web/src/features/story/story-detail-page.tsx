import { isFavorited } from "@rowcat/domain";
import {
	personalizationQueryOptions,
	storyQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { CommentSection } from "#/features/story/comments/comment-section.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { RelatedStories } from "./related-stories.tsx";
import { StoryDetailShell } from "./story-detail-shell.tsx";
import { StoryHero } from "./story-hero.tsx";

const route = getRouteApi("/(app)/stories/$storyId");

/**
 * Coordinator only: lookup, view recording, and membership checks live here; rendering lives in
 * story-hero.tsx.
 *
 * These run exactly once, so they stay out of presentational components. Tying the view to a
 * component mount would let placeholders, previews, and prefetches count as views.
 *
 * The query reuses storyQueryOptions from the route loader, so the SSR-fetched story becomes this
 * cache entry. No visibility rules are applied here: the server returns 404 for works the viewer
 * cannot see.
 */
export function StoryDetailPage() {
	const { storyId } = route.useParams();
	const client = getRowCatClient();
	const { data: story } = useSuspenseQuery(storyQueryOptions(client, storyId));

	/**
	 * The viewer and personalization queries use useQuery, not useSuspenseQuery, so a failure or delay
	 * there never blocks the story.
	 *
	 * Guests skip the personalization query entirely, since its round trip would only delay the first
	 * paint.
	 */
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	const personalization = useQuery({
		...personalizationQueryOptions(client),
		enabled: viewer !== null,
	}).data;

	/**
	 * The view record is sent only here, after the detail has rendered in the browser. In a loader or
	 * queryFn, SSR, hover prefetch, revalidation, and crawlers would all count as views.
	 *
	 * Failures are swallowed. A view count is an analytics side effect and must not replace a viewable
	 * work with an error screen.
	 *
	 * There is no client-side deduplication. The server already dedupes by work, viewer, and UTC day,
	 * and a local copy would be a second source of truth.
	 */
	useEffect(() => {
		void client.stories.recordView(storyId).catch(() => {});
	}, [client, storyId]);

	const favorited = personalization
		? isFavorited(personalization, story.id)
		: false;
	/**
	 * Heart state for related-story cards. The array is cached as-is, and only the lookup uses a Set,
	 * the same as the gallery.
	 */
	const favorites = useMemo(
		() => new Set(personalization?.favorites ?? []),
		[personalization],
	);

	return (
		<StoryDetailShell>
			{/*
			 * The entrance animation wraps only the inner content. The back link is shared by
			 * the placeholder, error, and body states and must stay still during transitions,
			 * because the detail screen can be opened directly by URL.
			 *
			 * A work arrives as one unit. Staging the cover before the title would choreograph
			 * the assembly, and the user waited for the work, not for its assembly.
			 */}
			<PageEnter>
				<StoryHero story={story} viewer={viewer} favorited={favorited} />

				{/*
				 * Related works sit between the body and the comments, because that is where a
				 * reader who has finished the work goes next. Below the comments they would require
				 * reading the whole discussion first. Without related works, the section is not
				 * rendered.
				 */}
				<RelatedStories
					storyId={story.id}
					viewer={viewer}
					favorites={favorites}
				/>

				{/*
				 * Comments come after the body: not in tabs, and not beside the cover. A discussion
				 * between the work and the start action would make newcomers read others' reactions
				 * before understanding the work. In two columns a comment line would be only as wide
				 * as the cover, so the comments sit below the article.
				 *
				 * No divider is drawn. The only rule on this screen is above the secondary
				 * information, and two rules 40px apart would read as noise.
				 */}
				<div className="mt-14">
					<CommentSection story={story} viewer={viewer} />
				</div>
			</PageEnter>
		</StoryDetailShell>
	);
}
