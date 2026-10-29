import type { Story, StoryPlayMode, Viewer } from "@rowcat/domain";
import { storyStartGlyph } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import type { LucideIcon } from "lucide-react";
import { MessageCircle, Play } from "lucide-react";
import { translator } from "#/lib/i18n/current.ts";
import { startLabel as vocabStartLabel } from "#/lib/i18n/vocab.ts";
import { startFailureMessage, useStoryStart } from "./use-story-start.tsx";

/**
 * The primary action of the detail screen: `Start conversation`, or `Play` for runtime works. The procedure
 * (guest handling, double-start prevention, failure branches) lives in `useStoryStart`; this file
 * decides only the weight: a large button across the body width with a one-line failure message
 * below. The gallery preview's `Start` uses the same hook at a different size.
 *
 * It used to be `Start conversation` or `Own for 500 churu`. Since works are no longer collectible, anyone can start a
 * visible work, so there is no other axis to wait on, such as personalization or subscription.
 * Playback permission is decided solely by the server's playback gate.
 */
export function StoryStartControl({
	story,
	viewer,
}: {
	story: Story;
	viewer: Viewer | null;
}) {
	const { pending, failure, start, dialog } = useStoryStart({ story, viewer });

	return (
		<div className="flex flex-col gap-1.5 sm:w-auto">
			<Button
				size="lg"
				/*
				 * On narrow screens the button takes the full width, as the thumb-reach primary action. From
				 * `sm` up it returns to its content width, because a full-width band on desktop reads as a
				 * plain rectangle rather than emphasis.
				 */
				className="w-full sm:w-auto sm:px-6"
				disabled={pending}
				onClick={start}
			>
				{/*
				 * The glyph promises what the press does. The decision is the domain's `storyStartGlyph`
				 * alone, and the mobile app calls the same function.
				 */}
				<StartGlyph playMode={story.playMode} />

				{storyStartLabel({
					pending,
					/**
					 * The label comes from the domain table `STORY_START_LABEL`. A ternary here would show an old
					 * word when play modes grow. The table is a `Record`, so adding a value breaks compilation
					 * until its label exists.
					 */
					startLabel: vocabStartLabel(story.playMode),
				})}
			</Button>
			{failure && (
				<output className="text-xs text-destructive">
					{startFailureMessage(failure)}
				</output>
			)}
			{/*
			 * The persona dialog is owned by the hook and rendered once, here. If each start location
			 * drew it, the two procedures would diverge.
			 */}
			{dialog}
		</div>
	);
}

/**
 * The domain chooses the glyph and this component draws it. Both start locations use this
 * component; if each chose its own glyph, the same work would show different glyphs in the list and
 * on the detail screen. The table is a `Record`, so new values break compilation here instead of
 * silently rendering no glyph.
 */
export function StartGlyph({ playMode }: { playMode: StoryPlayMode }) {
	const Glyph = START_GLYPH[storyStartGlyph(playMode)];
	return <Glyph aria-hidden="true" />;
}

const START_GLYPH = {
	chat: MessageCircle,
	play: Play,
} satisfies Record<ReturnType<typeof storyStartGlyph>, LucideIcon>;

/**
 * Both start locations use this function. While pending it shows the progress text; otherwise it
 * shows the location's word, `Start conversation` on the detail screen or `Start` in the preview. A separate
 * function per location would duplicate the pending text.
 */
export function storyStartLabel({
	pending,
	startLabel = vocabStartLabel("chat"),
}: {
	pending: boolean;
	startLabel?: string;
}): string {
	return pending ? translator("story")("starting") : startLabel;
}
