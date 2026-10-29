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
 * Password reset: one link letting the address owner set a new password. Opening it changes
 * nothing; a new password must be submitted. The body says so to tell someone who did not request
 * it that ignoring is the only step.
 */
export function PasswordReset({ to, url }: { to: MailRecipient; url: string }) {
	return (
		<Layout preview={`Reset your ${BRAND} password`}>
			<Greeting to={to} />
			<Text style={styles.text}>
				There was a request to reset your {BRAND} account's password. Press the
				button below to set a new password.
			</Text>
			<Action url={url} label="Set a new password" />
			<Text style={styles.fine}>
				This link expires in 1 hour and can be used only once. Once you set a
				new password, you'll be signed out on every device that was signed in to
				this account. If you didn't request this, please ignore this email —
				nothing changes unless you open the link and set a new password.
			</Text>
		</Layout>
	);
}

PasswordReset.PreviewProps = { to: PREVIEW_RECIPIENT, url: PREVIEW_URL };

export default PasswordReset;
