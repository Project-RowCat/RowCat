import { space } from "@rowcat/design";
import { Button, Dialog, DialogActions, Notice } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { DUPLICATE_ROOM_CONFIRM } from "./actions.ts";

/**
 * Confirmation for duplicating a conversation; the web's `DuplicateRoomDialog` is its pair.
 *
 * A centered `Dialog`, not an `AlertDialog`: the container table asks "is it irreversible" second,
 * and a copy can be deleted (`docs/design/ARCHITECTURE.md` §제시 방식). It still confirms, because a
 * long conversation becomes thousands of new records that sync as their own, and a slipped press
 * would put a copy at the top of the list. The window stays open while the copy is written so a
 * failure is said in place.
 */
export function DuplicateRoomDialog({
	busy,
	error,
	onConfirm,
	onClose,
}: {
	busy: boolean;
	error: string | null;
	onConfirm: () => void;
	onClose: () => void;
}) {
	return (
		<Dialog
			title={DUPLICATE_ROOM_CONFIRM.title}
			description={DUPLICATE_ROOM_CONFIRM.message}
			open
			onOpenChange={(next) => {
				if (!next && !busy) onClose();
			}}
		>
			<View style={form.root}>
				{error ? <Notice tone="destructive" message={error} /> : null}
				<DialogActions>
					<Button
						label={DUPLICATE_ROOM_CONFIRM.cancel}
						variant="outline"
						fullWidth
						disabled={busy}
						onPress={onClose}
						style={form.action}
					/>
					<Button
						label={DUPLICATE_ROOM_CONFIRM.confirm}
						fullWidth
						busy={busy}
						onPress={onConfirm}
						style={form.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({
	root: { gap: space.md },
	/** Stretches to fill the stacked action row, as in the rename dialog. */
	action: { alignSelf: "stretch" },
});
