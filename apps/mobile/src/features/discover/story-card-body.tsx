import { space } from "@rowcat/design";
import { Badge, Card, Text } from "@rowcat/ui-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { StoryCover } from "../story/story-cover.tsx";
import type { StoryCardView } from "./story-card-view.ts";

/**
 * The **picture** of a card: cover, badges, title, and the bottom row.
 *
 * Holding no outer press is the whole of this component's job. The discover grid wraps the cover
 * and title in a `Pressable` (pressing opens the detail), while the editor's preview does not wrap
 * them, **because there is nothing to press** (that card is a picture, not a control).
 *
 * The two are not split by a single condition, because what differs is the **kind of element**.
 * Folding them with an `interactive` boolean would let the preview become pressable someday, and
 * that press would have neither a detail to open nor a work to hold. So the **caller** does the
 * wrapping (`wrapMedia`), the shape this repository already uses (`MessageList` takes a function
 * that builds the controls).
 *
 * The two items on the bottom row follow the same axis. The byline is a button to the creator's
 * profile and the heart is a favorite toggle. The preview has no profile to go to and no work to
 * press, so they arrive as **nodes**, not values.
 *
 * ## Why it is not kept as two copies
 *
 * If the preview drew its own card by hand, the day the grid changed the title line count or added
 * a badge, **only the preview would lie.** A creator would learn after publishing that a word they
 * believed visible had actually been cut. The web split the same place for the same reason
 * (`apps/web/src/features/gallery/story-card-body.tsx`).
 */
export function StoryCardBody({
	view,
	wrapMedia,
	byline,
	action,
}: {
	view: StoryCardView;
	/** Element wrapping the cover and title. The grid passes a `Pressable`; the preview leaves them as is. */
	wrapMedia: (media: ReactNode) => ReactNode;
	/** Left of the bottom row. It is the shrinking side, so this slot gets only the remaining width. */
	byline: ReactNode;
	/** Right end of the bottom row. The grid passes the heart control; the preview passes its picture. */
	action: ReactNode;
}) {
	return (
		<Card padded={false} style={storyCard.root}>
			{wrapMedia(
				<>
					<View style={storyCard.coverBox}>
						<StoryCover
							uri={view.coverUrl}
							title={null}
							style={storyCard.cover}
						/>
						{/** Badges raise only the axes that tell "what this work is." If everything carried a badge, the emphasis would disappear. */}
						{(view.adult || view.visibilityLabel) && (
							<View style={storyCard.coverBadges}>
								{view.adult && <Badge label="Adult" variant="destructive" />}
								{view.visibilityLabel ? (
									<Badge label={view.visibilityLabel} />
								) : null}
							</View>
						)}
					</View>

					<View style={storyCard.title}>
						<Text variant="label" weight="semibold" numberOfLines={2}>
							{view.title}
						</Text>
					</View>
				</>,
			)}

			{/**
			 * **The byline and heart are one row, and that row is the bottom of the card.**
			 *
			 * `marginTop: "auto"` is here so the heart's vertical position matches even when one-line and
			 * two-line title cards share a row. The name comes first and the heart at the right end.
			 * Reversing that would stop a finger from remembering the card's bottom-right corner, and that
			 * position must be the same across the whole grid.
			 */}
			<View style={storyCard.footer}>
				<View style={storyCard.byline}>{byline}</View>
				{action}
			</View>
		</Card>
	);
}

/**
 * Card geometry — **both places read the same values.**
 *
 * The grid's cell width (`cell`) is not here. It belongs to the grid, and the preview has no grid.
 * The preview sets **one card's width** itself, within its own section.
 */
export const storyCard = StyleSheet.create({
	/** Fills vertically within the cell, so cards with different title line counts stand at the same height. */
	root: { flex: 1 },
	coverBox: { position: "relative" },
	/** 3:4, the same ratio as the web grid. The same work is not cropped differently on the two screens. */
	cover: { aspectRatio: 3 / 4 },
	coverBadges: {
		flexDirection: "row",
		gap: space.xs,
		left: space.sm,
		position: "absolute",
		top: space.sm,
	},
	/**
	 * Inside the card, spacing is **tighter than the shared scale** (2·10·6). The width is only half
	 * the screen, so applying the shared rhythm would leave no room for two title lines. It is
	 * functional geometry, so it stays here.
	 */
	title: { paddingHorizontal: 10, paddingTop: space.sm },
	/**
	 * The heart is an unlabeled icon plus a count, so it has no room to shrink (RN's default
	 * `flexShrink` is 0). The row's horizontal padding is 6 so the heart sits close to the card corner
	 * and consumes less width. The name side takes the difference (10 − 6 = `space.xs`) as inner
	 * padding, so it starts where the two lines above start, and the three lines read as one block.
	 */
	footer: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs,
		marginTop: "auto",
		paddingBottom: 6,
		paddingHorizontal: 6,
		paddingTop: 2,
	},
	byline: { flex: 1, minWidth: 0, paddingLeft: space.xs },
});
