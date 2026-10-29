import { Redirect, useLocalSearchParams } from "expo-router";
import { CreatorProfileScreen } from "../../features/profile/creator-profile-screen.tsx";

/**
 * Public profile: the address carries identity. No shadow state like `selectedCreator`; with the
 * route parameter as the source, deep links, back and stack restoration follow for free (same rule
 * as story detail). The profile object is not a parameter (direct entry has none, and a copy goes
 * stale as follower counts change).
 *
 * The identity is the member id, not the nickname: a display name has no uniqueness or change
 * limit, so building addresses from it would let a rename break saved links (`PublicProfile.id`
 * carries that reason).
 */
export default function CreatorRoute() {
	const { creatorId } = useLocalSearchParams<{
		creatorId?: string | string[];
	}>();
	/** A repeated key arrives as an array (hand-edited deep link); use the first value. */
	const id = Array.isArray(creatorId) ? creatorId[0] : creatorId;

	/**
	 * An address with no id should not reach this route; if it does it is not a profile. Go back to
	 * discovery instead of sending a query that returns 404, since "not found" is the server's verdict
	 * and here we cannot even build the request.
	 */
	if (!id) return <Redirect href="/" />;

	/**
	 * Remount when identity changes. Every current entry is a `push` (work byline, discovery card
	 * byline, comment author) and login return is `replace`, so each makes a new screen key and this
	 * line does nothing today. It stays because that guarantee depends on the caller's navigation
	 * verb: with `router.navigate` expo-router reuses the same-named screen and swaps only params, and
	 * the next profile would inherit the previous one's confirm dialog and failure text
	 * (`useBlockCreator` state is local React state). That regression passes compile and tests.
	 *
	 * Server state is unaffected: profile and works live in cache cells keyed by id (`profile.ts` in
	 * `@rowcat/query`), so only transient UI state is rebuilt.
	 */
	return <CreatorProfileScreen key={id} creatorId={id} />;
}
