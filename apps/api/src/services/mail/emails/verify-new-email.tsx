import { Text } from "react-email";
import {
	Action,
	BRAND,
	Greeting,
	Layout,
	type MailRecipient,
	PREVIEW_RECIPIENT,
	PREVIEW_URL,
	styles,
} from "../components.tsx";

/** Email change step 2: ownership confirmation sent to the new address. */
export function VerifyNewEmail({
	to,
	url,
}: {
	to: MailRecipient;
	url: string;
}) {
	return (
		<Layout preview={`Confirm your new ${BRAND} email address`}>
			<Greeting to={to} />
			<Text style={styles.text}>
				There was a request to use this address as your {BRAND} account's new
				email address.
			</Text>
			<Action url={url} label="Confirm the new address" />
			<Text style={styles.fine}>
				This link expires after a while. If you didn't request this, please
				ignore this email — nothing happens unless the link is opened.
			</Text>
		</Layout>
	);
}

VerifyNewEmail.PreviewProps = { to: PREVIEW_RECIPIENT, url: PREVIEW_URL };

export default VerifyNewEmail;
