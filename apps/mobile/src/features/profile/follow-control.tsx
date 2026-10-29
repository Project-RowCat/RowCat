import { space } from "@rowcat/design";
import { followMutationOptions } from "@rowcat/query";
import { Button, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import type { ViewerAction } from "../../lib/viewer-action.ts";
import { followErrorMessage } from "./social-error.ts";

/**
 * Follow button — the public profile's.
 *
 * **The optimistic-update rules are not here.** This component sends only one thing, "the next
 * desired state", and which caches change and how (the following array in personalization, the
 * follower total in the profile, rollback, correction to the absolute value from the server,
 * per-creator serialization) is decided by `followMutationOptions` in `@rowcat/query` — the **same
 * function** as on the web. Mobile-only optimistic logic would become a second copy of the rule,
 * and fixing only one side would make the follower count differ per screen.
 *
 * **This component does not draw the follower count.** That value is an aggregate carried on the
 * public profile, so the profile header owns it. Only the relation lives here — if the button held
 * the number too, the same value would be updated separately in two places. The absence of
 * arithmetic such as `profile.followers + 1` in this file is the expression of that boundary.
 *
 * ## Four cells do different things
 *
 * ```text
 * allowed      sends the request
 * sign-in      goes to login — **carrying the return place**
 * restricted   blocks, and says why (the server rejects it anyway)
 * unverified   goes nowhere and sends nothing
 * ```
 *
 * The fourth cell is the point. Folding an unconfirmed identity into guest would make a person with
 * a live session see the login screen when they press follow, which reads as a "you have been
 * signed out" notice. The decision is held by one function, `viewerAction` (hearts and comments use
 * the same function).
 */
export function FollowControl({
	creatorId,
	creatorName,
	following,
	action,
	returnPath,
}: {
	creatorId: string;
	/** Goes into the name label. A person who cannot see the screen gets no target from "follow" alone. */
	creatorName: string;
	/** The relation from `/me/state`. It comes from the viewer axis, not the profile object. */
	following: boolean;
	action: ViewerAction;
	/** The in-app path a guest returns to after login — this profile itself. */
	returnPath: string;
}) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const mutation = useMutation(
		followMutationOptions(getRowCatClient(), queryClient, creatorId),
	);

	const blocked = action !== "allowed" && action !== "sign-in";
	/**
	 * Locked while in flight. We do not build a second lock — the mutation already queues per creator
	 * (`scope`), so what is left here is only interaction quality: stopping the same finger from
	 * pressing the same button twice.
	 */
	const disabled = mutation.isPending || blocked;

	return (
		<View style={follow.box}>
			<Button
				label={following ? "Following" : "Follow"}
				/**
				 * The two pictures the web's same button uses (`UserPlus` ↔ `UserMinus`). The on/off state is
				 * not said by color alone — the label and the picture both change.
				 */
				icon={following ? "follow-remove" : "follow-add"}
				variant={following ? "outline" : "primary"}
				/**
				 * The target goes into the name label. "Follow" alone would lose which person the button is
				 * for, for someone who cannot see the screen.
				 */
				accessibilityLabel={
					following ? `Unfollow ${creatorName}` : `Follow ${creatorName}`
				}
				busy={mutation.isPending}
				disabled={blocked}
				fullWidth
				onPress={() => {
					if (action === "sign-in") {
						/**
						 * A guest's tap goes to login, not to a request. Showing guidance only after a 401 would make
						 * the user experience a failure once before learning the next step. (The server still blocks
						 * it anyway — this is guidance here, not defense.)
						 *
						 * Because it carries the place they were looking at, after login they come back **to this
						 * profile.**
						 */
						router.push({
							pathname: "/login",
							params: { redirect: returnPath },
						});
						return;
					}
					if (disabled) return;
					// Sends the **desired next state**, not a flip — a retry does not change the result.
					mutation.mutate(!following);
				}}
			/>

			{action === "restricted" ? (
				<Text variant="caption" tone="muted-foreground">
					This account is restricted.
				</Text>
			) : null}
			{action === "unverified" ? (
				<Text variant="caption" tone="muted-foreground">
					Checking your session.
				</Text>
			) : null}

			{/**
			 * Failure stays **beside** the button. We do not set up a toast system for this one feature, and the wording that says why matters here — "a creator
			 * you blocked cannot be followed" is a rejection that has a next action (unblock).
			 *
			 * `alert` role because an operation **the user started** failed.
			 */}
			{mutation.isError ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="caption" tone="destructive">
						{followErrorMessage(mutation.error)}
					</Text>
				</FeedbackLine>
			) : null}
		</View>
	);
}

const follow = StyleSheet.create({
	box: { flex: 1, gap: space.xs, minWidth: 0 },
});
