import { resendCooldownRemaining } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import type { AuthFailure } from "./auth-error.ts";
import {
	resendErrorMessage,
	resendVerificationEmail,
} from "./email-verification.ts";

/**
 * "Check your email" panel. The post-signup path and the unverified sign-in path both use **this
 * same panel**.
 *
 * The two arrive from different routes, but the person has the same job: open the inbox and click
 * the link. Splitting the screen would keep that sentence in two places and duplicate the resend
 * rules. Only the first line differs. Telling someone who just created the account the same thing
 * as someone who created it long ago would make the latter think something happened to their
 * account.
 *
 * ## No session is invented here
 *
 * Showing this panel means there is **no session** (on deployments that require verification,
 * signup returns no session, and an unverified sign-in answers 403). So this component does not
 * create a viewer, fill caches or navigate. The only way forward is returning to the login screen
 * after verification.
 *
 * ## The address is shown in full
 *
 * It is not masked, because finding a typo is part of this screen's purpose. The most common reason
 * a mail never arrives is a mistyped address, not the server, and masking it as `us**@ex...` would
 * hide what is wrong. The value is what the person just typed, and this screen lives in their
 * browser.
 */
export function VerificationNotice({
	email,
	mode,
	returnPath,
	onBack,
}: {
	email: string;
	/** Whether they just signed up, or tried to sign in to an existing account that is still unverified. */
	mode: "signup" | "signin";
	/**
	 * The app-internal path to continue to after verification.
	 *
	 * A resent mail's link must return to the **same place** as the first one. If they diverged, only
	 * the person who pressed resend would lose their destination.
	 */
	returnPath?: string;
	/** Back to the form. This is the path for a mistyped address. */
	onBack: () => void;
}) {
	const { t } = useTranslation("auth");
	const [lastSentAt, setLastSentAt] = useState<number | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState(false);
	/**
	 * Counts the remaining seconds once per second. The value is derived from `lastSentAt` rather than
	 * stored in state. Storing it would let the timer drift while the tab is in the background,
	 * leaving the button locked longer than it should be.
	 */
	const [now, setNow] = useState(() => Date.now());
	const remaining = resendCooldownRemaining(lastSentAt, now);

	useEffect(() => {
		if (lastSentAt === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [lastSentAt]);

	const resend = (): void => {
		if (pending || remaining > 0) return;
		setPending(true);
		setError(null);
		setSent(false);
		void resendVerificationEmail(email, returnPath)
			.then((failure) => {
				if (failure) {
					setError(resendErrorMessage(failure as AuthFailure));
					return;
				}
				setSent(true);
				setLastSentAt(Date.now());
				setNow(Date.now());
			})
			.finally(() => setPending(false));
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<h2 className="text-base font-semibold">{t("verification.title")}</h2>
				<p className="text-sm text-muted-foreground">
					{mode === "signup"
						? t("verification.created")
						: t("verification.notVerified")}
				</p>
				{/*
				 * Emphasize the address. It is the first value the person should check on this screen,
				 * and a typo is caught here.
				 */}
				<p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium break-all">
					{email}
				</p>
				<p className="text-sm text-muted-foreground">
					{t("verification.body")}
				</p>
			</div>

			{/*
			 * The result goes **below** the button, not above it: the answer should sit next to what was just
			 * pressed. It is a live region because this text appears without a page change.
			 */}
			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					size="lg"
					disabled={pending || remaining > 0}
					onClick={resend}
				>
					{/*
					 * Only the remaining seconds roll. The button, the parentheses and the unit all stay put
					 * (see "which numbers roll" in `docs/motion/ARCHITECTURE.md`). Keying this button and
					 * swapping it wholesale would re-create one control every second, and the focus and the
					 * accessible name would wobble with it.
					 *
					 * The cadence is `continuous` because the next change is already on its way.
					 *
					 * The accessible name stays `Resend (29s)`: the rolling parts are `aria-hidden`, and
					 * the name is the one `sr-only` chunk from `AnimatedCount`. No `aria-live` here: this number
					 * is a visual state, and announcing it every second would interrupt screen readers rather
					 * than inform them.
					 */}
					{pending ? (
						t("verification.sending")
					) : remaining > 0 ? (
						<>
							{t("verification.resendIn")}
							<AnimatedCount value={String(remaining)} cadence="continuous" />
							{t("verification.seconds")}
						</>
					) : (
						t("verification.resend")
					)}
				</Button>
				{/*
				 * Same rhythm as the matching field on the account screen (`features/account/email-section.tsx`).
				 * When the same action's answer arrives differently on two screens, the difference is only
				 * visible when they sit side by side. Only the wording and placement are each screen's own.
				 *
				 * The live region's policy stays as is. What moves is the child **inside** it; the `output`
				 * element stays mounted and remains the owner of the announcement. Mounting and unmounting the
				 * region itself would make assistive technology miss the change.
				 *
				 * The remaining seconds do not re-trigger this transition: `key` is just `sent`, so the node
				 * stays put through the one-second re-renders.
				 */}
				<output aria-live="polite" className="empty:hidden">
					<AnimatePresence initial={false} mode="wait">
						{error ? (
							<m.span
								key={`error:${error}`}
								initial={feedbackEnter.initial}
								animate={feedbackEnter.animate}
								exit={feedbackExit}
								transition={feedbackEnter.transition}
								className="block text-sm text-destructive"
							>
								{error}
							</m.span>
						) : sent ? (
							<m.span
								key="sent"
								initial={feedbackEnter.initial}
								animate={feedbackEnter.animate}
								exit={feedbackExit}
								transition={feedbackEnter.transition}
								className="block text-sm text-muted-foreground"
							>
								{t("verification.resent")}
							</m.span>
						) : null}
					</AnimatePresence>
				</output>
			</div>

			{/*
			 * The way back. For someone who mistyped the address, this is the only fix: sign up again with the
			 * correct address, or sign in with it.
			 */}
			<Button type="button" variant="ghost" size="sm" onClick={onBack}>
				{t("verification.wrongAddress")}
			</Button>
		</div>
	);
}
