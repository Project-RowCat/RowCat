import { isOwnStory, type Story, type Viewer } from "@rowcat/domain";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Link } from "@tanstack/react-router";
import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ReportMenu } from "#/features/moderation/report-menu.tsx";
import { StoryByline } from "#/features/profile/story-byline.tsx";
import { FavoriteControl } from "#/features/social/favorite-control.tsx";
import {
	adultBadge,
	orientationLabel,
	visibilityBadgeLabel,
} from "#/lib/i18n/vocab.ts";
import { StoryShareControl } from "./share-control.tsx";
import {
	STORY_COVER_COLUMN_CLASS,
	STORY_DETAIL_LAYOUT_CLASS,
} from "./story-detail-shell.tsx";
import { StoryProperties } from "./story-properties.tsx";
import { StoryStartControl } from "./story-start-control.tsx";

/**
 * The body of a published work, built as one unit: identity (title, byline, badges, primary
 * action), then content (description, tags), then secondary information. Lower layers are separated
 * by spacing and type rather than boxes, so the first-screen questions stay in front.
 *
 * The description sits below the primary action because it has no length limit; above the button it
 * would push the action off the first screen. It is not collapsed, since the full text lives on the
 * detail screen.
 *
 * The hero does no lookups, view recording, or submissions. View recording in particular stays on
 * the detail screen, because mounting here would count placeholders, prefetches, and previews as
 * views.
 */
export function StoryHero({
	story,
	viewer,
	favorited,
}: {
	story: Story;
	viewer: Viewer | null;
	/**
	 * Whether the viewer has favorited this work. It comes from the viewer side (`/me/state`), not
	 * from the work object.
	 */
	favorited: boolean;
}) {
	return (
		<article className={STORY_DETAIL_LAYOUT_CLASS}>
			<div className={STORY_COVER_COLUMN_CLASS}>
				<StoryCover story={story} />
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-6">
				<StoryIdentity story={story} viewer={viewer} />

				<StoryActions story={story} viewer={viewer} favorited={favorited} />

				{/*
				 * Description and tags are both creator-written and stay visually together.
				 * Spacing them like the other layers would make the tags look like a separate
				 * section, which they lack the weight for.
				 */}
				<div className="flex flex-col gap-4">
					<StoryDescription description={story.description} />
					{story.tags.length > 0 && <StoryTags tags={story.tags} />}
				</div>

				<StoryProperties story={story} />
			</div>
		</article>
	);
}

/**
 * `story.coverUrl` goes straight into `<img src>`. Fetching the bytes through the SDK into a blob
 * would defeat the browser cache, conditional requests, and lazy loading. The server serves the
 * cover at its own URL outside the JSON for this reason, and that URL passes the same visibility
 * check as the work.
 */
function StoryCover({ story }: { story: Story }) {
	const { t } = useTranslation("story");
	if (!story.coverUrl)
		return (
			/**
			 * Without a cover, a plain `<img>` would show the browser's broken-image icon. The placeholder
			 * matches the gallery card: a detail screen that looked different from the card just clicked
			 * would make the user doubt it is the same work.
			 */
			<div
				aria-hidden="true"
				className="flex aspect-3/4 w-full items-center justify-center rounded-lg border bg-linear-to-br from-muted to-muted/30 text-muted-foreground/60"
			>
				<ImageOff className="size-10" />
			</div>
		);

	return (
		<img
			src={story.coverUrl}
			referrerPolicy="no-referrer"
			alt={t("coverAlt", { title: story.title })}
			decoding="async"
			className="aspect-3/4 w-full rounded-lg border bg-muted object-cover"
		/>
	);
}

/**
 * Identity: what the work is and who it belongs to. The four badges are split into three tiers.
 * Previously the type, adult, private, and `My story` badges were same-size pills in one row, and the
 * filled `My story` badge drew the most attention, so the least important fact was the largest.
 * - State (`Adult`, `Private`): colored, above the title, since it changes what to expect from the
 *   content.
 * - Classification (`Orientation`): quiet text on the byline line.
 * - Context (`My story`): quietest, on the same line, since it depends on the viewer.
 *
 * Nothing is hidden; only the competition for attention is reduced. Other attributes (prompt
 * protection, size, dates, author label) are not added as pills, which would flatten the hierarchy
 * again.
 */
