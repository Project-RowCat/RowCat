import { space } from "@rowcat/design";
import {
	Button,
	ErrorState,
	Icon,
	Notice,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import type { ProfileState } from "./profile-state.ts";

/**
 * Renders the profile when it cannot be drawn. The four branches state different facts.
 *
 * ## A 404 does not state its reason
 *
 * The server answers a never-existed id and a deleted member with the same 404. If the screen
 * guessed the reason, the response would become an existence probe, and a deleted identity could be
 * re-confirmed by id. So the copy says only "no profile at this address now", and `ProfileState`
 * has no slot for a reason (the story detail made the same choice for the same reason).
 *
 * ## A missing profile has no `Try again`
 *
 * The same request gets the same 404, and a button would only suggest that pressing it enough times
 * might help. Instead the screen offers a way out. A profile can be reached straight from a deep
 * link, a comment or a byline, so there may be no history to go back to.
 */
export function ProfileUnavailable({
	state,
	onRetry,
	onLeave,
}: {
	/** Only the "no profile" kinds arrive. The caller has already split them, and the type records that. */
	state: Exclude<ProfileState, { kind: "profile" }>;
	onRetry: () => void;
	onLeave: () => void;
}) {
	if (state.kind === "loading") return <Spinner />;

	if (state.kind === "offline")
		return (
			<Notice message="You're not connected to a network. It continues automatically once connected." />
		);

	if (state.kind === "missing")
		return (
			/**
			 * This is a single fact, not a failure, so it is not an error box. It is not swapped to
			 * `EmptyState` because of the `alert` role: this screen answers the address the user opened, so
			 * it should be read on arrival (the story detail made the same decision).
			 */
			<View style={unavailable.missing}>
				<Icon name="profile-missing" size="2xl" tone="muted-foreground" />
				<Text accessibilityRole="alert" variant="title">
					Profile not found.
				</Text>
				<Text variant="label" tone="muted-foreground">
					This profile doesn't exist or can't be viewed right now.
				</Text>
				<Button label="Go to Discover" variant="outline" onPress={onLeave} />
			</View>
		);

	return (
		<ErrorState
			message="Couldn't load the profile."
			actionLabel="Try again"
			onAction={onRetry}
			/** Neither the stack nor the response body is attached. The request id is the only clue a user can carry. */
			detail={
				state.requestId ? (
					<Text variant="caption" tone="muted-foreground">
						Request ID: {state.requestId}
					</Text>
				) : null
			}
		/>
	);
}

const unavailable = StyleSheet.create({
	missing: { alignItems: "flex-start", gap: space.sm },
});
