import { space } from "@rowcat/design";
import { VISUAL_LAB_TEXT } from "@rowcat/design/visual-lab";
import {
	AlertDialog,
	Button,
	ChoiceSheet,
	Dialog,
	DialogActions,
	Input,
	NavigationDrawer,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

/**
 * Canonical state of the floating layers: each container opens deterministically, one at a time.
 *
 * This section exists for geometry. Dialog width, corner radius, safe-area handling, and the
 * scrim's darkness and blur cannot be answered without opening the screen; if those values diverge
 * from the same window on the web, the app ends up "similar but different".
 *
 * ## Not an exception to the presentation policy
 *
 * Every container here is a capability exported from `index.ts`; the lab does not make one more.
 * `ChoiceSheet` opens in this file to show that capability, not to hold anything beyond a short
 * single choice: it still takes one list of values. `presentation-policy.test.ts` pins that by
 * name.
 */
export function OverlayLab() {
	const [open, setOpen] = useState<null | "compact" | "adaptive" | "full">(
		null,
	);
	const [alert, setAlert] = useState(false);
	const [choice, setChoice] = useState(false);
	const [drawer, setDrawer] = useState(false);
	const [scheme, setScheme] = useState<"light" | "dark" | "system">("system");

	return (
		<View style={overlay.root}>
			<View style={overlay.row}>
				<Button
					label="Dialog center"
					variant="outline"
					size="sm"
					onPress={() => setOpen("compact")}
				/>
				<Button
					label="Dialog adaptive"
					variant="outline"
					size="sm"
					onPress={() => setOpen("adaptive")}
				/>
				<Button
					label="Dialog full"
					variant="outline"
					size="sm"
					onPress={() => setOpen("full")}
				/>
			</View>
			<View style={overlay.row}>
				<Button
					label="AlertDialog"
					variant="outline"
					size="sm"
					onPress={() => setAlert(true)}
				/>
				<Button
					label="ChoiceSheet"
					variant="outline"
					size="sm"
					onPress={() => setChoice(true)}
				/>
				<NavigationDrawer
					title="Visual Lab"
					triggerLabel="NavigationDrawer"
					open={drawer}
					onOpenChange={setDrawer}
				>
					<Text variant="body">{VISUAL_LAB_TEXT.mixed}</Text>
				</NavigationDrawer>
			</View>

			<Dialog
				title={VISUAL_LAB_TEXT.dialogTitle}
				description={VISUAL_LAB_TEXT.dialogDescription}
				open={open === "compact"}
				onOpenChange={(next) => setOpen(next ? "compact" : null)}
			>
				<Input
					label={VISUAL_LAB_TEXT.fieldLabel}
					value={VISUAL_LAB_TEXT.fieldValue}
					onChangeText={() => undefined}
				/>
				<DialogActions>
					<Button
						label={VISUAL_LAB_TEXT.secondaryAction}
						variant="outline"
						onPress={() => setOpen(null)}
					/>
					<Button
						label={VISUAL_LAB_TEXT.action}
						onPress={() => setOpen(null)}
					/>
				</DialogActions>
			</Dialog>

			<Dialog
				title={VISUAL_LAB_TEXT.dialogTitle}
				description={VISUAL_LAB_TEXT.dialogDescription}
				open={open === "adaptive"}
				placement="adaptive"
				onOpenChange={(next) => setOpen(next ? "adaptive" : null)}
			>
				<Input
					label={VISUAL_LAB_TEXT.fieldLabel}
					value={VISUAL_LAB_TEXT.fieldValue}
					onChangeText={() => undefined}
				/>
				<DialogActions>
					<Button
						label={VISUAL_LAB_TEXT.action}
						onPress={() => setOpen(null)}
					/>
				</DialogActions>
			</Dialog>

			<Dialog
				title={VISUAL_LAB_TEXT.dialogTitle}
				open={open === "full"}
				size="full"
				headerDivider
				onOpenChange={(next) => setOpen(next ? "full" : null)}
			>
				<Text variant="body">{VISUAL_LAB_TEXT.paragraph}</Text>
				<Input
					label={VISUAL_LAB_TEXT.fieldLabel}
					value={VISUAL_LAB_TEXT.fieldValue}
					onChangeText={() => undefined}
				/>
				<Text variant="body">{VISUAL_LAB_TEXT.paragraph}</Text>
			</Dialog>

			<AlertDialog
				open={alert}
				title={VISUAL_LAB_TEXT.alertTitle}
				description={VISUAL_LAB_TEXT.alertDescription}
				confirmLabel={VISUAL_LAB_TEXT.destructiveAction}
				cancelLabel={VISUAL_LAB_TEXT.secondaryAction}
				destructive
				onConfirm={() => setAlert(false)}
				onCancel={() => setAlert(false)}
			/>

			<ChoiceSheet
				title={VISUAL_LAB_TEXT.sectionTitle}
				open={choice}
				value={scheme}
				options={[
					{ value: "system", label: "System settings" },
					{ value: "light", label: "Light" },
					{ value: "dark", label: "Dark" },
				]}
				onValueChange={setScheme}
				onOpenChange={setChoice}
			/>
		</View>
	);
}

const overlay = StyleSheet.create({
	root: { gap: space.sm },
	row: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
});
