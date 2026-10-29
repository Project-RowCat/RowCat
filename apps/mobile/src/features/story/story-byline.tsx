import { space } from "@rowcat/design";
import { creatorLabel, type Story } from "@rowcat/domain";
import { Text } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { CREATOR_ROUTE } from "../profile/creator-route.ts";

/**
 * The work's byline — the **only** place where a creator's name links to their profile.
 *
 * Screens used to write `by {creatorLabel(story)}` each on their own; this collects them. The point
 * is not uniform wording but **uniform branching**: a work with no creator (a public work whose
 * identity was erased by account deletion) must not link. If each screen wrote that rule, one would
 * eventually miss it, and the result is a **dead link** whose address is the erased member's id,
 * which re-creates as an address the product said it had erased. The web's `story-byline.tsx` sits
 * in the same place for the same reason.
 *
 * `creator` being nullable is part of the contract (`StoryDto.creator`), so the type forces this
 * branch. Folding it with optional chaining here would drop that protection.
 *
 * ## The author credit (`author`) never reaches this component
 *
 * It is free text: anyone can write the same name, and it is **not tied to any account**. Making
 * that value a link would split the name from the person it appears to point at. The credited
 * author is disclosed separately in the story's metadata (`Author credit` in `story-meta.tsx`).
 *
 * ## The whole line is the target
 *
 * The web underlines only the name, but here `by` is part of the target. Fingers have no hover, so
 * size is the only cue that something is pressable, and losing the three characters' worth of
 * spacing is worth making the target actually usable. The name alone is set apart by weight and
 * colour, so the eye can read where it goes.
 */
export function StoryByline({
	story,
	variant = "caption",
	numberOfLines,
}: {
	story: Story;
	/** Font size varies per screen. The link's **behaviour** does not change here. */
	variant?: "caption" | "body";
	numberOfLines?: number;
}) {
	const router = useRouter();
	const label = creatorLabel(story);
	const creator = story.creator;

	/**
	 * Without an owner, the line **stays as text.**
	 *
	 * The line is not removed because of list geometry: card heights assume one byline line. And an
	 * empty slot says nothing — a reader stops at "why is the name missing?". The copy describes the
	 * state, not a name (`DELETED_CREATOR_LABEL`).
	 */
	if (!creator)
		return (
			<Text
				variant={variant}
				tone="muted-foreground"
				numberOfLines={numberOfLines}
			>
				by {label}
			</Text>
		);

	return (
		<Pressable
			accessibilityRole="button"
			/** The label says where it goes — `by …` alone does not reveal that it is an action. */
			accessibilityLabel={`Open ${label}'s profile`}
			/**
			 * The target comes from `hitSlop`. Growing the box would stretch this line to 44pt and tie the
			 * card's vertical rhythm to one byline (the comment delete trigger made the same call).
			 */
			hitSlop={space.sm}
			onPress={() =>
				/**
				 * Pass **only the id.** Carrying the profile object as a route param would make the destination
				 * draw a copy taken at that moment, which does not follow changes such as the follower count.
				 * The profile's source of truth is `publicProfileQueryOptions`.
				 */
				router.push({
					pathname: CREATOR_ROUTE,
					params: { creatorId: creator.id },
				})
			}
			style={byline.press}
		>
			<Text
				variant={variant}
				tone="muted-foreground"
				numberOfLines={numberOfLines}
			>
				{/**
				 * No underline. This app has no hover, so the choice is between always-underlined and
				 * never, and an always-underlined byline draws the eye before the title in a list. The name
				 * alone is set **bolder and brighter** to signal that it is pressable. A hidden action is
				 * one a finger cannot find.
				 */}
				by{" "}
				<Text variant={variant} weight="semibold">
					{label}
				</Text>
			</Text>
		</Pressable>
	);
}

const byline = StyleSheet.create({
	/** Only the length of the name is pressable — filling the line would make the empty space beside it a link. */
	press: { alignSelf: "flex-start", maxWidth: "100%" },
});
