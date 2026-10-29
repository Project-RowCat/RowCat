import {
	ChoiceSheet,
	controlHeight,
	Icon,
	targetSlop,
} from "@rowcat/ui-native";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useDeviceAppearance } from "../../lib/appearance/provider.tsx";
import { useMobileIdentity } from "../../lib/identity.tsx";
import {
	APPEARANCE_LABEL,
	APPEARANCE_ORDER,
	APPEARANCE_SHORTCUT_LABEL,
} from "./appearance-copy.ts";

/**
 * Appearance shortcut for guests, who have no settings gear.
 *
 * Settings is reachable only for signed-in members, so without this a guest could not change the
 * appearance at all. The value is device-scoped (`lib/appearance/preference.ts`), so it applies to
 * guests as well.
 *
 * Guests and members write to the same store, so signing in or out does not change the value. Shown
 * only when the phase is not `authenticated`; members get the `General` section instead, and showing
 * both would give two places to edit the same value.
 *
 * Renders in `unavailable` and `booting` too. The gear is absent there only because the account is
 * unknown, and appearance does not depend on the account.
 *
 * Uses `ChoiceSheet`, the one presentation primitive that matches a short single choice. It stays
 * mounted and opens through `open`; mounting only while open would leave accessibility focus with
 * no trigger to return to after the sheet closes.
 */
export function AppearanceShortcut() {
	const { session } = useMobileIdentity();
	/** Not rendered for members, whose path is `General` in settings. The gate is outside this component, so the sheet is never mounted in that state. */
	if (session.phase === "authenticated") return null;
	return <AppearancePicker />;
}

function AppearancePicker() {
	const { preference, setPreference } = useDeviceAppearance();
	const [open, setOpen] = useState(false);

	return (
		<>
			<Pressable
				accessibilityRole="button"
				/** The label includes the current value; the icon alone does not show what is selected. */
				accessibilityLabel={`${APPEARANCE_SHORTCUT_LABEL}: ${APPEARANCE_LABEL[preference]}`}
				onPress={() => setOpen(true)}
				hitSlop={targetSlop(controlHeight.lg)}
				style={shortcut.root}
			>
				<Icon name="settings" size="lg" tone="muted-foreground" />
			</Pressable>
			<ChoiceSheet
				title={APPEARANCE_SHORTCUT_LABEL}
				open={open}
				value={preference}
				options={APPEARANCE_ORDER.map((value) => ({
					value,
					label: APPEARANCE_LABEL[value],
				}))}
				onValueChange={(next) => {
					setPreference(next);
					setOpen(false);
				}}
				onOpenChange={setOpen}
			/>
		</>
	);
}

const shortcut = StyleSheet.create({
	/**
	 * The visible box is 40, the same as the web header button (`size-10`). The hit area widens to 44
	 * via `targetSlop`. This was once 44 directly, which made the row sparser than the web
	 * (`packages/ui-native/src/metrics.ts`).
	 */
	root: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: controlHeight.lg,
		minWidth: controlHeight.lg,
	},
});
