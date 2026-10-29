import { space } from "@rowcat/design";
import type { Story } from "@rowcat/domain";
import { controlHeight, Icon, Text, targetSlop } from "@rowcat/ui-native";
import { useCallback, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { WEB_ORIGIN } from "../../lib/env.ts";
import {
	STORY_SHARE_FAILURE,
	STORY_SHARE_LABEL,
	storySharePayload,
} from "./share-story.ts";

/**
 * The share trigger. **All it does is open the OS share sheet.**
 *
 * ## Why the platform's sheet
 *
 * This app does not draw the share targets as a list. Where to send something is a fact the
 * person's device knows (installed apps, recent contacts, system settings), and imitating that list
 * would always be narrower than the real one. **No dependency was added as a result**: RN core's
 * `Share` opens both platforms' sheets as they are, and no module needing a native rebuild was
 * added.
 *
 * ## This component does not decide
 *
 * What can be handed over, and what gets included, is answered by one pure function
 * (`share-story.ts`). What lives here is only the wiring that opens the sheet with that value, plus
 * one failure line. And **when nothing can be handed over, nothing is drawn**: a disabled button
 * would not say why it cannot be pressed, and the user has nothing to do at that spot (publishing a
 * private work publicly is an action in `Create`).
 *
 * ## Cancelling is not a failure
 *
 * `Share.share` finishes normally when the sheet is dismissed (`action: "dismissedAction"`). The
 * point is not to read that value: reading it and saying something would show guidance to someone
 * who changed their mind. Only a throw is kept, and even then no reason is written: the platform
 * error body answers no question, and that string is a value we do not control, so it is not drawn
 * on screen as is.
 *
 * The failure **stays in this spot**: a toast system is not built for this one action, and this
 * spot says more clearly what failed (`favorite-control.tsx` made the same call).
 *
 * ## It does not compete with the primary action
 *
 * An icon with no label. The primary action this screen suggests is **start a conversation** alone
 * (`story-start-control.tsx`); sharing sits in a second row with the same weight as favorite and
 * report. Another filled button would read as this screen suggesting two things.
 */
export function StoryShareControl({ story }: { story: Story }) {
	const payload = storySharePayload(story, WEB_ORIGIN);
	/**
	 * The failure is this component's local state. It lives in neither the query cache nor a global:
	 * moving to another work remounts this component wholesale, so that fact disappears on its own.
	 */
	const [failed, setFailed] = useState(false);

	const share = useCallback(async () => {
		if (!payload) return;
		setFailed(false);
		try {
			/**
			 * Passes `url` and `title` **in exactly the shape the platform understands** (see the
			 * `share-story.ts` header). Joining them into one string would make iOS's preview card
			 * disappear.
			 */
			await Share.share({ title: payload.title, url: payload.url });
		} catch {
			setFailed(true);
		}
	}, [payload]);

	if (!payload) return null;

	return (
		<View style={share_.row}>
			{failed ? (
				<Text
					accessibilityRole="alert"
					variant="caption"
					tone="destructive"
					numberOfLines={1}
				>
					{STORY_SHARE_FAILURE}
				</Text>
			) : null}
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={STORY_SHARE_LABEL}
				onPress={() => void share()}
				/** The visible box is small and the target is 44; same rule as the heart and report beside it. */
				hitSlop={targetSlop(controlHeight.md)}
				style={share_.button}
			>
				<Icon name="share" size="md" tone="muted-foreground" />
			</Pressable>
		</View>
	);
}

const share_ = StyleSheet.create({
	row: { alignItems: "center", flexDirection: "row", gap: space.sm },
	button: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: controlHeight.md,
		minWidth: controlHeight.md,
	},
});
