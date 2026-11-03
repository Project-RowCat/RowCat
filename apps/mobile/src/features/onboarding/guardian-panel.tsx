import { space } from "@rowcat/design";
import {
	guardianStateQueryOptions,
	requestGuardianConsentMutationOptions,
	VIEWER_QUERY_KEY,
} from "@rowcat/query";
import { Button, Notice, Panel, Text } from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Share, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { activeWebOrigin } from "../../lib/instances/device-registry.ts";
import { guardianConsentUrl } from "../../lib/public-web.ts";
import { DeletionTerminal } from "../account/deletion-terminal.tsx";
import { useAccountDeletion } from "../account/use-account-deletion.ts";
import { GUARDIAN_COPY, guardianSteps } from "./gate-copy.ts";
import { GateExit, GateSurface } from "./gate-shell.tsx";
import { guardianRequestError } from "./membership-gate-state.ts";

/**
 * Waiting for guardian consent: **the screen the child sees** (the native counterpart of web's
 * `guardian-panel.tsx`).
 *
 * ## Not the guardian's screen
 *
 * The screen a guardian opens (`/guardian/:token`) is a public web route and is not built in this
 * app. The person who opens that address is an adult the child handed the link to, not a member,
 * and has no reason to have this app on their device. A native route for it would build a screen
 * for a user who does not exist here.
 *
 * ## This screen is not a rejection
 *
 * The copy does not open with "cannot sign up". Use under 14 is a supported path that the Personal
 * Information Protection Act (art. 22-2) sets out procedures for; all that is needed here is the
 * guardian's consent. If it reads as a rejection, the child goes back and edits their age.
 *
 * ## The link is handed over by the child, and shown once
 *
 * The server keeps only a hash of the token and cannot return it. So this screen shows the path
 * from the response that created the request, on the spot, and **stores it nowhere**: not SQLite,
 * SecureStore or the query cache (the same axis as `@rowcat/query` keeping state in cache but never
 * the token). If it is lost, a new one is created, and the previous link dies then.
 *
 * ## Plain language
 *
 * Art. 22-2(3) of the Personal Information Protection Act requires a form and language that
 * children under 14 can easily understand. The shorter, softer wording here, compared with other
 * screens, follows that article rather than taste.
 */
