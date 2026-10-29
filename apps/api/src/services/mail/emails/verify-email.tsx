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

/** Signup and resend: confirm that this address is yours. */
export function VerifyEmail({ to, url }: { to: MailRecipient; url: string }) {
	return (
		<Layout preview={`Verify your ${BRAND} email address`}>
			<Greeting to={to} />
			<Text style={styles.text}>
				Please verify the email address of your {BRAND} account.
			</Text>
			<Action url={url} label="Verify email" />
			<Text style={styles.fine}>
				This link expires after a while. If it has expired, you can send it
				again from the sign-in screen. If you didn't request this, please ignore
				this email.
			</Text>
		</Layout>
	);
}

VerifyEmail.PreviewProps = { to: PREVIEW_RECIPIENT, url: PREVIEW_URL };

export default VerifyEmail;
