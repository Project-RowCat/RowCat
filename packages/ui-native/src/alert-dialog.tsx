import * as AlertDialogPrimitive from "@rn-primitives/alert-dialog";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./button.tsx";
import {
	useBackdropStyle,
	useDialogPanelStyle,
	usePrimitivePresence,
} from "./motion/animate.ts";
import { SCRIM_COLOR, ScrimBlur } from "./scrim.tsx";
import { Notice } from "./state.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Confirmation for irreversible actions. Four parts are fixed: title, description, cancel and
 * confirm. Why not the platform Alert: destructive confirmations in this app used Alert.alert for a
 * while, for good reasons. The platform already provided Android back, screen readers and system
 * font size. The primitive now holds those: @rn-primitives/alert-dialog owns role=alertdialog,
 * aria-modal, BackHandler, escape and focus movement. Two differences remain, and both matter.
 * - Appearance: drawn with RowCat's surfaces, radii, type hierarchy and destructive color, so it
 *   reads as one product with the web's dialog.
 * - Copy can be re-rendered while open. Alert.alert freezes its text when shown, but these
 *   confirmations often state counts, for example `The 12 later messages will be deleted`. If a sync or creation lands
 *   in between, the number the user read would differ from what is actually deleted. The system
 *   alert is not banned outright. Where a platform convention is truly needed, such as OS
 *   permission prompts, it remains right. The default has changed. No destructive choice is the
 *   default. The confirm button gets no initial focus and cancel sits on the left, so an accidental
 *   double tap cannot reach the irreversible action. Backdrop taps do not dismiss it. Unlike a
 *   generic Dialog, this asks about something irreversible, so cancelling must be an intentional
 *   choice. Android back and screen-reader escape still work, since the primitive owns them, so
 *   there is no trap.
 */

/** Same axis as the web's sm:max-w-md. Confirmation text is short, so the box is narrow too. */
const MAX_WIDTH = 400;

export function AlertDialog({
	open,
	title,
	description,
	confirmLabel,
	cancelLabel = "Cancel",
	destructive = false,
	busy = false,
	error,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	/** The title says what the dialog does. Red alone conveys nothing to most readers. */
	title: string;
	/** What will disappear. Sentences that state a count usually go here. */
	description: string;
	confirmLabel: string;
	cancelLabel?: string;
	destructive?: boolean;
	/** Busy state: both buttons lock together, and screen readers are told busy. */
	busy?: boolean;
	/**
	 * Failures are shown inside the dialog. If shown after it closes, the user would read an action
	 * that did not happen as one that did, and walk away.
	 */
	error?: string | null;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	/**
	 * Follows the same rhythm and wiring as Dialog (motion/animate.ts). This is an irreversible
	 * confirmation, so it does not move more dramatically. The meaning comes from copy, button
	 * hierarchy and color. A shaking dialog is decoration, not explanation.
	 */
	const presence = usePrimitivePresence(open);
	const backdropStyle = useBackdropStyle(presence);
	const panelStyle = useDialogPanelStyle(presence, false);

	return (
		<AlertDialogPrimitive.Root
			open={presence.mounted}
			onOpenChange={(next) => {
				/**
				 * Does not close while busy. The cancel button is already disabled, but Android back and
				 * screen-reader escape are handled by the primitive. Without this filter the dialog would
				 * vanish while the deletion commits. The user would read it as cancelled while the operation
				 * finished anyway.
				 */
				if (next === open) return;
				if (!next && !busy) onCancel();
			}}
		>
			<AlertDialogPrimitive.Portal>
				<AlertDialogPrimitive.Overlay style={alert.overlay}>
					<Animated.View style={[alert.overlayFill, backdropStyle]}>
						<ScrimBlur />
					</Animated.View>
				</AlertDialogPrimitive.Overlay>
				{/**
				 * This layer does not let touches pass through.
				 * The primitive's Overlay is a plain View in an alert dialog, since it must not close on outside
				 * taps. Nothing catches presses, so the input and list behind would be pressed directly.
				 */}
				<AlertDialogPrimitive.Content
					onStartShouldSetResponder={() => true}
					style={alert.content}
				>
					<Animated.View
						style={[
							panelStyle,
							alert.panel,
							{
								backgroundColor: colors.popover,
								borderColor: colors.border,
								maxWidth: Math.min(
									MAX_WIDTH,
									width - insets.left - insets.right - space.lg * 2,
								),
							},
						]}
					>
						<View style={alert.heading}>
							<AlertDialogPrimitive.Title asChild>
								<Text variant="title">{title}</Text>
							</AlertDialogPrimitive.Title>
							<AlertDialogPrimitive.Description asChild>
								<Text variant="label" tone="muted-foreground">
									{description}
								</Text>
							</AlertDialogPrimitive.Description>
						</View>

						{error ? <Notice tone="destructive" message={error} /> : null}

						<View style={alert.actions}>
							{/**
							 * The primitive's Cancel and Action are not wrapped with asChild.
							 * Slot passes only onPress, and this Button does not spread arbitrary props, which is this
							 * package's rule. The caller closes the dialog through state, which has the same effect.
							 */}
							<Button
								label={cancelLabel}
								variant="outline"
								fullWidth
								disabled={busy}
								onPress={onCancel}
								style={alert.action}
							/>
							<Button
								label={confirmLabel}
								variant={destructive ? "destructive" : "primary"}
								fullWidth
								busy={busy}
								onPress={onConfirm}
								style={alert.action}
							/>
						</View>
					</Animated.View>
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	);
}

const alert = StyleSheet.create({
	/**
	 * The dimming behind the dialog is treated as a shadow, not a theme color, so it does not follow
	 * the theme.
	 */
	overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
	overlayFill: {
		backgroundColor: SCRIM_COLOR,
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	/**
	 * The backdrop has no onPress. A dialog asking about an irreversible action does not close on an
	 * outside tap, so this layer has no reason to pass touches through.
	 */
	content: {
		alignItems: "center",
		bottom: 0,
		justifyContent: "center",
		left: 0,
		padding: space.lg,
		position: "absolute",
		right: 0,
		top: 0,
	},
	panel: {
		borderRadius: radiusScale.xl,
		borderWidth: borderWidth,
		/** Android elevation. iOS is drawn by the shadow properties below instead. */
		elevation: 12,
		gap: space.md,
		padding: space.lg,
		shadowOffset: { height: 8, width: 0 },
		shadowOpacity: 0.24,
		shadowRadius: 24,
		width: "100%",
	},
	heading: { gap: space.xs },
	actions: { flexDirection: "row", gap: space.sm },
	action: { flex: 1 },
});
