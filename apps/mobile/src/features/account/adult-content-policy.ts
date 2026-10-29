import type { AdultVisibilityState } from "@rowcat/domain";

/**
 * Whether adult content *display* may be turned on on this platform; one pure function.
 *
 * Distinct from identity verification, which is the same on both platforms; store policy splits
 * only what that entitlement may show:
 *
 * ```text
 *              verification   turn on          turn off
 * iOS          native         **web only**     native
 * Android      native         two confirmations native
 * ```
 *
 * The App Store's UGC policy does not require an in-app path to *enable* mature user-generated
 * content, and keeping that opt-in on the website is this product's decision. Scattered as
 * `Platform.OS === "ios"` checks, a second place that turns display on would miss one, and that one
 * is the policy violation.
 *
 * Turning off is open on both platforms with no confirmation and no web detour: someone who already
 * turned it on and cannot turn it off is the worst cell in the table. Entitlement (child / unknown
 * / minor) is already decided by `@rowcat/domain`'s `adultVisibilityState`; re-assembling it here
 * would diverge from web.
 */

/**
 * Which platform. Not `Platform.OS` itself: the screen reads that global and passes a string, so
 * the rule is checkable without rendering and "iOS cannot turn on" can be locked by value.
 */
export type AdultContentPlatform =
	| "ios"
	| "android"
	| "web"
	| "windows"
	| "macos";

/**
 * The action this screen draws now. The way to enable is a closed vocabulary (`"native-confirm" |
 * "web-only"`), so a third way on iOS needs the vocabulary to grow and shows in review; a boolean
 * (`canEnable`) would let "how" vary per screen.
 */
export type AdultContentControl =
	/** No entitlement to turn on; the reason is already split by the entitlement decision. */
	| { kind: "ineligible"; reason: "child" | "unverified" | "minor" }
	/** Currently on; both platforms can turn it off natively. */
	| { kind: "on" }
	/** Currently off; how to turn it on differs per platform. */
	| { kind: "off"; enable: "native-confirm" | "web-only" };

export function adultContentControl(
	platform: AdultContentPlatform,
	state: AdultVisibilityState,
): AdultContentControl {
	if (state.kind !== "eligible")
		return { kind: "ineligible", reason: state.kind };
	if (state.showAdult) return { kind: "on" };
	/**
	 * `off -> on` does not exist on iOS in this app, and is not drawn as a disabled switch either: an
	 * unpressable switch reads as "coming soon", which is false here.
	 */
	return {
		kind: "off",
		enable: platform === "ios" ? "web-only" : "native-confirm",
	};
}
