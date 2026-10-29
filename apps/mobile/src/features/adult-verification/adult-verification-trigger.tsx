import { space } from "@rowcat/design";
import { Button, Notice, Text } from "@rowcat/ui-native";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";
import { WEB_ORIGIN } from "../../lib/env.ts";
import { accountWebUrl } from "../../lib/public-web.ts";
import {
	ADULT_RENEW_NOTE,
	ADULT_RENEW_TITLE,
	ADULT_REVERIFY_LABEL,
	ADULT_VERIFICATION_BUSY_LABEL,
	ADULT_VERIFICATION_DONE,
	ADULT_VERIFICATION_RECHECK_LABEL,
	ADULT_VERIFICATION_RECHECK_NOTE,
	ADULT_VERIFY_LABEL,
	ADULT_VERIFY_ON_WEB_LABEL,
	ADULT_VERIFY_ON_WEB_NOTE,
} from "./adult-verification-copy.ts";
import { adultVerificationRecovery } from "./adult-verification-error.ts";
import {
	type AdultVerificationOffer,
	adultVerificationBusy,
	adultVerificationSurface,
} from "./adult-verification-state.ts";
import { AdultVerificationSurface } from "./adult-verification-surface.tsx";
import { useAdultVerification } from "./use-adult-verification.ts";

/**
 * The verification control that the account content section composes. It knows only what is
 * offered, the current phase and what is pressable in it; the authority's name, server endpoints
 * and cache policy live in their own files.
 *
 * - `showAdult` never appears here: verification opens eligibility, and turning display on is a
 *   separate decision made in the neighbouring section (on iOS the app does not have it at all,
 *   `features/account/adult-content-policy.ts`).
 * - No automatic jump to the web's adult settings after success; that would fold the two
 *   decisions this slice keeps apart into one.
 */
export function AdultVerificationTrigger({
	viewerId,
	offer,
}: {
	viewerId: string;
	/** The composing side judges `none` and does not render this component. */
	offer: Exclude<AdultVerificationOffer, "none">;
}) {
	const verification = useAdultVerification(viewerId);
	const { phase } = verification;
	const busy = adultVerificationBusy(phase);
	const plan = adultVerificationSurface(phase);
	const failure = phase.kind === "idle" ? phase.failure : null;
	const recovery = failure ? adultVerificationRecovery(failure) : null;
	/**
	 * The web is the canonical place; the origin is not guessed and the guidance is not drawn without
	 * it. This path stands only when a deployment picks a method this app does not know.
	 */
	const webUrl = accountWebUrl(WEB_ORIGIN);

	/**
	 * Re-asks the server only, and never reopens the authority's window. It takes its own branch
	 * instead of sharing the usual button, because one button with two meanings is told apart only by
	 * its label, and someone who misses it repeats a verification they just finished.
	 */
	if (phase.kind === "completion_failed")
		return (
			<View style={trigger.stack}>
				<Notice
					message={ADULT_VERIFICATION_RECHECK_NOTE}
					actionLabel={ADULT_VERIFICATION_RECHECK_LABEL}
					onAction={verification.recheck}
				/>
			</View>
		);

	return (
		<View style={trigger.stack}>
			{/**
			 * The yearly re-check notice is the reason for this action, so it stands with the
			 * button. The display setting above stays: eligibility did not go away, only viewing
			 * closed.
			 */}
			{offer === "renew" ? (
				<View style={trigger.stack}>
					<Text variant="body">{ADULT_RENEW_TITLE}</Text>
					<Text variant="label" tone="muted-foreground">
						{ADULT_RENEW_NOTE}
					</Text>
				</View>
			) : null}
			<View style={trigger.actionRow}>
				<Button
					label={
						busy && phase.kind !== "idle"
							? ADULT_VERIFICATION_BUSY_LABEL[phase.kind]
							: offer === "reverify"
								? ADULT_REVERIFY_LABEL
								: ADULT_VERIFY_LABEL
					}
					/**
					 * Not a prominent retry for someone under 19: all they can do is wait, and emphasis would read
					 * as urging them to change their age (same call as the web).
					 */
					variant={offer === "reverify" ? "ghost" : "outline"}
					size="sm"
					disabled={busy}
					busy={busy}
					onPress={verification.start}
				/>
			</View>

			{phase.kind === "idle" && phase.settled ? (
				<Text variant="label" tone="muted-foreground">
					{ADULT_VERIFICATION_DONE}
				</Text>
			) : null}

			{/**
			 * Cancel and account switch have no sentence (`failure.message === null`); an error
			 * over a window the user closed themselves makes them doubt their device.
			 */}
			{failure?.message ? (
				<Text accessibilityRole="alert" variant="label" tone="destructive">
					{failure.message}
				</Text>
			) : null}

			{/**
			 * The deployment picked a method this app does not know. No guessing at some window
			 * (the client is fail-closed too); send the person to where the procedure finishes.
			 */}
			{recovery === "web" && webUrl ? (
				<View style={trigger.stack}>
					<Text variant="label" tone="muted-foreground">
						{ADULT_VERIFY_ON_WEB_NOTE}
					</Text>
					<View style={trigger.actionRow}>
						<Button
							label={ADULT_VERIFY_ON_WEB_LABEL}
							variant="ghost"
							size="sm"
							onPress={() => void WebBrowser.openBrowserAsync(webUrl)}
						/>
					</View>
				</View>
			) : null}

			{plan?.kind === "portone" ? (
				<AdultVerificationSurface
					request={plan.request}
					onCompleted={verification.provider.completed}
					onRejected={verification.provider.rejected}
					onDismissed={verification.provider.dismissed}
					onCrashed={verification.provider.crashed}
				/>
			) : null}
		</View>
	);
}

const trigger = StyleSheet.create({
	stack: { gap: space.sm },
	actionRow: { flexDirection: "row" },
});
