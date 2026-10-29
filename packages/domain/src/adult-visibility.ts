import { isAdultEligible, isChildViewer, type Viewer } from "./viewer.ts";

/**
 * Screen state for the adult-content display setting: the three axes folded into one pure function.
 * It moved here from apps/web/src/features/account/adult-visibility.ts when the mobile account
 * screen became a second consumer.
 *
 * If each app folded the axes itself, one side could merge 'verified but a minor' with 'not
 * verified at all', and that mismatch only shows when the two screens are compared side by side.
 * Copy, containers and controls stay per-app.
 *
 * The three axes produce only one visible switch, so writing the conditions inline would fold some
 * away. The unverified and minor cases allow different user actions, and where neither can act the
 * reasons still differ. Erasing the reason would make the copy false.
 *
 * Member state (suspended, banned) is deliberately not an input. The server accepts display-off
 * requests from restricted accounts (`requireViewer`, not `requireActiveViewer`), and locking the
 * switch here would make the screen stricter than the server. This is a display-layer judgment; the
 * server (`gates.ts`) is the final authority.
 */
export type AdultVisibilityState =
	/**
	 * Under-14 account, decided before identity verification. The order is the rule: telling a child
	 * `you can set this after completing identity verification` is false, and
	 * following that guidance leads to a procedure that does not exist. It is also distinct from
	 * `minor` (under 19). Time resolves that case, while turning 14 only lifts the child restriction
	 * and grants no adult eligibility.
	 */
	| { kind: "child" }
	/**
	 * Identity verification has not been done. The web account screen places the action that starts it
	 * here.
	 */
	| { kind: "unverified" }
	/**
	 * Identity verified but under 19. Age cannot be changed by the user. Keeping this apart from
	 * `unverified` splits the actions as well as the copy: here the re-verification path quietly
	 * applies (the server stores no birth date, so turning 19 does not open access on its own), while
	 * there the verification path is offered.
	 */
	| { kind: "minor" }
	/**
	 * Eligible to turn on. `showAdult` is the current setting, and it can be flipped either way.
	 * `recheckRequired` is the server's judgment that the last adult verification is over one year old
	 * (`adult-recheck.ts`). It is not a separate kind, because eligibility is unchanged and the
	 * setting stays changeable. Splitting kinds would create a second branch that draws the switch,
	 * and one would eventually lock. The screen uses the flag to place `it shows only after re-verification`
	 * and the verify action beside the switch.
	 */
	| { kind: "eligible"; showAdult: boolean; recheckRequired: boolean };

/**
 * Viewer to adult-content screen state. A guest (null) is `unverified`. The account screen requires
 * sign-in, so this should not occur in practice. While the viewer is still loading, a switch
 * briefly drawn as on is the worse failure.
 */
export function adultVisibilityState(
	viewer: Viewer | null,
): AdultVisibilityState {
	/**
	 * The child check comes first. `isAdultEligible` already excludes children, so the switch would
	 * stay locked without this line. But the screen would then show the `minor` copy, which is true
	 * yet does not describe this person. A child with `verified` off would be told `after completing identity
	 * verification`, which is false.
	 */
	if (isChildViewer(viewer)) return { kind: "child" };
	if (!viewer?.verified) return { kind: "unverified" };
	if (!isAdultEligible(viewer)) return { kind: "minor" };
	return {
		kind: "eligible",
		showAdult: viewer.showAdult,
		recheckRequired: viewer.adultRecheckRequired,
	};
}
