import {
	guardianConsentMutationOptions,
	guardianConsentQueryOptions,
	guardianDeclineMutationOptions,
	guardianVerifyMutationOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { intlLocale } from "#/lib/i18n/format.ts";
import {
	consumeIdentityReturn,
	runIdentityHandoff,
} from "#/lib/identity/handoff.ts";
import { guardianConsentError } from "./membership-gate-state.ts";

/**
 * The guardian consent screen, seen by a guardian rather than a member.
 *
 * The guardian has no session or account, only the link the child passed on. This screen is
 * therefore outside the (app) group and uses neither the app shell nor the entry gate. With sidebar
 * items such as Discover, Chat and Create visible, a guardian would not know which account they are
 * being asked to approve.
 *
 * The screen never shows the child's identity. The server does not return it
 * (GuardianConsentViewDto). If the link reaches the wrong person, they learn only that an under-14
 * sign-up request exists. This is the most carefully limited point in the contract.
 *
 * Order: identity verification, then reading the notice, then explicit consent. PIPA 22-2(1)
 * requires not only obtaining guardian consent but confirming that it was given. A checkbox without
 * verification is indistinguishable from the child ticking it, so the consent button does not exist
 * until verification completes. The server enforces the same order (status = 'verified').
 *
 * Required consent boxes are ticked by the user. This avoids dark patterns, but more basically,
 * pre-ticked consent is not consent.
 */
export function GuardianConsentPage({ token }: { token: string }) {
	const { t } = useTranslation("onboarding");
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const agreeId = useId();
	const [agreed, setAgreed] = useState(false);
	/**
	 * Handoff failure: the verification window did not open, or the verifier refused. This is not a
	 * server error. It is kept apart from the mutation error because the two are different sentences.
	 */
	const [handoffError, setHandoffError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);

	const view = useQuery(guardianConsentQueryOptions(client, token));
	const verify = useMutation(
		guardianVerifyMutationOptions(client, queryClient, token),
	);
	const consent = useMutation(
		guardianConsentMutationOptions(client, queryClient, token),
	);
	const decline = useMutation(
		guardianDeclineMutationOptions(client, queryClient, token),
	);

	/**
	 * After the user returns from the verifier, the screen asks the server to check the result, once.
	 * The return marker stays in the URL across renders, so without a guard each re-render would send
	 * another request, repeatedly hitting the verifier and the server's anti-flood limits.
	 *
	 * The screen reads only the fact that the user returned. It never sends the URL's value to the
	 * server: the server stored which verification session this is when it started. Echoing an
	 * identifier from the URL would let someone attach another person's verification to this request.
	 * The same function clears the marker, so refresh, share or back navigation does not repeat it.
	 */
	const submittedRef = useRef(false);
	useEffect(() => {
		if (submittedRef.current) return;
		if (!consumeIdentityReturn()) return;
		submittedRef.current = true;
		verify.mutate();
	}, [verify]);

	if (view.isPending) return <Shell>{null}</Shell>;

	if (view.isError)
		return (
			<Shell>
				<h1 className="text-xl font-bold tracking-tight">
					{t("guardianConsent.openFailed")}
				</h1>
				<p
					className="mt-3 text-sm leading-7 text-muted-foreground"
					role="alert"
				>
					{guardianConsentError(view.error)}
				</p>
			</Shell>
		);

	const data = view.data;
	if (data.status === "approved") return <Shell>{<Approved />}</Shell>;
	if (data.status === "declined") return <Shell>{<Declined />}</Shell>;
	if (data.status === "revoked")
		return (
			<Shell>
				<h1 className="text-xl font-bold tracking-tight">
					{t("guardianConsent.invalidLinkTitle")}
				</h1>
				<p className="mt-3 text-sm leading-7 text-muted-foreground">
					{t("guardianConsent.invalidLinkBody")}
				</p>
			</Shell>
		);

	const busy =
		starting || verify.isPending || consent.isPending || decline.isPending;
	const error =
		handoffError ??
		guardianConsentError(consent.error) ??
		guardianConsentError(verify.error) ??
		guardianConsentError(decline.error);

	return (
		<Shell>
			<h1 className="text-xl font-bold tracking-tight">
				{t("guardianConsent.title")}
			</h1>
			<Disclosure expiresAt={data.expiresAt} />

			{data.verified ? (
				<>
					<div className="mt-6 flex items-start gap-2.5">
						{/*
						 * The checkbox has a real label (htmlFor). A label-less checkbox is read by screen readers only as
						 * 'checkbox', so the user would agree without knowing to what, which is not consent.
						 * mt-1 is a calculation, not a visual fudge: the box is 16px and the label's line box is 24px, so
						 * (24 - 16) / 2 = 4px aligns the box with the first line.
						 */}
						<Checkbox
							id={agreeId}
							className="mt-1"
							checked={agreed}
							disabled={busy}
							onCheckedChange={(value) => setAgreed(value === true)}
						/>
						<label htmlFor={agreeId} className="text-sm leading-6">
							<Trans
								t={t}
								i18nKey="guardianConsent.agree"
								components={{
									muted: <span className="text-muted-foreground" />,
								}}
							/>
						</label>
					</div>

					<Button
						className="mt-5 w-full"
						size="lg"
						disabled={busy || !agreed}
						onClick={() => consent.mutate()}
					>
						{consent.isPending
							? t("guardianConsent.processing")
							: t("guardianConsent.approve")}
					</Button>
					<Button
						className="mt-2 w-full"
						variant="ghost"
						size="lg"
						disabled={busy}
						onClick={() => decline.mutate()}
					>
						{t("guardianConsent.decline")}
					</Button>
				</>
			) : (
				<>
					<p className="mt-6 text-sm leading-7 text-muted-foreground">
						{t("guardianConsent.verifyFirst")}
					</p>
					<Button
						className="mt-4 w-full"
						size="lg"
						disabled={busy}
						onClick={async () => {
							/**
							 * The user is sent out to the verifier. Name and birth date are not collected here or judged
							 * by us, because values typed into our form are claims, not evidence. Judging them ourselves
							 * would make the procedure indistinguishable from a child typing any name into a form.
							 *
							 * The handoff method is not chosen here either. The server describes it as a discriminated
							 * union, and the screen stops rather than proceed when it meets a kind it does not know.
							 */
							setHandoffError(null);
							setStarting(true);
							try {
								const handoff = await client.membership
									.startGuardianVerification(token)
									.catch(() => null);
								if (!handoff) {
									setHandoffError(t("guardianConsent.startUnavailable"));
									return;
								}

								const outcome = await runIdentityHandoff(handoff);
								if (outcome.status === "completed") {
									/**
									 * A 'done' from the verifier is only a value in this browser. The server judges the result
									 * by asking the verifier with its own secret. This screen therefore changes no state
									 * itself; it only sends the request.
									 */
									verify.mutate();
									return;
								}
								if (outcome.status === "failed")
									setHandoffError(t("guardianConsent.verificationFailed"));
								if (outcome.status === "unsupported")
									setHandoffError(t("guardianConsent.verifierUnavailable"));
								/**
								 * The `navigating` and `cancelled` states show no message. navigating: the page is leaving,
								 * so anything drawn would vanish anyway. cancelled: the user closed the verifier. That is
								 * not a failure, and an error here would make the user suspect their device.
								 */
							} finally {
								setStarting(false);
							}
						}}
					>
						{starting
							? t("guardianConsent.opening")
							: t("guardianConsent.verify")}
					</Button>
				</>
			)}

			{error && (
				<p className="mt-3 text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
		</Shell>
	);
}

/**
 * The guardian is told what they are consenting to.
 *
 * Consent given without being able to know what is being consented to is not consent, so what
 * the consent covers sits on the same screen as the consent button: the service's use by the child
 * and the processing of the child's personal information. There is no separate document version
 * to agree to; this list is the statement the guardian reads.
 */
function Disclosure({ expiresAt }: { expiresAt: string }) {
	const { t } = useTranslation("onboarding");
	return (
		<>
			<p className="mt-3 text-sm leading-7 text-muted-foreground">
				{t("guardianConsent.intro")}
			</p>
			<ul className="mt-5 flex list-disc flex-col gap-2 pl-5 text-sm leading-7">
				<li>
					<Trans
						t={t}
						i18nKey="guardianConsent.collected"
						components={{ b: <b className="font-medium" /> }}
					/>
				</li>
				<li>
					<Trans
						t={t}
						i18nKey="guardianConsent.guardianInfo"
						components={{ b: <b className="font-medium" /> }}
					/>
				</li>
				<li>
					<Trans
						t={t}
						i18nKey="guardianConsent.ai"
						components={{ b: <b className="font-medium" /> }}
					/>
				</li>
				<li>
					<Trans
						t={t}
						i18nKey="guardianConsent.limits"
						components={{ b: <b className="font-medium" /> }}
					/>
				</li>
				<li>
					<Trans
						t={t}
						i18nKey="guardianConsent.withdraw"
						components={{ b: <b className="font-medium" /> }}
					/>
				</li>
			</ul>

			{/*
			 * The expiry text is built by the screen from the server's timestamp. If the server sent '3 hours
			 * left', that string would be wrong as soon as the response was cached. It would also be in one
			 * language, so no other client could reuse it.
			 */}
			<p className="mt-4 text-xs text-muted-foreground">
				{t("guardianConsent.validUntil", {
					date: new Date(expiresAt).toLocaleString(intlLocale()),
				})}
			</p>
		</>
	);
}

function Approved() {
	const { t } = useTranslation("onboarding");
	return (
		<>
			<h1 className="text-xl font-bold tracking-tight">
				{t("guardianConsent.approvedTitle")}
			</h1>
			<p className="mt-3 text-sm leading-7 text-muted-foreground">
				{t("guardianConsent.approvedBody")}
			</p>
		</>
	);
}

function Declined() {
	const { t } = useTranslation("onboarding");
	return (
		<>
			<h1 className="text-xl font-bold tracking-tight">
				{t("guardianConsent.declinedTitle")}
			</h1>
			{/*
			 * Never say the account was deleted: nothing is deleted. Refusing and destroying an account are
			 * different decisions. If the guardian changes their mind, the child can create a new link.
			 */}
			<p className="mt-3 text-sm leading-7 text-muted-foreground">
				{t("guardianConsent.declinedBody")}
			</p>
		</>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<main className="min-h-dvh bg-background p-6">
			<div className="mx-auto w-full max-w-md py-8">{children}</div>
		</main>
	);
}
