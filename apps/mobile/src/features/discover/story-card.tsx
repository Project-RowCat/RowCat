import type { Story } from "@rowcat/domain";
import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FavoriteControl } from "../story/favorite-control.tsx";
import { StoryByline } from "../story/story-byline.tsx";
import { DISCOVER_CELL_GUTTER, DISCOVER_CELL_WIDTH } from "./grid.ts";
import { StoryCardBody } from "./story-card-body.tsx";
import { storyCardView } from "./story-card-view.ts";

/**
 * One card in the discover grid, **carrying only what is needed to choose.**
 *
 * The one question this card must answer is: *should I open this?* It is not an abridged detail
 * view. Any value that does not help answer that question does not come here.
 *
 * ## Two rows were removed
 *
 * ```text
 * before                        now
 * ┌─────────┐                  ┌─────────┐
 * │  cover   │                  │  cover   │
 * ├─────────┤                  ├─────────┤
 * │ title 2 lines │                  │ title 2 lines │
 * │ by creator │                  │ by creator   ♥ 12 │
 * │ [orient][#a][#b] │  ← removed
 * │            ♥ 12│  ← merged into the byline row
 * └─────────┘                  └─────────┘
 * ```
 *
 * **The reason the orientation badge and tags were removed is the question above.** Those three
 * *classify* a work but do not decide whether to open it. In the grid, the cover and title do that
 * job, and tags are information seen only after looking. That row also varied from card to card
 * (some works have no orientation or tags) and sometimes flowed onto two lines, making it **the row
 * that took the most density while being read the least.** The detail keeps them
 * (`story-meta.tsx`): moved, not deleted.
 *
 * **Display markers (adult, private) remain.** They are not classification. They decide whether
 * this work **opens for me**, and as small badges on the cover they do not consume a row.
 *
 * ## The heart sits on the byline's row
 *
 * The favorite stays on the card because it is an action taken **during discovery**. There is no
 * reason to make someone enter the detail and come back just to save a work they like. It is not
 * placed over the cover, for contrast: for the icon to read over arbitrary artwork it needs a
 * backing layer, and that would be a decoration added to all 24 cards (blur is a native module, and
 * a translucent plate would hide the cover). Merging into one row saves the same row without that
 * cost.
 *
 * View counts, downloads and comment counts are absent. The public contract (`StoryDto`) does not
 * export those values, and the existence of the screen is no reason to push metrics into the
 * contract.
 *
 * ## Three press targets, none overlapping
 *
 * ```text
 * cover + title    opens the work detail
 * byline           opens the creator profile
 * heart            favorite only
 * ```
 *
 * All three are **siblings.** Placing the byline inside the `Pressable` that opens the work, with a
 * second `Pressable` on top, was the quickest answer. It was not chosen, because the winner among
 * nested press targets differs per platform: if the outer one takes the touch first, pressing the
 * creator opens the work, and assistive technology hears "a button inside a button." (A web card
 * likewise does not put a `<button>` inside a `<button>`, and the conversation list row has the
 * same shape — `chat-library/room-row.tsx`.)
 *
 * **It is not solved by stopping propagation.** Neither `stopPropagation` nor relying on luck in
 * responder negotiation. Separating the targets structurally makes it readable from the layout
 * which finger presses what.
 *
 * ## Card height remains predictable
 *
 * The card now has only three parts (cover 3:4, title up to two lines, byline one line). The badge
 * row, whose line count varied per work, is gone, so **two cards in the same row standing at the
 * same height is structural rather than an accident of layout.** `Card`'s `flex: 1` is kept anyway,
 * since a card with a one-line title and one with two lines still mix.
 *
 * ## There is one cell outside the card
 *
 * The **column width** belongs to the cell wrapping the card, not to the card. The card once set
 * its width with `flex: 1`, which means "share the remaining space with siblings", so **when only
 * one card remained on the last row, it stretched across the whole row.** The cell uses a
 * percentage (`DISCOVER_CELL_WIDTH`) and does not look at siblings.
 *
 * The gutter being the cell's **inner padding**, not the card's, is the counterpart. On the card,
 * the padding would fall inside the card's surface and border, and cards would touch each other.
 * The derivation belongs to `grid.ts`.
 *
 * ## Preview dialogs are not carried over
 *
 * The web opens a preview dialog when a grid card is pressed, because returning to the list on
 * desktop is costly. Here a single tap pushes into the detail. The native stack keeps the discover
 * screen and its scroll position, and going back is one gesture.
 */
export const StoryCard = memo(function StoryCard({
	story,
	favorited,
	returnPath,
}: {
	story: Story;
	favorited: boolean;
	returnPath: string;
}) {
	const router = useRouter();

	return (
		<View style={card.cell}>
			{/**
			 * **The picture is shared; only the wrapper belongs to this screen** (`story-card-body.tsx`).
			 * The editor's preview draws it without wrapping the same component. Two copies would make only
			 * the preview go stale the day this card changes.
			 */}
			<StoryCardBody
				view={storyCardView(story)}
				wrapMedia={(media) => (
					<Pressable
						accessibilityRole="button"
						/**
						 * The title belongs in the name, so that 24 cards do not read as a list of "buttons" to
						 * someone not looking at the screen. It pairs with the cover being decorative, so the same
						 * words are not read twice.
						 *
						 * **The creator's name is no longer here.** It now has its own button (`StoryByline`) and
						 * labels its own destination. Writing it here too would make screen readers read the same
						 * name twice, and one of the two would not lead to the profile.
						 */
						accessibilityLabel={story.title}
						accessibilityHint="Opens the story details"
						onPress={() =>
							/**
							 * **Pass only the id.** Carrying the work object as a route parameter would make the detail
							 * draw the copy as of that moment, and that copy would not follow when the favorite total
							 * changes. The detail's source of truth is `storyQueryOptions`.
							 */
							router.push({
								pathname: "/stories/[storyId]",
								params: { storyId: story.id },
							})
						}
						style={({ pressed }) => [card.press, pressed && card.pressed]}
					>
						{media}
					</Pressable>
				)}
				byline={<StoryByline story={story} numberOfLines={1} />}
				action={
					<FavoriteControl
						story={story}
						favorited={favorited}
						returnPath={returnPath}
					/>
				}
			/>
		</View>
	);
});

const card = StyleSheet.create({
	/**
	 * One cell of the grid. **The width is a percentage, so it does not look at siblings.** Even when
	 * only one card remains on the last row, it keeps the width of one column (`grid.ts` holds that
	 * derivation).
	 */
	cell: {
		paddingHorizontal: DISCOVER_CELL_GUTTER,
		width: DISCOVER_CELL_WIDTH,
	},
	/**
	 * **No `flex: 1` here.** The byline and heart are siblings outside this press target. If this
	 * consumed all the remaining space, that row would be pushed down to the card's bottom. Aligning
	 * card heights is done by `storyCard.footer`'s `marginTop: "auto"` alone.
	 */
	press: {},
	pressed: { opacity: 0.7 },
});
