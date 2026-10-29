import { AlertDialog } from "@rowcat/ui-native";
import {
	revokeOthersDescription,
	SESSIONS_REVOKE_OTHERS_CONFIRM_LABEL,
	SESSIONS_REVOKE_OTHERS_TITLE,
	SESSIONS_REVOKING_LABEL,
} from "./security-copy.ts";

/**
 * Confirmation for signing out all other devices.
 *
 * The count goes in the sentence. "End all other sessions" does not say whether that is one device
 * or six, and that difference is what the user decides on.
 *
 * It also states that this device stays signed in. Without that, the button cannot tell whether it
 * signs me out too, and people do not press what they do not understand; yet the situation that
 * needs it (a lost device) is when they must.
 *
 * `Alert.alert` is avoided here especially: it is imperative, so its sentence freezes when shown,
 * but this one states a count. If another device signs in or expires meanwhile, the number read and
 * the real scope diverge. `AlertDialog` recounts on every render.
 */
export function RevokeOthersDialog({
	count,
	open,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	/** Number of sessions that will end; this device is excluded. */
	count: number;
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog
			open={open}
			title={SESSIONS_REVOKE_OTHERS_TITLE}
			description={revokeOthersDescription(count)}
			confirmLabel={
				pending ? SESSIONS_REVOKING_LABEL : SESSIONS_REVOKE_OTHERS_CONFIRM_LABEL
			}
			destructive
			busy={pending}
			error={error}
			onConfirm={onConfirm}
			onCancel={onClose}
		/>
	);
}
