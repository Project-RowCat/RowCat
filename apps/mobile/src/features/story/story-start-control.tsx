import { space } from "@rowcat/design";
import { type Story, storyStartGlyph } from "@rowcat/domain";
import { Button, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import type { ViewerAction } from "../../lib/viewer-action.ts";
import { storyStartLabel } from "./story-start-copy.ts";
import { useStoryStart } from "./use-story-start.tsx";

/**
 * The work detail's primary action — **start a conversation** (or, for a runtime work, play).
 *
 * This component owns only the layout. The order of steps belongs to `startStoryChat`, identity
 * decisions to `lib/viewer-action.ts`, and the words and pictures to the tables in
 * `@rowcat/domain`.
 *
 * ## Drawn for guests too
 *
 * Same call as favourites. Instead of drawing a button that does nothing or hiding it, pressing it
 * sends the guest to sign in, carrying the return path.
 *
 * ## It does not lock based on whether storage is open
 *
 * The public screen does not wait for device files (see that section of `README.md`). Storage is
 * needed only after the press, and the hook **waits** at that point — so even the first press right
 * after launching the app succeeds.
 */
export function StoryStartControl({
	story,
	action,
	returnPath,
}: {
	story: Story;
	action: ViewerAction;
	returnPath: string;
}) {
	const start = useStoryStart({ story, action, returnPath });

	return (
		<View style={control.box}>
			<Button
				label={storyStartLabel(
					start.pending,
					/** The words are decided by the domain table — the screen does not write a ternary. */
					story.playMode,
				)}
				/**
				 * The picture is also decided by **the domain table** (`storyStartGlyph`) — the web's
				 * same-named function calls the same thing.
				 *
				 * For a while this slot was fixed to one speech bubble, and the comment beside it said "the web
				 * also uses the same `MessageCircle`". The day the web added the runtime branch that sentence
				 * stopped being true, but compilation and tests still passed — a runtime work's `Play` stood
				 * with a speech bubble on this app alone, a mismatch visible only when the two screens are
				 * compared side by side.
				 */
				icon={storyStartGlyph(story.playMode)}
				onPress={start.start}
				busy={start.pending}
				/**
				 * This is the screen's **primary action**, so it fills the row — the same claim as this button
				 * being the most prominent one on the web detail. Favourites sit quietly beneath it.
				 */
				fullWidth
				size="lg"
				/**
				 * Locked while identity cannot be verified. Presses in that state do nothing
				 * (`use-story-start.tsx`), so there is no button that pretends to be pressable.
				 */
				disabled={action === "unverified"}
			/>
			{action === "unverified" ? (
				<Text variant="caption" tone="muted-foreground">
					Checking your session.
				</Text>
			) : null}
			{/**
			 * A failure ends inside this section — the work and the comments stay as they are. The `alert`
			 * role is there because the **action the user started** failed (this is the axis that separates
			 * it from guidance).
			 */}
			{start.failure ? (
				<Text accessibilityRole="alert" variant="label" tone="destructive">
					{start.failure}
				</Text>
			) : null}
			{/**
			 * The dialog where the role is picked before starting — **its lifetime belongs to the hook.** If
			 * this component opened it with its own state, "when it opens" and "where the picked value goes"
			 * would split across two places, and a path that creates the room first would become possible
			 * in between.
			 */}
			{start.dialog}
		</View>
	);
}

const control = StyleSheet.create({
	box: { gap: space.sm },
});
