import { space } from "@rowcat/design";
import { Button, Text } from "@rowcat/ui-native";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";
import { WEB_ORIGIN } from "../../lib/env.ts";
import { accountDeletionGuideUrl } from "../../lib/public-web.ts";
import {
	DELETE_GUIDE_LINK_LABEL,
	DELETE_REMAINS_ITEMS,
	DELETE_SECTION_NOTE,
	DELETE_SECTION_TITLE,
} from "./account-copy.ts";
import { AccountSection } from "./account-section.tsx";
import { DeleteAccountTrigger } from "./delete-account-trigger.tsx";
import type { AccountDeletion } from "./use-account-deletion.ts";

/**
 * Account deletion: the destructive section split off at the very bottom of the account screen
 * (counterpart of web `delete-account-section.tsx`).
 *
 * Position is policy. Beside security at equal weight, reversible and irreversible operations look
 * alike; the order is security (how you get in), data (what is stored), deletion (everything goes).
 *
 * The button, account-info query and confirmation dialog are shared with the entry gate and live in
 * `delete-account-trigger.tsx`; this section keeps only context (what remains, where the canonical
 * guide is). A second implementation of an irreversible operation would let the confirmation,
 * password decision and failure handling diverge.
 *
 * Failures stay inside this section: if the account-info query dies, profile, security and data
 * keep working, and vice versa.
 */
export function DeleteAccountSection({
	deletion,
}: {
	deletion: AccountDeletion;
}) {
	/** The canonical guide lives on web; the origin is not guessed, and without it no link is drawn. */
	const guideUrl = accountDeletionGuideUrl(WEB_ORIGIN);

	return (
		<AccountSection title={DELETE_SECTION_TITLE}>
			<View style={styles.root}>
				<View style={styles.copy}>
					<Text variant="label" tone="muted-foreground">
						{DELETE_SECTION_NOTE}
					</Text>
					{DELETE_REMAINS_ITEMS.map((item) => (
						<Text key={item} variant="label" tone="muted-foreground">
							{`• ${item}`}
						</Text>
					))}
				</View>

				{guideUrl ? (
					<View style={styles.linkRow}>
						<Button
							label={DELETE_GUIDE_LINK_LABEL}
							variant="ghost"
							size="sm"
							onPress={() => void WebBrowser.openBrowserAsync(guideUrl)}
						/>
					</View>
				) : null}

				<DeleteAccountTrigger deletion={deletion} />
			</View>
		</AccountSection>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	copy: { gap: space.xs },
	linkRow: { flexDirection: "row" },
});
