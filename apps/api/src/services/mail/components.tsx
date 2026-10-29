import { APP_NAME } from "@rowcat/domain";
import type { ReactNode } from "react";
import {
	Body,
	Button,
	Container,
	Head,
	Hr,
	Html,
	Link,
	Preview,
	Section,
	Text,
} from "react-email";

/**
 * Pieces shared by all the mail copies. They live outside `emails/` on purpose: `react-email dev`
 * lists every file in that folder as a mail, so a helper file there would add an unsendable entry
 * and the list would stop answering what can be sent. The file count in `emails/` equals the event
 * count.
 */

export interface MailRecipient {
	email: string;
	name?: string | null | undefined;
}

/** Used by both the subject prefix and the body signature; sourced from `@rowcat/domain`. */
export const BRAND = APP_NAME;

/**
 * The form of address: display name, else email. No generic "member", because these mails must say
 * which account they concern; an unnamed security alert tells a multi-account person nothing.
 */
export const greeting = (to: MailRecipient): string =>
	to.name?.trim() || to.email;

/** Unlabelled passkeys get a generic name; device names are never invented. */
export const passkeyLabel = (label: string | null): string =>
	label?.trim() || "passkey";

/**
 * Inline style objects because mail clients handle `<style>` and external sheets inconsistently
 * (Gmail drops some) and some cannot use class selectors. The `Tailwind` wrapper folds to inline
 * anyway, so it adds a rule layer for no gain at this copy count.
 */
export const styles = {
	body: {
		backgroundColor: "#ffffff",
		fontFamily:
			"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" as const,
		color: "#111111",
	},
	container: {
		maxWidth: "560px",
		margin: "0 auto",
		padding: "24px",
		lineHeight: "1.6",
	},
	text: { fontSize: "15px", lineHeight: "1.6", margin: "0 0 12px" },
	fine: { fontSize: "13px", color: "#666666", lineHeight: "1.6", margin: "0" },
	hr: { borderColor: "#e5e5e5", margin: "28px 0 16px" },
	footer: { fontSize: "12px", color: "#666666", margin: "0" },
	button: {
		backgroundColor: "#111111",
		color: "#ffffff",
		textDecoration: "none",
		padding: "12px 20px",
		borderRadius: "8px",
		fontWeight: 600,
		fontSize: "15px",
		display: "inline-block",
	},
	url: { color: "#111111", wordBreak: "break-all" as const },
};

/**
 * Common shell. `Preview` is the inbox preview line; left empty, clients use the first body
 * characters, and every body starts with the greeting, so all previews would read the same.
 *
 * No remote images, web fonts or external stylesheets: they look like open tracking and most
 * clients block them.
 */
export function Layout({
	preview,
	children,
}: {
	preview: string;
	children: ReactNode;
}) {
	return (
		<Html lang="en">
			<Head />
			<Preview>{preview}</Preview>
			<Body style={styles.body}>
				<Container style={styles.container}>
					{children}
					<Hr style={styles.hr} />
					<Text style={styles.footer}>{BRAND}</Text>
				</Container>
			</Body>
		</Html>
	);
}

/**
 * Action button plus the address as plain text. Some clients do not press buttons, and users must
 * be able to read where a link goes: verification mail is a phishing target, so we do not break
 * that habit first.
 */
export function Action({ url, label }: { url: string; label: string }) {
	return (
		<>
			<Section style={{ margin: "24px 0" }}>
				<Button href={url} style={styles.button}>
					{label}
				</Button>
			</Section>
			<Text style={styles.fine}>
				If the button doesn't work, paste the address below into your browser.
				<br />
				<Link href={url} style={styles.url}>
					{url}
				</Link>
			</Text>
		</>
	);
}

export const Greeting = ({ to }: { to: MailRecipient }) => (
	<Text style={styles.text}>Hi {greeting(to)},</Text>
);

/**
 * Fake recipient for `react-email dev`'s `PreviewProps`. It must be obviously fake because previews
 * end up in screenshots and reviews as-is.
 */
export const PREVIEW_RECIPIENT: MailRecipient = {
	email: "member@example.test",
	name: "Jamie Lee",
};

/** Preview link; no realistic-looking token. */
export const PREVIEW_URL = "https://example.test/preview-link";
