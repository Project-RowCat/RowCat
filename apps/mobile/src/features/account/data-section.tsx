import { space } from "@rowcat/design";
import { Separator, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { SyncSection } from "../sync/sync-section.tsx";
import {
	DATA_LOCAL_NOTE,
	DATA_LOGOUT_NOTE,
	DATA_SECTION_DESCRIPTION,
	DATA_SECTION_TITLE,
	DATA_SYNC_SUBSECTION_DESCRIPTION,
	DATA_SYNC_SUBSECTION_TITLE,
} from "./account-copy.ts";
import { AccountSection } from "./account-section.tsx";

/**
 * Data: what is on this device and how far it goes (counterpart of web `data-section.tsx`).
 *
 * The copy states the real storage model: this device's store is the source of truth for
 * conversations and drafts, and signing out closes access without deleting. Neither "everything is
 * stored in the cloud" nor "signing out deletes device data" is true, so neither appears.
 *
 * This is not a maintenance console. The local purge primitive (`lib/local-data/purge.ts`) belongs
 * to account deletion; placing it here would put an irreversible action among ordinary settings.
 */
export function DataSection() {
	return (
		<AccountSection
			title={DATA_SECTION_TITLE}
			description={DATA_SECTION_DESCRIPTION}
		>
			<View style={styles.root}>
				<View style={styles.copy}>
					<Text variant="label" tone="muted-foreground">
						{DATA_LOCAL_NOTE}
					</Text>
					<Text variant="label" tone="muted-foreground">
						{DATA_LOGOUT_NOTE}
					</Text>
				</View>

				<Separator />

				<View style={styles.copy}>
					<Text accessibilityRole="header" variant="body">
						{DATA_SYNC_SUBSECTION_TITLE}
					</Text>
					<Text variant="label" tone="muted-foreground">
						{DATA_SYNC_SUBSECTION_DESCRIPTION}
					</Text>
				</View>
				<SyncSection />
			</View>
		</AccountSection>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	copy: { gap: space.xs },
});
