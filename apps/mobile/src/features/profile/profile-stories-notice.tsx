import { EmptyState, ErrorState, Notice, Spinner } from "@rowcat/ui-native";
import type { ProfileStoriesState } from "./profile-stories-state.ts";

/**
 * Shown when the works slot has no list. Blocked and empty carry different sentences.
 *
 * This component exists for that reason. The server returns zero works for a blocked creator, so
 * the two states have the same data. Drawn with the same copy, the blocker would think the creator
 * has posted nothing, with no way to learn why the screen is empty. The ordering decision lives in
 * a pure function (`profile-stories-state.ts`).
 *
 * The blocked state has no unblock button. The block action lives only in the header's overflow
 * menu; a second copy would let the two diverge (one pending, the other not) and the screen would
 * contradict itself. So the copy points at that menu.
 *
 * The empty state has no next action. The web offers `Go to Create` to owners, but this app has no
 * creation screen, and a button that does nothing promises something that cannot be kept. The
 * screen also does not state draft or private counts, which a public profile cannot answer.
 */
export function ProfileStoriesNotice({
	state,
	onRetry,
}: {
	state: ProfileStoriesState;
	onRetry: () => void;
}) {
	if (state === "loading") return <Spinner />;

	if (state === "offline")
		return (
			<Notice message="You're not connected to a network, so stories couldn't be loaded." />
		);

	/** A works failure ends inside this section. The name and face remain. */
	if (state === "failed")
		return (
			<ErrorState
				message="Couldn't load stories."
				actionLabel="Try again"
				onAction={onRetry}
			/>
		);

	if (state === "blocked")
		return (
			<EmptyState
				icon="block"
				title="You've blocked this creator"
				/**
				 * Only what actually happens is stated. A sentence such as "they cannot see you" is a promise
				 * the server does not make, and promising more privacy than exists puts people who act on it at
				 * risk.
				 */
				description="This creator's works and comments won't appear on your screen. You can unblock them from the menu above."
			/>
		);

	if (state === "empty")
		return <EmptyState icon="library" title="No public works yet" />;

	/** The list speaks for itself. */
	return null;
}
