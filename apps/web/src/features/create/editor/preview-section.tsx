import type { StoryDraft } from "@rowcat/authoring";
import type { Viewer } from "@rowcat/domain";
import { Card, CardContent } from "@rowcat/ui-web/components/card";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StoryCardBody } from "#/features/gallery/story-card-body.tsx";
import { useDraftCoverUrl } from "../cover/use-url.ts";
import { draftCardView } from "../drafts/card-view.ts";
import { EditorSection } from "./fields.tsx";

/**
 * The gallery preview: how the card will look after publishing. It depicts rather than controls.
 * Gallery cards open a preview and have a heart, but this unpublished draft has nothing to open or
 * favorite. So the card is pointer-events-none and aria-hidden, and the heart row is drawn as a
 * static picture rather than a button. Leaving out a live button is deliberate, because a button
 * promises an action this screen cannot complete.
 *
 * The section is silent for screen-reader users on purpose: the values on the card (title, tags,
 * tone, adult flag, cover) are already read by the inputs above. It is not a route tab, because the
 * `/create` tabs are tied to the URL and this preview belongs to the draft, not the workspace. It
 * is not an editor mode either, since the point is to watch the result move as values are edited.
 */

/** The width one gallery card takes in the grid (four columns at 1280px and above). */
const CARD_WIDTH_CLASS = "w-[236px]";

export function DraftPreviewSection({
	draft,
	viewer,
}: {
	draft: StoryDraft;
	/**
	 * Source of the name shown in the byline. If the viewer has not loaded yet, the spot stays empty
	 * rather than inventing a name.
	 */
	viewer: Viewer | null;
}) {
	const { t } = useTranslation(["create", "common"]);
	const cover = useDraftCoverUrl(draft);
	const view = draftCardView(draft, { coverUrl: cover.url, viewer });

	return (
		<EditorSection
			title={t("previewSection.preview")}
			description={t("previewSection.thisIsHowItAppears")}
			/**
			 * A fixed value, because this section's structure does not change. Text changing inside the card
			 * is typing, not relayout; passing its height would make the sections below slide down 0.5
			 * seconds after typing stops. The basic info section signals only its tag count, the one
			 * structural change, for the same reason.
			 */
			layoutDependency={false}
		>
			<div className={CARD_WIDTH_CLASS}>
				{cover.loading ? (
					/*
					 * The cover file has not arrived on this device yet. An empty card drawn first would show a
					 * placeholder that then turns into the chosen picture, and the flicker reads as "did the cover
					 * disappear?" The geometry matches the card.
					 */
					<Skeleton className="aspect-3/4 w-full rounded-xl" />
				) : (
					<Card
						size="sm"
						aria-hidden="true"
						className="pointer-events-none gap-0 py-0 select-none"
					>
						{/*
						 * The same component the gallery uses (features/gallery/story-card-body.tsx). A hand-drawn copy
						 * would
						 * go stale when the gallery changes its tag count or title line clamping, and the creator would
						 * learn
						 * only after publishing that a word they expected to see had been cut off.
						 */}
						<StoryCardBody view={view} />
						{/*
						 * The heart row is drawn only to keep the card's height and balance the same as the real card. The
						 * count is omitted rather than shown as 0: the work does not exist yet, so there is no favorite
						 * count,
						 * and writing 0 would pretend to know a value. The analytics screen after publishing follows the
						 * same
						 * rule.
						 */}
						<CardContent className="mt-auto pt-2 pb-2.5">
							<div className="flex justify-end text-muted-foreground/50">
								<Heart className="size-4" />
							</div>
						</CardContent>
					</Card>
				)}
			</div>

			{/*
			 * The cover field already says it is stored only on this device, so this line adds only that the
			 * preview uses that file. Without it, a creator opening the draft on another device could be
			 * puzzled
			 * by `the preview had a cover a moment ago`.
			 */}
			{cover.staged && (
				<p className="text-xs text-muted-foreground">
					{t("previewSection.drawnWithACoverThat")}
				</p>
			)}

			{/*
			 * An empty title leaves an empty space on the card, which is the accurate signal. The reason is
			 * still
			 * stated, because publishing requires a title and that rejection only appears at the publish
			 * button.
			 */}
			{!view.title && (
				<p className="text-xs text-muted-foreground">
					{t("previewSection.enterATitleToSee")}
				</p>
			)}
		</EditorSection>
	);
}
