import {
	guardianStateQueryOptions,
	requestGuardianConsentMutationOptions,
	VIEWER_QUERY_KEY,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DeletionTerminal } from "#/features/account/deletion-terminal.tsx";
import { useAccountDeletion } from "#/features/account/use-account-deletion.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { feedbackEnter } from "#/lib/motion/feedback.ts";
import { GateExit, GateSurface } from "./gate-shell.tsx";
import { guardianRequestError } from "./membership-gate-state.ts";

/**
 * The guardian waiting screen, seen by the child.
 *
 * The message does not open with 'you cannot sign up'. Using the app under 14 is a supported path
 * with a procedure set by PIPA Article 22-2; what is needed here is the guardian's consent. Wording
 * that reads as rejection would send the child back to change their age, and the platform would
 * lose both the chance to identify the child and the protection the law requires.
 *
 * The platform has no outgoing email or SMS (auth/index.ts). Rather than pretend otherwise, the
 * child passes the link to the guardian by a means they already have. The child is usually in the
 * same household or can already reach the guardian.
 *
 * The link is shown once. The server keeps only a hash of the token and cannot return it. If it is
 * lost, a new one is created and the old one dies.
 *
 * PIPA 22-2(3) requires notice to under-14s in an easy-to-understand format and plain language. The
 * shorter, softer sentences here follow from that article, not from style.
 */
