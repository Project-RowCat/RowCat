import type { IdentityVerificationHandoff } from "@rowcat/contracts";

/**
 * Identity handoff: performs, in the browser, the handoff method the server chose.
 *
 * Lives in lib/ because it has no consumer of its own. This file knows only that the server's
 * handoff method is performed in the browser. It does not know whether the handoff serves guardian
 * consent or a member's own adult-status check. If it lived under features/onboarding/, the moment
 * a second consumer appeared the account screen would import the guardian-consent folder. That is
 * the first line where two slices start to know each other.
 *
 * Split out of the component because what is tangled here is not markup. Each verifier opens its
 * window differently and returns differently: a popup may return the result, or the whole page may
 * leave. Stacking those branches in JSX would make it impossible to check which path does what
 * without rendering the screen.
 *
 * Unknown kinds do not proceed. This pairs with the discriminated union in the contract. If the
 * deployment selects a verifier this screen does not know, it becomes unsupported here, and the
 * screen says `Can't proceed right now`. The client is fail-closed too: guessing and opening an arbitrary
 * window would not be the verification we intend.
 *
 * The SDK is loaded on demand. Most people never run this code; only those who go through identity
 * verification use it. A static import would put those bytes in every screen's bundle. More
 * importantly, a browser-only SDK would enter the server-rendered static graph. This is the same
 * reason BYO adapters are dynamically imported (lib/generation/router.ts).
 */

/**
 * The handoff result. The next step differs for each case, so they are not collapsed into one.
 *
 * The server must ask the verifier for completed. Nothing should happen for navigating, because the
 * page is leaving. cancelled should return quietly, and failed should be reported to the user.
 */
export type IdentityHandoffOutcome =
	/** The window closed and a result came back. The server must now verify with the provider. */
	| { status: "completed" }
	/** The page is leaving (mobile redirect). On return, the address carries the marker. */
	| { status: "navigating" }
	/** The user closed the window. This is not a failure. */
	| { status: "cancelled" }
	| { status: "failed"; message: string | null }
	| { status: "unsupported" };

/**
 * Parameters that may appear in the address to show that the user has returned from verification.
 *
 * This is a list to erase, not to read. No value is used. The result's authority is the server's
 * stored reference, and a value in the address is only a claim. This code reads only the fact that
 * the user returned, and erases the traces.
 *
 * There are two reasons to erase. Refresh, sharing, and back navigation would repeat the same
 * submission. Also, the verification attempt's identifier would stay in the address bar and browser
 * history.
 */
const RETURN_MARKERS = [
	/** Values carried by the PortOne redirect. */
	"identityVerificationId",
	"identityVerificationTxId",
	"transactionType",
	"code",
	"message",
	/** Marker set by the server-generated redirect-style handoff (the development verifier). */
	"verification",
] as const;

/**
 * Address -> whether the user has returned, plus the address with the traces erased. This function
 * is pure.
 *
 * The judgment is separated from the effect not only because this app's tests have no DOM. The
 * rules here (which parameter means 'returned', and what the cleaned address is) must be checkable
 * without rendering. Otherwise verifying this judgment would require launching a browser.
 *
 * It returns a boolean and no value, which is the point. If the caller could use the value, it
 * would eventually be sent to the server, and a path would open that attaches another person's
 * verification to one's own request.
 */
export function readIdentityReturn(href: string): {
	returned: boolean;
	cleanedHref: string;
} {
	const url = new URL(href);
	const returned = RETURN_MARKERS.some((key) => url.searchParams.has(key));
	if (!returned) return { returned: false, cleanedHref: href };

	for (const key of RETURN_MARKERS) url.searchParams.delete(key);
	return { returned: true, cleanedHref: url.toString() };
}

/**
 * Applies the judgment above to the real address. This function contains no rules.
 *
 * What remains is two lines of effect, and it has no test. If a rule leaks in here (for example a
 * condition that checks one more parameter), a judgment would exist that cannot be verified.
 */
export function consumeIdentityReturn(): boolean {
	if (typeof window === "undefined") return false;
	const { returned, cleanedHref } = readIdentityReturn(window.location.href);
	if (returned) window.history.replaceState(null, "", cleanedHref);
	return returned;
}

/** Seam for tests to swap the SDK. When unset, the real PortOne browser SDK is loaded. */
export interface IdentityHandoffDeps {
	loadPortOne?: () => Promise<{
		requestIdentityVerification: (request: {
			storeId: string;
			identityVerificationId: string;
			channelKey: string;
			redirectUrl: string;
		}) => Promise<{ code?: string; message?: string } | undefined>;
	}>;
	navigate?: (url: string) => void;
}

/**
 * Performs the handoff method chosen by the server, sending the guardian to the verifier.
 *
 * This function does not judge the result. The verifier saying success is only a value in this
 * browser. The actual judgment is made by the server asking back with its own secret. That is why
 * the success path yields completed ('ask the server now') and not verified.
 */
export async function runIdentityHandoff(
	handoff: IdentityVerificationHandoff,
	deps: IdentityHandoffDeps = {},
): Promise<IdentityHandoffOutcome> {
	const navigate =
		deps.navigate ?? ((url: string) => window.location.assign(url));

	if (handoff.kind === "redirect") {
		navigate(handoff.redirectUrl);
		return { status: "navigating" };
	}

	if (handoff.kind === "portone-v2") {
		const sdk = await (deps.loadPortOne
			? deps.loadPortOne()
			: import("@portone/browser-sdk/v2").then((module) => module.default));

		const response = await sdk.requestIdentityVerification({
			storeId: handoff.storeId,
			identityVerificationId: handoff.identityVerificationId,
			channelKey: handoff.channelKey,
			redirectUrl: handoff.redirectUrl,
		});

		/**
		 * On mobile no response comes back, because the page leaves through a redirect. Doing anything
		 * here then (showing an error, requesting verification) would paint on the departing screen and
		 * vanish.
		 */
		if (!response) return { status: "navigating" };

		/**
		 * Closing the window and the verifier rejecting must be different sentences. Closing is not a
		 * failure, and telling that person `failed` would make them doubt their device.
		 *
		 * Cancellation codes differ per channel, so the judgment does not compare strings. Instead, an
		 * error without a message is not treated as a cancellation, and the screen writes both sentences
		 * gently.
		 */
		if (response.code)
			return { status: "failed", message: response.message ?? null };

		return { status: "completed" };
	}

	/**
	 * The deployment selected a verifier this screen does not know. The code does not guess. Not
	 * proceeding is more accurate than opening an arbitrary window, and the screen states that fact.
	 */
	return { status: "unsupported" };
}
