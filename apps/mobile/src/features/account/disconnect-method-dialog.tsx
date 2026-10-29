import type { LoginMethod, LoginMethodProvider } from "@rowcat/domain";
import { AlertDialog } from "@rowcat/ui-native";
import { LOGIN_METHOD_LABEL } from "./account-copy.ts";
import {
	disconnectDialogDescription,
	disconnectDialogTitle,
	LOGIN_METHOD_DISCONNECT_LABEL,
	LOGIN_METHOD_DISCONNECTING_LABEL,
} from "./security-copy.ts";

/**
 * Login method disconnect confirmation; it states what remains from server state.
 *
 * No "Are you sure?" dialog: that sentence carries no information and gets pressed unread. The only
 * thing the user must judge is whether they can still sign in afterwards. The answer is not
 * invented here: the remaining methods are computed by a pure function from the server's account
 * info (`remaining` of `canDisconnectLoginMethod`) and this component only turns them into a
 * sentence. Filtering again here would let the two diverge, and the confirmation text would lie.
 *
 * It is an `AlertDialog` because this is an irreversible confirmation: it reduces future access and
 * cannot be undone until another method is connected. The container follows the interaction's
 * character, not the platform (`docs/design/ARCHITECTURE.md`). `Alert.alert` is out because the
 * sentence lists the remaining methods, and an imperative alert freezes its text at show time and
 * misses changes arriving in between.
 */
export function DisconnectMethodDialog({
	target,
	remaining,
	open,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	target: LoginMethodProvider;
	/** The methods left after disconnecting, computed from server account state. */
	remaining: readonly LoginMethod[];
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const label = LOGIN_METHOD_LABEL[target];
	return (
		<AlertDialog
			open={open}
			title={disconnectDialogTitle(label)}
			description={disconnectDialogDescription(
				label,
				remaining
					.map((method) => LOGIN_METHOD_LABEL[method.provider])
					.join(" · "),
			)}
			confirmLabel={
				pending
					? LOGIN_METHOD_DISCONNECTING_LABEL
					: LOGIN_METHOD_DISCONNECT_LABEL
			}
			destructive
			busy={pending}
			error={error}
			onConfirm={onConfirm}
			onCancel={onClose}
		/>
	);
}
