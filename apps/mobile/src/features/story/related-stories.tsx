import { space } from "@rowcat/design";
import { relatedStoriesQueryOptions } from "@rowcat/query";
import { ListSection } from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { DISCOVER_CELL_GUTTER } from "../discover/grid.ts";
import { StoryCard } from "../discover/story-card.tsx";

/**
 * **Related works**: works that share tags with this one (the same rule as the web's matching
 * section).
 *
 * The card is the discover screen's own card, unchanged. As on web, no second card is built: a copy
 * would go stale for this section alone the day the discover screen changes its card.
 *
 * ## Not an inner `FlatList`
 *
 * The work detail is one comment `FlatList`, and this section sits inside its header. Mounting
 * another `FlatList` here would give the outer one infinite height and switch virtualization off
 * entirely (this app's rule: the list is always one virtualized list). The cap is eight, so one
 * wrapping `View` is enough, and cell width is the discover screen's percentage unchanged, so it
 * does not look at siblings.
 *
 * ## No section when there is nothing
 *
 * An empty response and a failed query both draw no section. The detail is already drawn, and if
 * this one section showed an error or an empty title, the work would read that way.
 */
export function RelatedStories({
	storyId,
	favorites,
	returnPath,
}: {
	storyId: string;
	/** Favorite membership from `/me/state`. */
	favorites: ReadonlySet<string>;
	/** Where a card's heart returns to after sign-in: this detail. */
	returnPath: string;
}) {
	const query = useQuery(
		relatedStoriesQueryOptions(getRowCatClient(), storyId),
	);
	const stories = query.data ?? [];
	if (stories.length === 0) return null;

	return (
		<ListSection title="Related stories" style={section.root}>
			<View style={section.grid}>
				{stories.map((story) => (
					<StoryCard
						key={story.id}
						story={story}
						favorited={favorites.has(story.id)}
						returnPath={returnPath}
					/>
				))}
			</View>
		</ListSection>
	);
}

const section = StyleSheet.create({
	root: { marginTop: space.lg },
	/**
	 * Each cell has a half gutter, so pull it back by that much with a negative margin; this way the
	 * card's outer edge lines up with the detail body text (the discover screen's row does the same
	 * math).
	 */
	grid: {
		flexDirection: "row",
		flexWrap: "wrap",
		marginHorizontal: -DISCOVER_CELL_GUTTER,
		rowGap: space.md,
	},
});
