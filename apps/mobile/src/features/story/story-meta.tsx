import { space } from "@rowcat/design";
import {
	ORIENTATION_LABEL,
	type Story,
	storyVisibilityBadgeLabel,
} from "@rowcat/domain";
import { Badge, ListRow, Separator, Text, targetSlop } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { formatDate, formatSize } from "../../lib/format.ts";
import { StoryByline } from "./story-byline.tsx";

/**
 * Title, identity, badges, and secondary information.
 *
 * ## What is **not** here
 *
 * No view counts, downloads, comment counts, revenue or token counts. The public contract
 * (`StoryDto`) does not export those values, and the existence of this screen is not grounds for
 * pushing a metric into the contract — a metric exposed once is hard to take back.
 *
 * The creator's name is now a **profile action**. It used to be unpressable text, and the reason
 * was honest: this app had no `/creators/[creatorId]`, and a link to a missing destination reads to
 * the person who presses it as the app being broken. That screen exists now, so the reason is gone.
 *
 * The branch is not in this file (`story-byline.tsx`). If each screen wrote the rule "no link
 * without an owner" (a public work whose identity was erased by account deletion), one would
 * eventually miss it, and the result would be **a dead link whose address is the erased member's
 * id**.
 *
 * There is no `Start conversation` here either. The button is a promise, and there is no screen yet that
 * completes that action. Standing it up as a disabled button or as "coming soon" draws a promise
 * that cannot be kept.
 */
export function StoryHeading({
	story,
	own,
}: {
	story: Story;
	/**
	 * Whether the viewer is this work's creator — **a judgment of the display layer** (`isOwnStory`).
	 * It is not authorization: edit and delete permissions are decided by the server, and this slice
	 * has no such actions.
	 */
	own: boolean;
}) {
	/** `null` for public works, so the pill itself is not drawn. */
	const visibilityLabel = storyVisibilityBadgeLabel(story.visibility);
	return (
		<View style={meta.heading}>
			{/**
			 * **The badges stand ABOVE the title — the same place as the web detail** (`story-hero.tsx`).
			 *
			 * If neither applies, the row is not drawn at all. Leaving an empty row would put unexplained
			 * space above the title, which varies per work, so the screen would jump on arrival from the list.
			 */}
			{(story.adult || visibilityLabel) && (
				<View style={meta.badges}>
					{story.adult && <Badge label="Adult" variant="destructive" />}
					{/**
					 * Visibility state — **public works show no pill** (`storyVisibilityBadgeLabel`; the web
					 * detail calls the same function). The pill on a link-shared work is also for the person
					 * who arrived through the link: they cannot find this work in discovery, and without a
					 * stated reason it would look broken.
					 */}
					{visibilityLabel ? <Badge label={visibilityLabel} /> : null}
				</View>
			)}

			{/** The screen's main title is the work title — the same hierarchy as the web detail (one largest text). */}
			<Text accessibilityRole="header" variant="display">
				{story.title}
			</Text>
			{/**
			 * The **same component** as the list card. If the line seen in the list differs from the one seen
			 * when opened, one starts to doubt it is the same work — and above all, if the rule "no creator, no
			 * link" were written in two places, one of them would eventually be fixed and the other not.
			 */}
			<View style={meta.byline}>
				<StoryByline story={story} variant="body" />
				{story.orientation && (
					<>
						<Dot />
						<Text variant="body" tone="muted-foreground">
							{ORIENTATION_LABEL[story.orientation]}
						</Text>
					</>
				)}
				{own && (
					<>
						<Dot />
						<Text variant="body" tone="muted-foreground">
							My story
						</Text>
					</>
				)}
			</View>
		</View>
	);
}

/**
 * The middle dot in the identity line — **decoration, not read out.**
 *
 * Same call as the web's `aria-hidden` on this spot: assistive tech should read the three pieces as
 * one continuous phrase, and a "middle dot" in between would break the name apart.
 */
function Dot() {
	return (
		<Text
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			variant="body"
			tone="muted-foreground"
			style={meta.dot}
		>
			·
		</Text>
	);
}

/** Description — does not collapse line breaks the creator entered (collapsing them erases the whole paragraph structure). */
export function StoryDescription({ description }: { description: string }) {
	const text = description.trim();
	return text ? (
		<Text variant="body" leading="reading">
			{text}
		</Text>
	) : (
		<Text variant="body" tone="muted-foreground">
			No description.
		</Text>
	);
}