function StoryIdentity({
	story,
	viewer,
}: {
	story: Story;
	viewer: Viewer | null;
}) {
	const { t } = useTranslation("story");
	const orientation = story.orientation
		? orientationLabel(story.orientation)
		: null;
	/*
	 * Ownership marking is a display judgment; edit and delete permissions are decided by the server.
	 * This only tells the viewer their own works apart from others'.
	 */
	const own = isOwnStory(story, viewer?.id ?? null);
	const visibilityLabel = visibilityBadgeLabel(story.visibility);

	return (
		<header className="flex flex-col gap-2">
			{/*
			 * If neither badge applies, the row is not rendered. An empty row would leave a gap
			 * above the title that differs per work, so the screen would jump when arriving from
			 * the gallery.
			 */}
			{(story.adult || visibilityLabel) && (
				<div className="flex flex-wrap items-center gap-1.5">
					{story.adult && <Badge variant="destructive">{adultBadge()}</Badge>}
					{/*
					 * Visibility status. Public works show no pill (`storyVisibilityBadgeLabel` returns
					 * null). Link-shared works show it partly for visitors who arrived by link: they
					 * cannot find the work in the gallery and would otherwise read the missing listing as
					 * a fault. The pill sits after the adult badge and is less emphasized, since the
					 * content grade is the heaviest item in this row.
					 */}
					{visibilityLabel && (
						<Badge variant="secondary">{visibilityLabel}</Badge>
					)}
				</div>
			)}

			{/*
			 * `break-words` is not decoration. Titles are creator-written, and an unbroken
			 * 60-character run can occur. Without the class it widens the whole document, causing
			 * horizontal scrolling at every width, not just a clipped title. Description
			 * paragraphs use it for the same reason.
			 */}
			<h1 className="text-2xl font-black tracking-tight text-balance break-words md:text-3xl">
				{story.title}
			</h1>

			{/*
			 * One identity line: the creator, then the classification and context, which all
			 * answer "what is this work." Splitting them would widen the gap between the title
			 * and the primary action. The middle dots are aria-hidden, so screen readers read the
			 * three pieces as one phrase.
			 */}
			<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
				{/*
				 * The byline links to the account's public profile, the main profile discovery path
				 * in V1. The free-text author field is not tied to an account and is not linked; the
				 * property table states it separately. Removing the link for a withdrawn account is
				 * handled by that component. Text size and color are inherited so the classification
				 * and context read on the same line.
				 */}
				<StoryByline story={story} />
				{orientation && (
					<>
						<Dot />
						<span>{orientation}</span>
					</>
				)}
				{own && (
					<>
						<Dot />
						<span>{t("mine")}</span>
					</>
				)}
			</div>
		</header>
	);
}

const Dot = (): ReactNode => (
	<span aria-hidden="true" className="text-muted-foreground/50">
		·
	</span>
);

/**
 * The actions row has two weight levels, not three: one filled primary button (`Start conversation`) and
 * everything else. On narrow screens only the primary action takes the full width, where the thumb
 * reaches. Stacking every action at 390px would push the description down three lines, and the
 * report trigger is a single ellipsis, so most of its row would be empty. Share is not drawn as a
 * filled button, because this screen recommends one thing.
 */