export function GuardianPanel() {
	const { t } = useTranslation("onboarding");
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const deletion = useAccountDeletion();
	const [consentPath, setConsentPath] = useState<string | null>(null);
	/**
	 * The copy button's result holds success and failure as one value. As a boolean, failure was
	 * false, the same as 'not clicked yet'. The button label stays `Copy link` in both states, so the
	 * child could not tell whether the press worked.
	 */
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);

	const state = useQuery(guardianStateQueryOptions(client));
	const request = useMutation(
		requestGuardianConsentMutationOptions(client, queryClient),
	);
	const busy = request.isPending || deletion.phase === "deleting";

	const status = state.data?.status ?? null;

	/**
	 * When approval is confirmed, the viewer is invalidated, because the viewer's membershipGate is
	 * what opens the gate. Polling updates the consent request's status, not the viewer. Without this
	 * bridge, a guardian who approves on another device leaves the child's screen on 'waiting' until
	 * the viewer query's 60-second freshness window or a window focus refreshes it.
	 *
	 * The gate is not removed directly. Building membershipGate by hand would briefly open the account
	 * before the server does. Invalidation asks again and lets the server answer. It is idempotent, so
	 * observing the same status more than once is safe.
	 */
	useEffect(() => {
		if (status !== "approved") return;
		void queryClient.invalidateQueries({ queryKey: VIEWER_QUERY_KEY });
	}, [status, queryClient]);

	if (deletion.terminal)
		return (
			<GateSurface>
				<DeletionTerminal deletion={deletion} />
			</GateSurface>
		);

	const waiting = status === "pending" || status === "verified";
	const declined = status === "declined";
	const error = guardianRequestError(request.error);

	/**
	 * The absolute URL is built by the browser. The server returns only a path because the origin
	 * differs per deployment (previews, old domains). If the server built the absolute URL, the link
	 * would one day point at a different deployment.
	 */
	const consentUrl =
		consentPath && typeof window !== "undefined"
			? new URL(consentPath, window.location.origin).toString()
			: null;

	const copy = async (): Promise<void> => {
		if (!consentUrl) return;
		try {
			await navigator.clipboard.writeText(consentUrl);
			setCopyState("copied");
		} catch {
			/**
			 * Some browsers and contexts block copying (permissions, or an insecure context). That case is
			 * said out loud. The honest instruction is to select and copy the address by hand, and that
			 * sentence only makes sense next to the address. A toast could not point at what to select.
			 * Staying silent would leave the child believing it was copied and trying to paste.
			 */
			setCopyState("failed");
		}
	};

	return (
		<GateSurface>
			<h1 className="text-xl font-bold tracking-tight">
				{t("guardianPanel.title")}
			</h1>
			<p className="mt-3 text-sm leading-7 text-muted-foreground">
				{t("guardianPanel.body")}
			</p>

			{/*
			 * The child is also told what the guardian consents to. The procedure should not be known only to
			 * the guardian (PIPA 22-2(3)).
			 */}
			<ul className="mt-5 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-7 text-muted-foreground">
				<li>{t("guardianPanel.step1")}</li>
				<li>{t("guardianPanel.step2")}</li>
				<li>{t("guardianPanel.step3")}</li>
			</ul>

			{/*
			 * The text on this screen only enters. Sibling elements below (the link card, the button) take
			 * over its space. With an exit, the shift would finish after the exit and look larger.
			 * The same rule is described in docs/motion/ARCHITECTURE.md ('when leaving must not take the space
			 * with it'), and feedback.ts requires a 'last flow child' for that reason.
			 *
			 * The rhythm uses the values in that file. Choosing values here would make the same kind of event
			 * arrive at a different distance on every screen.
			 */}
			<AnimatePresence initial={false}>
				{declined && (
					/*
					 * Refusal is not the end either. The account stays, and a new link can be created if the
					 * guardian changes their mind. Without saying so, the child would read the account as gone.
					 */
					<m.p
						key="declined"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
						className="mt-5 rounded-lg border bg-muted/40 px-3 py-2 text-sm leading-6"
					>
						{t("guardianPanel.declined")}
					</m.p>
				)}
			</AnimatePresence>

			{/*
			 * The trigger and the result are two states of the same slot. When the link is created, the slot
			 * changes from a button into a card. An abrupt switch would hide the connection between what the
			 * child pressed and what appeared.
			 *
			 * Not mode='wait': that would make the address arrive only after the button's exit, and the address
			 * is the most urgent value on this screen. The outgoing button disappears at once (no exit), and
			 * only the incoming card enters, with opacity and a 4px offset.
			 */}
			<AnimatePresence initial={false}>
				{consentUrl ? (
					<m.div
						key="link"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
						className="mt-5 flex flex-col gap-2 rounded-lg border bg-card p-4"
					>
						<p className="text-sm font-medium">
							{t("guardianPanel.linkLabel")}
						</p>
						{/*
						 * The address is shown as is, not inside a short code. The guardian receives this address, and the
						 * child must be able to check it. Without break-all, a long line overflows on narrow screens.
						 */}
						<p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5">
							{consentUrl}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button size="sm" onClick={() => void copy()}>
								{/*
								 * Only the text switches instantly; only the icon animates. The labels `Copy link` and `Copied`
								 * have different widths. A crossfade on the text would widen and narrow the button mid-animation,
								 * so the target the user just pressed would move under their finger. The status is therefore a
								 * fixed-width glyph. The rhythm matches the copy action in conversation
								 * (conversation/copy-message-action.tsx).
								 *
								 * The failed state shares the idle cell. Failure is announced by the role='alert' sentence below,
								 * not by the icon.
								 */}
								<AnimatedIconSwap
									stateKey={copyState === "copied" ? "copied" : "idle"}
								>
									{copyState === "copied" ? (
										<Check aria-hidden="true" />
									) : (
										<Copy aria-hidden="true" />
									)}
								</AnimatedIconSwap>
								{copyState === "copied"
									? t("guardianPanel.copied")
									: t("guardianPanel.copy")}
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => {
									setCopyState("idle");
									setConsentPath(null);
									request.mutate(undefined, {
										onSuccess: (created) => setConsentPath(created.consentPath),
									});
								}}
							>
								{t("guardianPanel.newLink")}
							</Button>
						</div>
						<AnimatePresence initial={false}>
							{copyState === "failed" && (
								<m.p
									key="copy-failed"
									role="alert"
									initial={feedbackEnter.initial}
									animate={feedbackEnter.animate}
									transition={feedbackEnter.transition}
									className="text-xs leading-6 text-destructive"
								>
									{t("guardianPanel.copyFailed")}
								</m.p>
							)}
						</AnimatePresence>
						<p className="text-xs leading-6 text-muted-foreground">
							{t("guardianPanel.newLinkNote")}
						</p>
					</m.div>
				) : (
					/*
					 * Do not wrap this in display: contents. That value removes the box, so opacity and transforms
					 * do not apply, and the symptom is an animation that silently never plays.
					 */
					<m.div
						key="cta"
						className="mt-5"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
					>
						<Button
							className="w-full"
							size="lg"
							disabled={busy}
							onClick={() =>
								request.mutate(undefined, {
									onSuccess: (created) => setConsentPath(created.consentPath),
								})
							}
						>
							{request.isPending
								? t("guardianPanel.creating")
								: waiting
									? t("guardianPanel.recreate")
									: t("guardianPanel.create")}
						</Button>
					</m.div>
				)}
			</AnimatePresence>

			<AnimatePresence initial={false}>
				{error && (
					<m.p
						key={error}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
						className="mt-3 text-sm text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>

			{/*
			 * While waiting, the screen states what it is waiting for. Polling is configured through the query
			 * options (@rowcat/query). When the guardian consents, the gate disappears and this screen goes
			 * with it, which is why it does not need to say 'please refresh'.
			 */}
			<AnimatePresence initial={false}>
				{waiting && !consentUrl && (
					<m.p
						key="waiting"
						aria-live="polite"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
						className="mt-3 text-sm text-muted-foreground"
					>
						{t("guardianPanel.waiting")}
					</m.p>
				)}
			</AnimatePresence>

			<GateExit
				note={t("guardianPanel.exitNote")}
				deletion={deletion}
				busy={busy}
			/>
		</GateSurface>
	);
}
