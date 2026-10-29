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

/**
 * A passkey was registered. Sent only after the registration is actually stored.
 *
 * It has no link: an action link in a security alert makes the mail a template for phishing, and
 * the user should reach the account screen by their usual path. Credential id, public key and
 * AAGUID are absent too; the user cannot read them and cannot judge anything from them.
 */
export function PasskeyAdded({
	to,
	label,
}: {
	to: MailRecipient;
	label: string | null;
}) {
	return (
		<Layout preview={`A passkey was added to your ${BRAND} account`}>
			<Greeting to={to} />
			<Text style={styles.text}>
				A passkey (<strong>{passkeyLabel(label)}</strong>) was added to your{" "}
				{BRAND} account. You can now sign in with that device.
			</Text>
			<Text style={styles.fine}>
				If this wasn't you, delete that passkey in the security section of the
				account screen, change your password, and sign out other devices.
			</Text>
		</Layout>
	);
}

PasskeyAdded.PreviewProps = { to: PREVIEW_RECIPIENT, label: "MacBook" };

export default PasskeyAdded;
