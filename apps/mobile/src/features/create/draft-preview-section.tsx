import type { StoryDraft } from "@rowcat/authoring";
import { viewerQueryOptions } from "@rowcat/query";
import { Icon, Text } from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { StoryCardBody } from "../discover/story-card-body.tsx";
import { draftCardView } from "./draft-card-view.ts";
import { DRAFT_PREVIEW_SECTION } from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import { useDraftCoverUrl } from "./use-draft-cover-url.ts";

/**
 * Discovery-grid preview: how the card will look once published. Mirrors web's
 * `features/create/draft-preview-section.tsx` and draws with the grid's own `StoryCardBody`; a
 * hand-drawn copy would lie when the grid changes title line count or adds a badge.
 *
 * It is a picture, not an operation. The draft has no detail screen to open and no work to
 * favourite, so cover and title are not wrapped (`wrapMedia` returns them as-is) and the bottom row
 * is a drawing. Non-pressability is stated in two layers: `pointerEvents="none"` for fingers and
 * removal from the accessibility tree for assistive technology; without the latter the card still
 * reads, and one part looks pressable. The heart row stays for card height/balance but is drawn
 * without a count: an unpublished work's favourite count is an absent fact, not `0`.
 *
 * The cover is answered by the same hook as the cover field right above (`useDraftCoverUrl`): a
 * staged device file if any (what publication will upload), otherwise the server's current cover.
 * The two sit side by side on one screen and must not draw different pictures.
 */
export function DraftPreviewSection({ draft }: { draft: StoryDraft }) {
	/** Same hook as the cover field; separate decisions would diverge side by side. */
	const cover = useDraftCoverUrl(draft);

	/**
	 * Byline name: the grid draws the creator account's nickname, so the preview uses the signed-in
	 * member's. If not loaded yet, leave it blank rather than invent a name.
	 */
	const viewer = useQuery(viewerQueryOptions(getRowCatClient()));

	const view = draftCardView(draft, { coverUrl: cover.url });

	return (
		<EditorSection
			title={DRAFT_PREVIEW_SECTION.title}
			description={
				cover.staged
					? DRAFT_PREVIEW_SECTION.stagedDescription
					: DRAFT_PREVIEW_SECTION.description
			}
		>
			{/**
			 * Width of one card, not a grid cell. This sits inside a section, so the real cell
			 * width (half the screen) is set here; without it the card fills the section and the
			 * 3:4 cover grows to a screenful.
			 */}
			<View
				style={preview.card}
				pointerEvents="none"
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				<StoryCardBody
					view={view}
					/** Not wrapped, so "nothing to press" survives as the element kind. */
					wrapMedia={(media) => media}
					byline={
						<Text variant="caption" tone="muted-foreground" numberOfLines={1}>
							{viewer.data?.nickname ?? ""}
						</Text>
					}
					/**
					 * A drawing of the heart, deliberately without a count: writing `0` would promise "starts at 0
					 * once published", which we never made.
					 */
					action={<Icon name="favorite" size="md" tone="muted-foreground" />}
				/>
			</View>
		</EditorSection>
	);
}

const preview = StyleSheet.create({
	/**
	 * Same width as a real cell (`DISCOVER_CELL_WIDTH` is half the screen). That constant is not
	 * imported because it derives from the grid: if the grid went to three columns, a narrowing
	 * preview would preview the grid, not the card.
	 */
	card: { width: "50%" },
});