export function GuardianPanel() {
	useTranslation("membership");
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const deletion = useAccountDeletion();
	/** One-shot value; lives only in this component's state (see the header). */
	const [consentPath, setConsentPath] = useState<string | null>(null);
	/**
	 * The result of the action that hands over the link: **success and failure are held as one
	 * value.**
	 *
	 * With a boolean, failure would be `false`, the same value as "not pressed yet". The button stays
	 * the same on screen, so the child could not tell whether the press took effect.
	 */
	const [handoff, setHandoff] = useState<
		"idle" | "copied" | "copy-failed" | "share-failed"
	>("idle");

	const state = useQuery(guardianStateQueryOptions(client));
	const request = useMutation(
		requestGuardianConsentMutationOptions(client, queryClient),
	);
	const busy = request.isPending || deletion.phase === "deleting";
	const status = state.data?.status ?? null;

	/**
	 * **Re-asks the viewer once approval is confirmed**, because the gate is opened by that value.
	 *
	 * Polling refreshes the consent request's status, while the gate reads `viewer.membershipGate`.
	 * Without this bridge, a guardian consenting on another device leaves the child's screen on
	 * "waiting" until the viewer query refreshes or the app returns to the foreground. The child
	 * cannot tell what went wrong and restarts the app.
	 *
	 * **The gate is not lowered directly here.** Building `membershipGate` by hand would open a window
	 * where the account is open before the server has opened it. Re-asking lets the server answer.
	 * Invalidation is idempotent, so observing the same status several times is safe.
	 */
	useEffect(() => {
		if (status !== "approved") return;
		void queryClient.invalidateQueries({ queryKey: VIEWER_QUERY_KEY });
	}, [status, queryClient]);

	if (deletion.terminal)
		return (
			<GateSurface>
				<DeletionTerminal deletion={deletion} />
			</GateSurface>
		);

	const waiting = status === "pending" || status === "verified";
	const declined = status === "declined";
	/**
	 * **The origin is not guessed.** On a deployment without an origin configured, no link is made and
	 * that fact is stated. A child who hands a dead address to a guardian cannot tell why it fails.
	 */
	const consentUrl = consentPath
		? guardianConsentUrl(activeWebOrigin(), consentPath)
		: null;
	const originMissing = consentPath !== null && consentUrl === null;
	const error = guardianRequestError(request.error);

	const create = (): void => {
		setHandoff("idle");
		setConsentPath(null);
		request.mutate(undefined, {
			onSuccess: (created) => setConsentPath(created.consentPath),
		});
	};

	return (
		<GateSurface>
			<Text accessibilityRole="header" variant="heading">
				{GUARDIAN_COPY.title}
			</Text>
			<Text variant="body" tone="muted-foreground">
				{GUARDIAN_COPY.description}
			</Text>

			{/** States what is being consented to, on the child's screen too (the intent of art. 22-2(3)). */}
			<View style={guardian.steps}>
				{guardianSteps().map((step) => (
					<Text key={step} variant="label" tone="muted-foreground">
						{`• ${step}`}
					</Text>
				))}
			</View>

			{/** **A refusal is not the end either**: the account stays, and the request can be made again. */}
			{declined ? <Notice message={GUARDIAN_COPY.declined} /> : null}

			{consentUrl ? (
				<Panel style={guardian.card}>
					<Text variant="label">{GUARDIAN_COPY.linkTitle}</Text>
					{/**
					 * The address is **shown as is.** It is not wrapped in a short code, because what the
					 * guardian receives is this address and the child must be able to verify it. Not
					 * leaving only a copy action is the same axis: on a device where copying is blocked,
					 * the child must be able to select and copy it by hand (`selectable`).
					 */}
					<Text selectable variant="caption" style={guardian.url}>
						{consentUrl}
					</Text>
					<View style={guardian.actions}>
						<Button
							label={
								handoff === "copied" ? GUARDIAN_COPY.copied : GUARDIAN_COPY.copy
							}
							size="sm"
							onPress={() => {
								void Clipboard.setStringAsync(consentUrl).then(
									() => {
										setHandoff("copied");
										AccessibilityInfo.announceForAccessibility(
											GUARDIAN_COPY.copied,
										);
									},
									() => setHandoff("copy-failed"),
								);
							}}
						/>
						{/**
						 * Sharing belongs to the platform: messages, mail and messengers are in that sheet, and
						 * that is usually how a child actually hands the link to a guardian. A separate
						 * sharing package is not pulled in (the core API is enough).
						 */}
						<Button
							label={GUARDIAN_COPY.share}
							variant="outline"
							size="sm"
							onPress={() => {
								void Share.share({ message: consentUrl }).then(
									() => undefined,
									() => setHandoff("share-failed"),
								);
							}}
						/>
						<Button
							label={GUARDIAN_COPY.newLink}
							variant="ghost"
							size="sm"
							disabled={busy}
							onPress={create}
						/>
					</View>
					{handoff === "copy-failed" ? (
						<Text accessibilityRole="alert" variant="label" tone="destructive">
							{GUARDIAN_COPY.copyFailed}
						</Text>
					) : null}
					{handoff === "share-failed" ? (
						<Text accessibilityRole="alert" variant="label" tone="destructive">
							{GUARDIAN_COPY.shareFailed}
						</Text>
					) : null}
					<Text variant="caption" tone="muted-foreground">
						{GUARDIAN_COPY.newLinkNote}
					</Text>
				</Panel>
			) : (
				<Button
					label={
						request.isPending
							? GUARDIAN_COPY.creating
							: waiting
								? GUARDIAN_COPY.recreate
								: GUARDIAN_COPY.create
					}
					fullWidth
					busy={request.isPending}
					disabled={busy}
					onPress={create}
				/>
			)}

			{originMissing ? (
				<Notice tone="destructive" message={GUARDIAN_COPY.originMissing} />
			) : null}
			{error ? <Notice tone="destructive" message={error} /> : null}

			{/**
			 * Shows the state while waiting. Polling belongs to the query options (`@rowcat/query`), and
			 * the screen disappears on its own when the guardian consents, since the gate goes away. That
			 * is why it need not say "please refresh".
			 */}
			{waiting && !consentUrl ? (
				<Text
					accessibilityLiveRegion="polite"
					variant="label"
					tone="muted-foreground"
				>
					{GUARDIAN_COPY.waiting}
				</Text>
			) : null}

			<GateExit note={GUARDIAN_COPY.exitNote} deletion={deletion} busy={busy} />
		</GateSurface>
	);
}

const guardian = StyleSheet.create({
	steps: { gap: space.xs },
	card: { gap: space.sm },
	/** Keeps a line from overflowing on narrow screens. */
	url: { flexShrink: 1 },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