function StoryActions({
	story,
	viewer,
	favorited,
}: {
	story: Story;
	viewer: Viewer | null;
	favorited: boolean;
}) {
	const { t } = useTranslation("story");
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
			{/*
			 * The play snapshot is requested only when this button is pressed. Rendering the
			 * component sends no request, so the detail page's SSR and prefetch stay light.
			 */}
			<StoryStartControl story={story} viewer={viewer} />
			{/*
			 * `sm:contents` makes this wrapper disappear on wide screens, so its children become
			 * siblings of the outer flex. The report control's `sm:ml-auto` then pushes it to the
			 * end of the row, without defining the layout twice.
			 */}
			<div className="flex items-center justify-between gap-4 sm:contents">
				<FavoriteControl
					story={story}
					favorited={favorited}
					viewer={viewer}
					size="md"
				/>
				{/*
				 * Share sits next to favorite, not at the end of the row: both are ordinary actions
				 * available now for this work. The end of the row is reserved for report, which is
				 * needed only when something is wrong. Nothing is drawn for a work that cannot be
				 * shared, since an inactive icon would hold a spot without saying what it does
				 * (`share-control.tsx`).
				 */}
				<StoryShareControl story={story} />
				{/*
				 * Report sits at the end of the row (`sm:ml-auto`). With the same weight as start and
				 * favorite it would suggest the screen recommends three things. Report is sought only
				 * when something is wrong, so it sits behind a menu.
				 */}
				<div className="sm:ml-auto">
					<ReportMenu
						target={{ type: "story", storyId: story.id }}
						targetLabel={t("reportTarget")}
						viewer={viewer}
						ownerId={story.creator?.id ?? null}
						triggerLabel={t("reportMenu")}
					/>
				</div>
			</div>
		</div>
	);
}

function StoryDescription({ description }: { description: string }) {
	const { t } = useTranslation("story");
	const text = description.trim();
	return (
		<section aria-label={t("descriptionLabel")}>
			{text ? (
				/*
				 * Line breaks come from the creator and are kept; collapsing them would erase the paragraph
				 * structure. The width is capped at a reading measure: at 740px a Korean line runs past 50
				 * characters, and the start of the next line is hard to find. The text is not truncated, since
				 * this is the only screen that shows all of it. `break-words` keeps long unbroken URLs from
				 * causing horizontal scrolling.
				 */
				<p className="max-w-2xl text-[0.9375rem] leading-7 break-words whitespace-pre-wrap">
					{text}
				</p>
			) : (
				<p className="text-sm text-muted-foreground">{t("noDescription")}</p>
			)}
		</section>
	);
}

/**
 * Tags are drawn in full, since this screen exists to read the whole work. They are lowered in
 * weight so they do not become the most prominent thing on the screen. Each tag is capped at 40
 * characters (`STORY_PUBLISH_LIMITS.tag`). The tag badge does not shrink or wrap by default, so one
 * 40-character Korean tag overflows a 320px screen (measured in the browser: scrollWidth 331,
 * clientWidth 320).
 *
 * Tags wrap rather than truncate, because a truncated tag cannot show what the word was on the full
 * view; the preview truncates instead (`story-preview-dialog.tsx`). Tags use `wrap-anywhere`, not
 * `keep-all`: a tag is a single word with no break points, and `keep-all` would leave only the `#`
 * on the first line and clip the rest. This was checked in the browser and reverted.
 */
/**
 * A tag is a link to discovery narrowed to that tag. The address is `/?tag=…`, not the search box:
 * search is a partial match, so `night` would also match `rewinding night`, while the tag axis matches only the
 * exact creator-chosen word (`GalleryFilters.tag`). No other filters are carried over, since a user
 * pressing a tag expects all works with it.
 */
function StoryTags({ tags }: { tags: string[] }) {
	const { t } = useTranslation("story");
	return (
		<section aria-label={t("tagsLabel")} className="flex flex-wrap gap-1.5">
			{tags.map((tag) => (
				<Badge
					key={tag}
					variant="secondary"
					className="h-auto min-h-5 max-w-full wrap-anywhere whitespace-normal font-normal text-muted-foreground hover:text-foreground"
					render={
						<Link
							to="/"
							search={{ tag }}
							aria-label={t("findByTag", { tag })}
						/>
					}
				>
					#{tag}
				</Badge>
			))}
		</section>
	);
}
