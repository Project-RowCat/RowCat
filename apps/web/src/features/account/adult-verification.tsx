import {
	beginAdultVerificationMutationOptions,
	completeAdultVerificationMutationOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import {
	consumeIdentityReturn,
	runIdentityHandoff,
} from "#/lib/identity/handoff.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	type AdultVerificationOffer,
	type AdultVerificationPhase,
	adultVerificationBusyLabel,
	adultVerificationErrorMessage,
	identityHandoffMessage,
} from "./adult-verification-state.ts";

/**
 * Adult eligibility verification: the **identity-verification action** on the account screen.
 *
 * ## Not one component with the visibility switch
 *
 * The switch beside it decides whether someone who is already eligible sees adult works. This
 * component **creates eligibility**. Putting both in one component would read as one action, and
 * that impression becomes "verifying turns adult content on", which the server does not do
 * (`show_adult` appears in no transaction of this procedure).
 *
 * ## The provider's success is not a conclusion
 *
 * The browser SDK saying "done" is a value inside this browser. So at that point this component
 * changes no state and **only sends the completion request** to the server. The server asks the
 * provider back with its own secret and decides; the screen draws the viewer as confirmed by that
 * response.
 *
 * ## The account can change
 *
 * While the verification window is open, another tab may sign out and sign in as a different
 * account. The completion request is then judged against **the member of the current session**, and
 * if that member has no open attempt it returns 404. The real protection is that this component
 * holds no attempt identifier (if it did, someday that value would be sent along).
 */
export function AdultVerification({
	offer,
}: {
	offer: AdultVerificationOffer;
}) {
	const { t } = useTranslation(["account", "common"]);
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const [phase, setPhase] = useState<AdultVerificationPhase>("idle");
	/**
	 * Handoff failure itself: not a server error but **the window never opened or the provider
	 * refused**. It is kept apart from mutation errors because those are different sentences.
	 */
	const [handoffError, setHandoffError] = useState<string | null>(null);

	const begin = useMutation(beginAdultVerificationMutationOptions(client));
	const complete = useMutation(
		completeAdultVerificationMutationOptions(client, queryClient),
	);

	/**
	 * If the person **returned** from the provider, ask the server to confirm, exactly once.
	 *
	 * On mobile the verification window leaves the page entirely, so the memory holding the start
	 * response is gone. The returned screen has one job, "it is done, please confirm", and the server
	 * knows which attempt it is, so this effect carries no value.
	 *
	 * The return marker stays in the address across renders, so without the guard every render would
	 * send a request. **The address value is not read or sent** — only the fact of returning is read,
	 * and the same function clears the marker (so refresh and back do not repeat the request).
	 */
	const submittedRef = useRef(false);
	useEffect(() => {
		if (submittedRef.current) return;
		if (!consumeIdentityReturn()) return;
		submittedRef.current = true;
		setPhase("completing");
		complete.mutate(undefined, { onSettled: () => setPhase("idle") });
	}, [complete]);

	if (offer === "none") return null;

	const busy = phase !== "idle";
	const error =
		handoffError ??
		(begin.error ? adultVerificationErrorMessage(begin.error) : null) ??
		(complete.error ? adultVerificationErrorMessage(complete.error) : null);

	const start = async (): Promise<void> => {
		setHandoffError(null);
		begin.reset();
		complete.reset();
		setPhase("starting");
		try {
			/**
			 * The server creates the attempt and returns **how to hand off**. We do not pick the provider,
			 * and we send no return address: passing a client-supplied address would make that parameter an
			 * open redirect.
			 */
			const started = await begin.mutateAsync().catch(() => null);
			if (!started) return;

			setPhase("provider");
			const outcome = await runIdentityHandoff(started.handoff);

			if (outcome.status === "completed") {
				setPhase("completing");
				await complete.mutateAsync().catch(() => undefined);
				return;
			}
			/**
			 * `navigating` gets no sentence: the page is leaving, so anything drawn disappears. `cancelled`
			 * is the same: a window the user closed is not a failure, and showing an error would make them
			 * doubt their device.
			 */
			setHandoffError(identityHandoffMessage(outcome));
		} finally {
			/**
			 * On `navigating` the page leaves before this line runs. If the component is still here, the
			 * procedure ended on this screen, so the phase is reset.
			 */
			setPhase("idle");
		}
	};

	return (
		<div className="mt-4 flex flex-col gap-2 border-t pt-4">
			{offer === "renew" ? (
				/*
				 * **One-year re-verification.** Eligibility is intact and only viewing is closed, so this
				 * sentence sits beside the switch and does not replace it. Even with the switch on, the content
				 * stays hidden; saying so matters: without it, someone who turned the switch on would see it as
				 * broken. The switch alone does not show that the content is still closed.
				 */
				<>
					<p className="text-sm">{t("adultVerification.itSBeenAYear")}</p>
					<p className="text-sm text-muted-foreground">
						{t("adultVerification.verifyYourIdentityAgainTo")}
					</p>
					<div>
						<Button size="sm" disabled={busy} onClick={() => void start()}>
							{busy
								? adultVerificationBusyLabel(phase)
								: t("adultVerification.verifyIdentity")}
						</Button>
					</div>
				</>
			) : offer === "verify" ? (
				<>
					<p className="text-sm">
						{t("adultVerification.identityVerificationIsRequiredTo")}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("adultVerification.verifyingYourIdentityForExample")}
					</p>
					<div>
						<Button size="sm" disabled={busy} onClick={() => void start()}>
							{busy
								? adultVerificationBusyLabel(phase)
								: t("adultVerification.verifyIdentity")}
						</Button>
					</div>
				</>
			) : (
				/*
				 * **Re-verification stays quiet.** A big retry button for someone under 19 would encourage them
				 * to try a different age, and all they can actually do is wait. The path is still kept because
				 * the server stores no birth date, so eligibility never opens on its own and re-verifying is
				 * the only way.
				 */
				<>
					<p className="text-sm text-muted-foreground">
						{t("adultVerification.onceYouTurn19Verify")}
					</p>
					<div>
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => void start()}
						>
							{busy
								? adultVerificationBusyLabel(phase)
								: t("adultVerification.verifyAgain")}
						</Button>
					</div>
				</>
			)}

			{/*
			 * Verification leaves the page and comes back, so its answer arrives as the **last flow child** of this section.
			 * It uses the same enter/exit rhythm as other feedback
			 * (`feedback.ts`), and the exit delays nothing else.
			 */}
			<AnimatePresence initial={false} mode="wait">
				{error && (
					<m.p
						key={error}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>
		</div>
	);
}
