import { space } from "@rowcat/design";
import type { AccountDetails } from "@rowcat/domain";
import { resendCooldownRemaining } from "@rowcat/domain";
import { Badge, Button, Text } from "@rowcat/ui-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	requestAccountEmailChange,
	resendAccountVerificationEmail,
} from "../../lib/account-security-auth.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import {
	EMAIL_UNVERIFIED_LABEL,
	EMAIL_VERIFIED_LABEL,
} from "./account-copy.ts";
import { EmailChangeDialog } from "./email-change-dialog.tsx";
import {
	EMAIL_CHANGE_FAILED,
	EMAIL_CHANGE_LABEL,
	EMAIL_CHANGE_REQUESTED_NOTE,
	EMAIL_RESEND_FAILED,
	EMAIL_RESEND_LABEL,
	EMAIL_RESENDING_LABEL,
	EMAIL_RESENT_NOTE,
	EMAIL_UNVERIFIED_NOTE,
	emailResendCooldownLabel,
} from "./security-copy.ts";
import { authSecurityErrorMessage } from "./security-error.ts";

/**
 * Email: part of the credentials, with two operations.
 *
 * ```text
 * send verification mail   proves the current address is mine; only when unverified
 * change email             moves to another address; always available
 * ```
 *
 * Unverified is not drawn as a fault. On a deployment that does not require verification it is a
 * normal state, and on one that does, this person is already signed in and looking at the screen.
 * So no destructive colour and no wording as if the account were locked; the section gives a
 * concrete next step instead. Status is stated in text (`Verified`, `Verification needed`), not colour alone.
 *
 * Accepted and completed are told apart. Both operations only send one mail: a resend succeeding is
 * not "verified" and a change request is not "changed", and writing it that way would block someone
 * who left believing it at the next sign-in. So `emailVerified` is not set optimistically and
 * `account.email` is not edited by hand; the server's account info is the only source of truth.
 *
 * Failures end inside this section, which is why the state lives in this component: lifted to the
 * parent, one failure would affect sibling sections. A failed resend leaves the password, methods,
 * passkeys and sessions below drawn as usual.
 *
 * The cooldown is display state and is not persisted. It resets on app restart, which is correct:
 * the only authoritative fact is "just sent in this run", and the server does the abuse prevention
 * (this disabled button is no defence).
 */
export function EmailSection({ account }: { account: AccountDetails }) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [changePending, setChangePending] = useState(false);
	const [changeError, setChangeError] = useState<string | null>(null);
	/** The change request was accepted; nothing has changed yet, and the copy says so. */
	const [changeRequested, setChangeRequested] = useState(false);

	const [resendPending, setResendPending] = useState(false);
	const [resendError, setResendError] = useState<string | null>(null);
	const [resentAt, setResentAt] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const cooldown = resendCooldownRemaining(resentAt, now);

	/**
	 * Ticks the remaining seconds. With nothing ever sent there is no timer, so just keeping the
	 * screen open does not re-render every second.
	 */
	useEffect(() => {
		if (resentAt === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [resentAt]);

	const resend = (): void => {
		if (resendPending || cooldown > 0) return;
		setResendPending(true);
		setResendError(null);
		void resendAccountVerificationEmail(account.email)
			.then((failure) => {
				if (failure) {
					setResendError(
						authSecurityErrorMessage(failure, EMAIL_RESEND_FAILED),
					);
					return;
				}
				/**
				 * Records only that it was accepted. `emailVerified` is not set; the server flips it after the
				 * user opens the link in the mail.
				 */
				setResentAt(Date.now());
				setNow(Date.now());
			})
			.finally(() => setResendPending(false));
	};

	const submitChange = (newEmail: string): void => {
		setChangePending(true);
		setChangeError(null);
		void requestAccountEmailChange(newEmail)
			.then((failure) => {
				if (failure) {
					setChangeError(
						authSecurityErrorMessage(failure, EMAIL_CHANGE_FAILED),
					);
					return;
				}
				/**
				 * Closes the dialog, which discards the input. Account info is left alone: nothing has changed
				 * yet, and the change lands when the user opens the mail link and returns here (account info is
				 * re-fetched then).
				 */
				setDialogOpen(false);
				setChangeRequested(true);
			})
			.finally(() => setChangePending(false));
	};

	return (
		<View style={email.stack}>
			<View style={email.head}>
				<Text variant="body" style={email.address}>
					{account.email}
				</Text>
				<Badge
					label={
						account.emailVerified
							? EMAIL_VERIFIED_LABEL
							: EMAIL_UNVERIFIED_LABEL
					}
					variant={account.emailVerified ? "secondary" : "outline"}
				/>
			</View>

			{account.emailVerified ? null : (
				<Text variant="label" tone="muted-foreground">
					{EMAIL_UNVERIFIED_NOTE}
				</Text>
			)}

			<View style={email.actions}>
				{/**
				 * No resend control for an already verified address: it would do nothing (the
				 * server rejects with `EMAIL_ALREADY_VERIFIED`), and the user would read it as
				 * a problem with their account.
				 */}
				{account.emailVerified ? null : (
					<Button
						label={
							resendPending
								? EMAIL_RESENDING_LABEL
								: cooldown > 0
									? emailResendCooldownLabel(cooldown)
									: EMAIL_RESEND_LABEL
						}
						variant="outline"
						size="sm"
						busy={resendPending}
						disabled={cooldown > 0}
						onPress={resend}
					/>
				)}
				<Button
					label={EMAIL_CHANGE_LABEL}
					variant="outline"
					size="sm"
					onPress={() => {
						setChangeError(null);
						setChangeRequested(false);
						setDialogOpen(true);
					}}
				/>
			</View>

			{/**
			 * Two slots for answers: the resend's answer and the change-request note each keep
			 * their own place because both can be true at once (resend, then request a change).
			 */}
			{resendError ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{resendError}
					</Text>
				</FeedbackLine>
			) : resentAt !== null && cooldown > 0 ? (
				<Text variant="label" tone="muted-foreground">
					{EMAIL_RESENT_NOTE}
				</Text>
			) : null}

			{changeRequested ? (
				<Text variant="label" tone="muted-foreground">
					{EMAIL_CHANGE_REQUESTED_NOTE}
				</Text>
			) : null}

			{/**
			 * Mounted only while open, so closing discards the input. A viewer change unmounts the
			 * whole account tree (the screen's `key`), so a half-typed address never reaches the
			 * next person's form.
			 */}
			{dialogOpen ? (
				<EmailChangeDialog
					currentEmail={account.email}
					open
					pending={changePending}
					error={changeError}
					onClose={() => {
						setDialogOpen(false);
						setChangeError(null);
					}}
					onSubmit={submitChange}
				/>
			) : null}
		</View>
	);
}

const email = StyleSheet.create({
	stack: { gap: space.sm },
	head: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
	/** Keeps the address from being cut on narrow screens; a truncated email is the worst answer. */
	address: { flexShrink: 1, minWidth: 0 },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