/**
 * Tags — pressing one goes to **the discovery screen narrowed to that tag.**
 *
 * This line was unpressable for a while, because there was no axis to filter by tag, on the server
 * or on discovery. That axis now exists (`GalleryFilters.tag`, `?tag=`). Not stuffing it into the
 * search query still holds: search is partial matching, while the tag axis answers only works
 * matching the one word the creator chose, exactly.
 *
 * It uses `navigate` because discovery is the root of the stack. With `push`, a second discovery
 * would stand on top of the first, and back would return to this work's detail in between. Only
 * **one tag** is carried in the params — any search or sort set earlier is cleared (`navigate` does
 * not merge params). That is the same outcome as the web's `/?tag=…` link.
 */
export function StoryTags({ tags }: { tags: string[] }) {
	const router = useRouter();
	if (tags.length === 0) return null;
	return (
		<View accessibilityLabel="Tags" style={meta.badges}>
			{tags.map((tag) => (
				<Pressable
					key={tag}
					accessibilityRole="button"
					accessibilityLabel={`Find stories tagged ${tag}`}
					/** The badge is about 20pt, so padding is added up to the finger target (44). */
					hitSlop={targetSlop(20)}
					onPress={() => router.navigate({ pathname: "/", params: { tag } })}
					style={({ pressed }) => pressed && meta.tagPressed}
				>
					<Badge label={`#${tag}`} variant="muted" />
				</Pressable>
			))}
		</View>
	);
}

/**
 * Secondary information — created and updated times, credited author, size, body form.
 *
 * Dates are stamped in the product timezone (`PRODUCT_TIME_ZONE`). Using the device timezone makes the
 * same work's creation date differ by a day between web and app, and users read that as one of them
 * being wrong (`lib/format.ts`).
 */
export function StoryMetadata({ story }: { story: Story }) {
	const created = formatDate(story.createdAt);
	const updated = formatDate(story.updatedAt);

	return (
		<View style={meta.properties}>
			{/**
			 * **The section's label — the quietest text on this screen** (the web's `story-properties.tsx`
			 * records the same call: it is a signpost, not content to read).
			 *
			 * ⚠️ For a while this app had neither this line nor the boundary above it. The created, updated and
			 * size rows then ran straight on from the tags and read **as part of the work description**. On the
			 * web, a rule and this label push those three into "secondary information".
			 */}
			<Separator />
			<Text variant="caption" tone="muted-foreground">
				Story info
			</Text>
			<View style={meta.table}>
				{created && <ListRow label="Posted" value={created} />}
				{/** Does not print the same date on two lines for a work that was never edited. */}
				{updated && updated !== created && (
					<ListRow label="Edited" value={updated} />
				)}
				{/** Disclosed only when a name different from the uploader's account is written — if it is the same, it just repeats the byline. */}
				{story.author && story.author !== story.creator?.nickname && (
					<ListRow label="Author credit" value={story.author} />
				)}
				<ListRow label="Size" value={formatSize(story.sizeBytes)} />
				{story.promptProtected && (
					<ListRow label="Body" value="Protected prompt" />
				)}
			</View>
		</View>
	);
}

const meta = StyleSheet.create({
	/**
	 * 6 is off the spacing scale — the title, byline, badges and table rows are things that **must
	 * read as one block**, and at `sm` (8) they would split into separate sections. The rhythm between
	 * sections is still given by the screen through `space`.
	 */
	heading: { gap: 6 },
	badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	/** The answer while pressed — geometry stays the same, only opacity changes (same size as the card's press). */
	tagPressed: { opacity: 0.6 },
	/**
	 * **Three on one line** — person, classification, context. Not split for the same reason as the
	 * web's line: all three answer "what is this work", and splitting the line would widen the gap
	 * between title and primary action (`story-hero.tsx`).
	 *
	 * ⚠️ For a while the classification and `My story` lived on **the badge row below**, not on this line.
	 * That vocabulary belongs to the list card (on a narrow card the pill reads better than text), and
	 * on the detail the same facts were drawn at two weights. The web keeps them as quiet text on the
	 * detail.
	 */
	byline: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 6,
	},
	dot: { opacity: 0.5 },
	/**
	 * Widens only the body line spacing beyond the default. The work description is the longest text
	 * on this screen, and at that length 22 reads cramped — the web detail also uses `leading-relaxed`
	 * in this spot.
	 */
	table: { gap: 6 },
	/** Stacks the rule, label and table into one block — the web's `border-t pt-6` spot. */
	properties: { gap: space.md },
});
