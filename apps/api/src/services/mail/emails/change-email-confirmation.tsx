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

/**
 * Email change step 1: an approval request sent to the current address. This mail is the security
 * notice itself; if whoever started the change does not own the current address, it is the only
 * place that fact surfaces.
 */
export function ChangeEmailConfirmation({
	to,
	newEmail,
	url,
}: {
	to: MailRecipient;
	newEmail: string;
	url: string;
}) {
	return (
		<Layout preview={`Approve your ${BRAND} email change`}>
			<Greeting to={to} />
			<Text style={styles.text}>
				There was a request to change your {BRAND} account's email address to{" "}
				<strong>{newEmail}</strong>.
			</Text>
			<Text style={styles.text}>
				Approve it below, and one more verification email goes to the new
				address. The change completes once that email is verified at the new
				address.
			</Text>
			<Action url={url} label="Approve the change" />
			<Text style={styles.fine}>
				If you didn't request this, don't open this link. Your email address
				won't change unless the link is opened. We recommend changing your
				password on the account screen and signing out other devices.
			</Text>
		</Layout>
	);
}

ChangeEmailConfirmation.PreviewProps = {
	to: PREVIEW_RECIPIENT,
	newEmail: "new-address@example.test",
	url: PREVIEW_URL,
};

export default ChangeEmailConfirmation;
