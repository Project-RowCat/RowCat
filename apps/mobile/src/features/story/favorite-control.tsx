import { space } from "@rowcat/design";
import type { Story } from "@rowcat/domain";
import { favoriteMutationOptions } from "@rowcat/query";
import { controlHeight, Icon, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatCount } from "../../lib/format.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import { viewerAction } from "../../lib/viewer-action.ts";

/**
 * The heart and its total. Shared by the gallery card and the work detail.
 *
 * **The optimistic-update rule is not here.** This component sends one thing, "the next state I
 * want", and which caches change and how (all loaded gallery pages, the detail, personalization,
 * the total, rollback) is decided by `favoriteMutationOptions` in `@rowcat/query`, the **same
 * function** web uses. A mobile-only optimistic path would be a second copy of the rule, and
 * changing one side would leave the total different from screen to screen.
 *
 * The total is a public aggregate shipped with the work; whether to fill the heart is membership
 * from `/me/state`. The two values come from different places on purpose: embedding the relation in
 * the work would make the same work differ per person.
 *
 * ## The four branches each do something different
 *
 * ```text
 * allowed      sends the request
 * sign-in      goes to sign-in, **carrying the return location**
 * restricted   blocks and says why (the server would refuse anyway)
 * unavailable  goes nowhere and sends nothing
 * ```
 *
 * The fourth branch is the point of this file. Folding an unverified identity into guest would show
 * a signed-in person the sign-in screen on a heart press, which reads as "you were signed out".
 * Folding it into member would send an authenticated write on an unconfirmed session, which fails
 * with a 401. The verdict belongs to `viewerAction` alone (comment writing uses the same function).
 *
 * ## The heart moved from a glyph to an icon
 *
 * It used to be the `♥`/`♡` characters. Those **differ in shape and size per font**, and on Android
 * they fall back to the emoji font and can draw a colored heart. On a control that says on/off with
 * color, that is fatal. It is now the **same picture** as web (both use Lucide `Heart`).
 *
 * "On" is said by three things together: color (`destructive`), the **fill**, and
 * `accessibilityState.selected`. The middle one is the same axis as web's `fill-current`, and the
 * last is the only **required** one: the fill survives as shape for people who cannot tell colors
 * apart, but stating the state is still the accessibility axis. People who lose the fill should
 * lose nothing.
 */
export function FavoriteControl({
	story,
	favorited,
	returnPath,
	size = "sm",
}: {
	story: Story;
	/** Membership from `/me/state`; it comes from the viewer axis, not the work object. */
	favorited: boolean;
	/** In-app path a guest returns to after signing in. */
	returnPath: string;
	size?: "sm" | "md";
}) {
	const identity = useMobileIdentity();
	const queryClient = useQueryClient();
	const router = useRouter();
	const mutation = useMutation(
		favoriteMutationOptions(getRowCatClient(), queryClient, story.id),
	);

	const action = viewerAction(identity.session);
	const blocked = action !== "allowed" && action !== "sign-in";
	// Lock while in flight so the same button cannot fire twice (mutations also queue per work).
	const disabled = mutation.isPending || blocked;

	const press = () => {
		if (action === "sign-in") {
			/**
			 * A guest's tap goes to sign-in, not to a request. Guidance shown only after a 401 would make
			 * the user suffer one failure before learning the next step. (The server still refuses; this is
			 * guidance, not defense.)
			 *
			 * The current location rides along, so after signing in the user returns to the screen they
			 * tapped from.
			 */
			router.push({ pathname: "/login", params: { redirect: returnPath } });
			return;
		}
		if (disabled) return;
		// Send the **desired next state**, not a toggle, so a retry cannot change the outcome.
		mutation.mutate(!favorited);
	};

	return (
		<View style={favorite.row}>
			{/**
			 * A failure is shown beside the heart. We do not build a toast system for this one feature; this
			 * spot says more clearly which work failed. The response body is not included.
			 */}
			{mutation.isError ? (
				<Text
					accessibilityRole="alert"
					variant="caption"
					tone="destructive"
					numberOfLines={1}
				>
					Couldn't save
				</Text>
			) : null}
			{action === "restricted" ? (
				<Text variant="caption" tone="muted-foreground" numberOfLines={1}>
					This account is restricted
				</Text>
			) : null}

			<Pressable
				accessibilityRole="button"
				accessibilityLabel={
					favorited ? "Remove from favorites" : "Add to favorites"
				}
				accessibilityState={{
					disabled,
					busy: mutation.isPending,
					/** On/off is stated through the state, not color alone. */
					selected: favorited,
				}}
				disabled={disabled}
				onPress={press}
				/**
				 * The visual size is small but the target is 44pt. To keep a heart at the bottom of a card from
				 * leaking into the next card while still being easy to hit, those two must be separate.
				 */
				hitSlop={(controlHeight.md - controlHeight.sm) / 2}
				style={[favorite.button, disabled && favorite.blocked]}
			>
				<Icon
					name="favorite"
					size={size === "md" ? "lg" : "md"}
					/** On is emphasis, not a destructive color: the same red as web's filled heart. */
					tone={favorited ? "destructive" : "muted-foreground"}
					filled={favorited}
				/>
				{/**
				 * The color is chosen through `tone`. This spot used to override it with `style={{ color: ... : undefined }}`,
				 * but React Native's style merge **treats `undefined` as a value**: if the last object has
				 * `color: undefined`, the color chosen earlier is erased and the platform default (black) remains.
				 * On the light theme that black looked plausible so nobody noticed; **the count only vanished on the dark theme.**
				 */}
				{/**
				 * The count **rolls in place**, only at the digits that changed. Pressing the heart moves this
				 * value up or down by 1 (the correction is the absolute value the server returns); if that change
				 * were applied silently, the only sign that the press took effect would be the heart's color.
				 *
				 * A value arriving for the first time does not roll: that is the arrival of content, not a change
				 * of value (`lib/motion/animated-count.tsx`).
				 *
				 * `readable={false}` because this `Pressable` **already has its own name** (`Add to favorites`·`Remove from favorites`).
				 * The pressable's name covers its children, so emitting the count again would only add an unread
				 * letter to the tree.
				 */}
				<AnimatedCount
					value={formatCount(story.favorites)}
					variant={size === "md" ? "label" : "caption"}
					tone={favorited ? "destructive" : "muted-foreground"}
					readable={false}
				/>
			</Pressable>
		</View>
	);
}

const favorite = StyleSheet.create({
	row: { alignItems: "center", flexDirection: "row", gap: space.sm },
	/** 5 is off the spacing scale: the heart and its count must read as one word (`sm` would read as two). */
	button: {
		alignItems: "center",
		flexDirection: "row",
		gap: 5,
		minHeight: controlHeight.sm,
		paddingHorizontal: space.xs,
	},
	blocked: { opacity: 0.5 },
});
