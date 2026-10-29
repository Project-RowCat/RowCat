import { Text } from "react-email";
import {
	BRAND,
	Greeting,
	Layout,
	type MailRecipient,
	PREVIEW_RECIPIENT,
	passkeyLabel,
	styles,
} from "../components.tsx";

/** A passkey was removed. Sent only after the removal succeeded; no link here either. */
export function PasskeyRemoved({
	to,
	label,
}: {
	to: MailRecipient;
	label: string | null;
}) {
	return (
		<Layout preview={`A passkey was removed from your ${BRAND} account`}>
			<Greeting to={to} />
			<Text style={styles.text}>
				A passkey (<strong>{passkeyLabel(label)}</strong>) was removed from your{" "}
				{BRAND} account. That device can no longer sign in.
			</Text>
			<Text style={styles.fine}>
				If this wasn't you, change your password and sign out other devices.
			</Text>
		</Layout>
	);
}

PasskeyRemoved.PreviewProps = { to: PREVIEW_RECIPIENT, label: null };

export default PasskeyRemoved;
