import type { AccountDetails } from "@rowcat/domain";
import { resendCooldownRemaining } from "@rowcat/domain";
import { invalidateAccountDetails } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import {
	resendErrorMessage,
	resendVerificationEmail,
} from "#/features/auth/email-verification.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	changeEmailErrorMessage,
	consumeEmailReturn,
	requestEmailChange,
} from "./change-email.ts";
import { ChangeEmailDialog } from "./change-email-dialog.tsx";

/**
 * Email row: the address, its verification state, resend (only while unverified) and change.
 *
 * Unverified is not drawn as an error. The user is already signed in, so the copy names the next
 * step instead of alarming them. The two actions differ: resend proves the current address, while
 * change moves the account to another one.
 *
 * Failures stay inside this section. The state lives here so a failure does not re-render the
 * password, session and passkey sections beside it.
 *
 * The resend result and the change-request notice have separate slots because both can be true at
 * once (resend, then request a change). The first slot's position is fixed by the second (see
 * `lib/motion/feedback.ts`). That is accepted: the notice sits below a paragraph with no controls,
 * and the rule it bends exists to keep a control from being stuck behind a half-finished exit,
 * which cannot happen here.
 */
export function EmailSection({ account }: { account: AccountDetails }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [changePending, setChangePending] = useState(false);
	const [changeError, setChangeError] = useState<string | null>(null);
	/** The change request was accepted, but the address has not changed yet. The copy says so. */
	const [changeRequested, setChangeRequested] = useState(false);

	const [resendPending, setResendPending] = useState(false);
	const [resendError, setResendError] = useState<string | null>(null);
	const [resentAt, setResentAt] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const cooldown = resendCooldownRemaining(resentAt, now);

	useEffect(() => {
		if (resentAt === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [resentAt]);

	/**
	 * After the user returns from the confirmation link, reload account details once.
	 *
	 * The `?email=changed` marker is not trusted: anyone can type it into the address bar. The server
	 * decides what actually changed, so this effect only clears the marker and asks again (the
	 * provider connection makes the same decision). The guard is needed because the marker stays in
	 * the URL until cleared, so without it the query would fire on every render.
	 */
	const consumed = useRef(false);
	useEffect(() => {
		if (consumed.current) return;
		if (!consumeEmailReturn()) return;
		consumed.current = true;
		void invalidateAccountDetails(queryClient);
	}, [queryClient]);

	const resend = (): void => {
		if (resendPending || cooldown > 0) return;
		setResendPending(true);
		setResendError(null);
		void resendVerificationEmail(account.email)
			.then((failure) => {
				if (failure) {
					setResendError(resendErrorMessage(failure as AuthFailure));
					return;
				}
				setResentAt(Date.now());
				setNow(Date.now());
			})
			.finally(() => setResendPending(false));
	};

	const submitChange = (newEmail: string): void => {
		setChangePending(true);
		setChangeError(null);
		void requestEmailChange(newEmail)
			.then((failure) => {
				if (failure) {
					setChangeError(changeEmailErrorMessage(failure as AuthFailure));
					return;
				}
				setDialogOpen(false);
				setChangeRequested(true);
			})
			.finally(() => setChangePending(false));
	};

	return (
		<div className="flex flex-col gap-3 pt-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 text-sm break-all">{account.email}</span>
				{/*
				 * The state is stated in words. A color-only signal tells nothing to someone who
				 * cannot distinguish the colors.
				 */}
				<Badge variant={account.emailVerified ? "secondary" : "outline"}>
					{account.emailVerified
						? t("emailSection.verified")
						: t("emailSection.verificationNeeded")}
				</Badge>
			</div>

			{!account.emailVerified && (
				<p className="text-sm text-muted-foreground">
					{/*
					 * Phrased as a to-do, not a failure. The user is already signed in, so the copy
					 * does not frighten them about what they are losing.
					 */}
					{t("emailSection.openTheVerificationEmailIn")}
				</p>
			)}

			<div className="flex flex-wrap gap-2">
				{!account.emailVerified && (
					<Button
						variant="outline"
						size="sm"
						disabled={resendPending || cooldown > 0}
						onClick={resend}
					>
						{/*
						 * Only the remaining seconds tick. Same wiring as the same button on the
						 * verification notice screen (`features/auth/verification-notice.tsx`).
						 * Identical actions that move differently on two screens only show when
						 * compared side by side.
						 */}
						{resendPending ? (
							t("emailSection.sending")
						) : cooldown > 0 ? (
							<>
								{t("emailSection.resendIn")}
								<AnimatedCount value={String(cooldown)} cadence="continuous" />
								{t("emailSection.seconds")}
							</>
						) : (
							t("emailSection.sendVerificationEmail")
						)}
					</Button>
				)}
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						setChangeError(null);
						setChangeRequested(false);
						setDialogOpen(true);
					}}
				>
					{t("emailSection.changeEmail")}
				</Button>
			</div>

			{/*
			 * The one slot where the resend result stands. Failure and success exclude each other,
			 * so `mode="wait"` draws exactly that. Overlaid, the next sentence would stand beside
			 * the failure when it disappears, and this section would jump in height.
			 *
			 * The remaining seconds do not re-trigger this transition. The cooldown re-renders every
			 * second, but this slot's `key` is only `sent`. Putting the seconds in the key would fade
			 * the sentence in and out every second, and a live region would be re-read every second
			 * by screen reader users. The cooldown button is a single state for the same reason:
			 * only its text changes.
			 *
			 * Screen readers announce on the content change regardless of motion.
			 */}
			<output aria-live="polite" className="empty:hidden">
				<AnimatePresence initial={false} mode="wait">
					{resendError ? (
						<m.span
							key={`error:${resendError}`}
							initial={feedbackEnter.initial}
							animate={feedbackEnter.animate}
							exit={feedbackExit}
							transition={feedbackEnter.transition}
							className="block text-sm text-destructive"
						>
							{resendError}
						</m.span>
					) : resentAt !== null && cooldown > 0 ? (
						<m.span
							key="sent"
							initial={feedbackEnter.initial}
							animate={feedbackEnter.animate}
							exit={feedbackExit}
							transition={feedbackEnter.transition}
							className="block text-sm text-muted-foreground"
						>
							{t("emailSection.weSentAVerificationEmail")}
						</m.span>
					) : null}
				</AnimatePresence>
			</output>

			{/*
			 * The change notice states first that the address has NOT changed. Writing "changed"
			 * would lock out someone who trusts it, leaves, and then fails at the next sign-in.
			 */}
			<AnimatePresence initial={false}>
				{changeRequested && (
					<m.p
						key="change-requested"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"
					>
						{t("emailSection.weSentAConfirmationEmail")}
					</m.p>
				)}
			</AnimatePresence>

			{dialogOpen && (
				<ChangeEmailDialog
					currentEmail={account.email}
					pending={changePending}
					error={changeError}
					onClose={() => {
						setDialogOpen(false);
						setChangeError(null);
					}}
					onSubmit={submitChange}
				/>
			)}
		</div>
	);
}
