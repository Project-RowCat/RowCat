import { space } from "@rowcat/design";
import { adultVisibilityState, type Viewer } from "@rowcat/domain";
import { Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { adultVerificationOffer } from "../adult-verification/adult-verification-state.ts";
import { AdultVerificationTrigger } from "../adult-verification/adult-verification-trigger.tsx";
import {
	ADULT_UNAVAILABLE_NOTE,
	ADULT_UNAVAILABLE_TITLE,
	CONTENT_SECTION_TITLE,
} from "./account-copy.ts";
import { AccountSection } from "./account-section.tsx";
import { AdultVisibilityControl } from "./adult-visibility-control.tsx";

/**
 * Content display: eligibility and display are separate decisions, composed here.
 *
 * ```text
 * identity check   opens eligibility   features/adult-verification/   same on both platforms
 * display setting  puts it on screen   ./adult-visibility-control     on iOS, turning it on happens on web
 * ```
 *
 * Verification never turns display on; no code here or in the verification flow sets `showAdult`.
 * Bundling them would show adult content to someone who only wanted to verify, an unrequested
 * change regardless of store policy.
 *
 * The verification procedure exists in this app (PortOne's React Native SDK,
 * `@portone/react-native-sdk`). The trust boundary is unchanged: the server creates
 * `identityVerificationId`, the completion request has no body, and eligibility opens only from the
 * server's own query to the authority.
 *
 * Judgments are not reassembled here: `adultVisibilityState` in `@rowcat/domain` (same function as
 * web) classifies child, unknown, minor and eligible, `adultVerificationOffer` decides what to
 * offer, and `adultContentControl` decides how display can be turned on.
 *
 * Restricted accounts (suspended, blocked) enter this section too. The server allows both display
 * changes and verification for them (`requireViewer`); a stricter screen would stop a suspended
 * person from verifying or reducing the adult content they see.
 */
export function ContentSection({ viewer }: { viewer: Viewer }) {
	const state = adultVisibilityState(viewer);
	const offer = adultVerificationOffer(state);

	return (
		<AccountSection title={CONTENT_SECTION_TITLE}>
			<View style={content.stack}>
				{state.kind === "eligible" ? (
					<AdultVisibilityControl viewer={viewer} />
				) : (
					<View style={content.stack}>
						<Text variant="body">{ADULT_UNAVAILABLE_TITLE[state.kind]}</Text>
						<Text variant="label" tone="muted-foreground">
							{ADULT_UNAVAILABLE_NOTE[state.kind]}
						</Text>
					</View>
				)}
				{/**
				 * Not drawn for under-14s: the server rejects the procedure for them
				 * (`requireNonChild`), so the control would only produce a refusal. Not drawn
				 * for accounts already eligible either, except when the last verification is
				 * over a year old (`renew`), which stands below the display setting.
				 */}
				{offer === "none" ? null : (
					<AdultVerificationTrigger viewerId={viewer.id} offer={offer} />
				)}
			</View>
		</AccountSection>
	);
}

const content = StyleSheet.create({
	stack: { gap: space.sm },
});
