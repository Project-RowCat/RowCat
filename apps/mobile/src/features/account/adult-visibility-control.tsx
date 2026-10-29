import { space } from "@rowcat/design";
import { adultVisibilityState, type Viewer } from "@rowcat/domain";
import { showAdultMutationOptions } from "@rowcat/query";
import { AlertDialog, Button, Switch, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { WEB_ORIGIN } from "../../lib/env.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import { accountWebUrl } from "../../lib/public-web.ts";
import {
	ADULT_ENABLE_CONFIRM_DESCRIPTION,
	ADULT_ENABLE_CONFIRM_LABEL,
	ADULT_ENABLE_CONFIRM_TITLE,
	ADULT_ENABLE_ON_WEB_LABEL,
	ADULT_ENABLE_ON_WEB_NOTE,
	SHOW_ADULT_DESCRIPTION,
	SHOW_ADULT_LABEL,
} from "./account-copy.ts";
import { accountErrorMessage } from "./account-error.ts";
import { adultContentControl } from "./adult-content-policy.ts";

/**
 * Adult content *display* switch; only drawn for eligible accounts.
 *
 * Makes no decision itself: platform and current state go to the pure `adultContentControl` and the
 * answer is drawn. `Platform.OS === "ios"` scattered in JSX would miss one place when a second
 * place that turns display on appears, and that one is the policy violation.
 *
 * ```text
 * iOS       no switch: one link to the web's canonical place
 * Android   switch -> confirmation dialog -> server write (two steps)
 * both      when on, one switch turns it off immediately (no confirmation)
 * ```
 *
 * No disabled switch is drawn on iOS: an unpressable switch reads as "coming soon", which is false
 * here, and someone would eventually revive it. Turning off has no confirmation because friction on
 * the safe direction would stop someone who turned it on from turning it off.
 *
 * Restricted accounts touch this switch too: member status is not an input to the decision. The
 * server allows display changes for them (`requireViewer`), and a screen stricter than the server
 * would leave a suspended person unable to reduce the adult content shown to them.
 */
export function AdultVisibilityControl({ viewer }: { viewer: Viewer }) {
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	/** Whether the confirmation dialog is open. Only the turn-on direction has one. */
	const [confirming, setConfirming] = useState(false);

	const policy = showAdultMutationOptions(getRowCatClient(), queryClient);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			setError(accountErrorMessage(args[0]));
		},
		onSuccess: async (...args) => {
			await policy.onSuccess?.(...args);
			setError(null);
			setConfirming(false);
		},
	});

	// The decision is the pure function's. This line is the one place that reads `Platform.OS`, and
	// the value enters as an argument, not as a rule.
	const control = adultContentControl(
		Platform.OS as Parameters<typeof adultContentControl>[0],
		adultVisibilityState(viewer),
	);
	const webUrl = accountWebUrl(WEB_ORIGIN);

	/** Not drawn without entitlement; the composing side owns that sentence. */
	if (control.kind === "ineligible") return null;

	const on = control.kind === "on";
	// No switch exists when off on iOS: no code in this branch calls `mutation.mutate`, which is the
	// structural form of that fact.
	if (!on && control.enable === "web-only")
		return (
			<View style={visibility.stack}>
				<View style={visibility.label}>
					<Text variant="body">{SHOW_ADULT_LABEL}</Text>
					<Text variant="caption" tone="muted-foreground">
						{ADULT_ENABLE_ON_WEB_NOTE}
					</Text>
				</View>
				{webUrl ? (
					<View style={visibility.actionRow}>
						<Button
							label={ADULT_ENABLE_ON_WEB_LABEL}
							variant="outline"
							size="sm"
							onPress={() => void WebBrowser.openBrowserAsync(webUrl)}
						/>
					</View>
				) : null}
			</View>
		);

	return (
		<View style={visibility.stack}>
			<View style={visibility.row}>
				<View style={visibility.label}>
					<Text variant="body">{SHOW_ADULT_LABEL}</Text>
					<Text variant="caption" tone="muted-foreground">
						{SHOW_ADULT_DESCRIPTION}
					</Text>
				</View>
				<Switch
					label={SHOW_ADULT_LABEL}
					value={on}
					disabled={mutation.isPending}
					onValueChange={(checked) => {
						setError(null);
						/* Only turning on passes the confirmation; writing immediately would let one tap switch the
						   filter off, which does not suit this setting. `control.kind` is in the condition
						   because the switch is drawn only when on on iOS, so a turn-on toggle never arrives
						   there, but that would have to be inferred from the early return above; stating it
						   here makes the impossibility readable on this line. */
						if (checked) {
							if (control.kind === "off") setConfirming(true);
						} else mutation.mutate({ showAdult: false });
					}}
				/>
			</View>
			{error ? (
				/* The result of the action attaches and detaches (`lib/motion/feedback.tsx`). The
				   `AlertDialog` below floats and takes no flow space, so this sentence is effectively
				   the last in its box and its exit pushes nothing. */
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : null}
			{/* Declarative `AlertDialog`, not `Alert.alert`: that call freezes the sentence at open time
			    and the primitive could not own Android back, screen-reader escape or focus movement. */}
			<AlertDialog
				open={confirming}
				title={ADULT_ENABLE_CONFIRM_TITLE}
				description={ADULT_ENABLE_CONFIRM_DESCRIPTION}
				confirmLabel={ADULT_ENABLE_CONFIRM_LABEL}
				busy={mutation.isPending}
				error={error}
				onConfirm={() => {
					setError(null);
					mutation.mutate({ showAdult: true });
				}}
				onCancel={() => {
					setConfirming(false);
					setError(null);
				}}
			/>
		</View>
	);
}

const visibility = StyleSheet.create({
	stack: { gap: space.sm },
	row: { alignItems: "center", flexDirection: "row", gap: space.md },
	label: { flex: 1, gap: space.px, minWidth: 0 },
	actionRow: { flexDirection: "row" },
});
