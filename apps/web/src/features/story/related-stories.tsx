import type { Viewer } from "@rowcat/domain";
import { relatedStoriesQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { GALLERY_GRID_CLASS } from "#/features/gallery/gallery-grid.ts";
import { StoryCard } from "#/features/gallery/story-card.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { StoryPreviewDialog } from "./story-preview-dialog.tsx";

/**
 * Related works: works that share at least one tag with this one.
 *
 * The cards are the gallery's own (`StoryCard` plus the preview box). A second card component would
 * go stale the day the gallery changes its tag counts or title line counts.
 *
 * Nothing to show means no section. No empty heading, empty grid, or `No related stories` message is
 * drawn. The server does not return zero-score works (those are merely popular, not related), so an
 * empty response means nothing resembles this work. A failed request is treated the same way: the
 * detail page has already rendered, and an error here would make the whole work look broken.
 *
 * The query runs only after the detail page has rendered, not in the loader. The value does not
 * need to delay the first byte of the detail page, and prefetching (hovering a link) must not add a
 * related query each time.
 */
export function RelatedStories({
	storyId,
	viewer,
	favorites,
}: {
	storyId: string;
	viewer: Viewer | null;
	/**
	 * Favorite membership comes from `/me/state`. It is a viewer-side fact, not a field of the work
	 * object.
	 */
	favorites: ReadonlySet<string>;
}) {
	const { t } = useTranslation("story");
	const query = useQuery(
		relatedStoriesQueryOptions(getRowCatClient(), storyId),
	);
	const stories = query.data ?? [];

	/**
	 * The preview holds only the id, as the gallery does. Holding the work object would stop the heart
	 * in the preview from following the totals updated in the cache.
	 */
	const [previewId, setPreviewId] = useState<string | null>(null);
	const previewStory = stories.find((story) => story.id === previewId) ?? null;
	const closePreview = useCallback(() => setPreviewId(null), []);

	if (stories.length === 0) return null;

	return (
		<section aria-labelledby="related-stories-heading" className="mt-14">
			<h2
				id="related-stories-heading"
				className="text-sm font-semibold text-muted-foreground"
			>
				{t("related")}
			</h2>
			{/*
			 * The grid uses the gallery's exact column layout. Different columns here would draw the same card
			 * at
			 * different widths on each screen, and the cover figure would be cropped on one side only.
			 */}
			<ul className={`${GALLERY_GRID_CLASS} mt-3`}>
				{stories.map((story) => (
					<li key={story.id}>
						<StoryCard
							story={story}
							favorited={favorites.has(story.id)}
							viewer={viewer}
							onPreview={() => setPreviewId(story.id)}
						/>
					</li>
				))}
			</ul>

			<StoryPreviewDialog
				story={previewStory}
				favorites={favorites}
				viewer={viewer}
				onClose={closePreview}
			/>
		</section>
	);
}
