import { IdentityVerification } from "@portone/react-native-sdk";
import { space } from "@rowcat/design";
import { Dialog, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import {
	ADULT_VERIFICATION_SURFACE_NOTE,
	ADULT_VERIFICATION_SURFACE_TITLE,
} from "./adult-verification-copy.ts";
import {
	type PortOneIdentityRequest,
	providerReportedSuccess,
} from "./adult-verification-handoff.ts";

/**
 * The authority's window, and the only file in this app that knows `@portone/react-native-sdk`. The
 * vendor is a native-execution detail; spreading its name across screens would make switching
 * authorities unbounded (a static scan locks that absence).
 *
 * - No hand-planted browser SDK in a `<WebView />`: the official package already owns SDK
 *   loading, authority deep links, external app switching (PASS, carriers) and the completion
 *   callback (it intercepts `portone://`). We own only the product lifecycle around it. For the
 *   same reason feature code does not import `react-native-webview` directly.
 * - `Dialog size="full"` with scroll off: the window takes its height from the parent and scrolls
 *   itself; inside a scrolling parent it gets infinite height and silently collapses to 0. The
 *   opt-in lives on `@rowcat/ui-native`'s `Dialog` and defaults to on.
 * - No route: this is a temporary flow tied to the account screen, and an address would leave a
 *   back-navigable entry after verification finished.
 * - Every way to close (Android back, screen-reader escape, close button) arrives as
 *   `onOpenChange(false)` and means cancel, not failure; nothing goes to the server. Back inside
 *   the webview is not intercepted because the presentation policy bans `BackHandler` in feature
 *   code (`lib/presentation-policy.test.ts`); the cost is no in-webview back step, and the user
 *   cannot get trapped.
 */
export function AdultVerificationSurface({
	request,
	onCompleted,
	onRejected,
	onDismissed,
	onCrashed,
}: {
	request: PortOneIdentityRequest;
	/** The authority reported success — not that eligibility opened; the server re-asks. */
	onCompleted: () => void;
	/** The authority returned a structured error code. */
	onRejected: () => void;
	/** The user closed the window. */
	onDismissed: () => void;
	/** The window itself failed to appear (SDK, webview or network). */
	onCrashed: () => void;
}) {
	return (
		<Dialog
			title={ADULT_VERIFICATION_SURFACE_TITLE}
			open
			size="full"
			/** Off for this window only; the child scrolls itself (see the header). */
			scroll={false}
			onOpenChange={(open) => {
				if (!open) onDismissed();
			}}
		>
			<View style={surface.body}>
				<Text variant="label" tone="muted-foreground">
					{ADULT_VERIFICATION_SURFACE_NOTE}
				</Text>
				<IdentityVerification
					request={request}
					/**
					 * Judged by one structured field (`code` presence). The response body is neither read nor
					 * drawn because it may carry identity fragments; it goes to no log or store.
					 */
					onComplete={(response) => {
						if (providerReportedSuccess(response)) onCompleted();
						else onRejected();
					}}
					/** The error object is not drawn; the screen branches on the next step, not text. */
					onError={() => onCrashed()}
					style={surface.provider}
				/>
			</View>
		</Dialog>
	);
}

const surface = StyleSheet.create({
	body: { flex: 1, gap: space.sm },
	/** Takes all remaining height; the authority's screen scrolls inside itself. */
	provider: { flex: 1 },
});
