import type { ByoProvider } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import {
	PROVIDER_KEY_PAGE,
	providerLabel,
} from "#/lib/generation/availability.ts";
import { probeProviderCredential } from "#/lib/generation/router.ts";
import { useProviderScope } from "#/lib/local-provider/scope.ts";
import { useViewerCapability } from "#/lib/query/viewer-capability.ts";
import { connectProvider } from "./connect-provider.ts";
import {
	type ConnectFailure,
	connectFailureScope,
	failureAfterEdit,
} from "./provider-feedback.ts";

/**
 * Header for the provider connection dialog, the only screen where the key briefly exists.
 * - Saved keys are never read back. Replacing a key starts from an empty input. No masking
 *   either: reversible masking is not masking, and irreversible masking shows nothing while still
 *   leaving code that renders the key.
 * - Saves only after verification succeeds. A rejected (401) key left as connected would surface
 *   only in the next conversation, with no explanation.
 * - The input is cleared right after a successful save. On failure it is kept, so a brief network
 *   drop does not force the user to paste the key again.
 * - The decryption function is not imported. This file sees only the store port, which provides
 *   summary, connect and disconnect (useProviderScope).
 * - No advanced options (endpoint, org id, project id, model parameters). Both provider addresses
 *   are fixed. Accepting arbitrary endpoints would widen the CSP, mixed-content and network trust
 *   boundaries at once.
 * - The verify-then-save order and single execution are not here (connect-provider.ts). They are
 *   pure functions so they can be checked without rendering. This file handles only input lifetime
 *   and copy.
 * - The dialog does not close while busy. It once closed from onOpenChange, so Esc, outside
 *   presses and focus loss erased the window during verification and save. The user believed they
 *   had cancelled, but the request kept running and the new key was saved silently later. The
 *   shared policy in lib/dialog/dismiss.ts applies: - Not pending: Esc, cancel and close dismiss.
 *   Outside presses and focus loss are ignored. - Pending: never closes, because the result needs a
 *   place to appear. - Success: this component closes. - Failure: stays open, with the next step
 *   inside the dialog.
 * - No fake cancel. The verification request takes an AbortSignal, but nothing aborts it. While
 *   pending there is no way to close, so there is no user cancel to forward, and the save
 *   (store.connect) cannot be aborted anyway. Keeping the window open until the work ends is more
 *   honest than closing it while a write continues in the background.
 */

export function ProviderConnectionDialog({
	provider,
	/**
	 * Whether the provider is already connected. Only the title and button label change; the operation
	 * itself is the same.
	 */
	replacing,
	onClose,
}: {
	provider: ByoProvider;
	replacing: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation(["settings", "common"]);
	const { store } = useProviderScope();
	const inputId = useId();
	const errorId = `${inputId}-error`;
	const [secret, setSecret] = useState("");
	const [reveal, setReveal] = useState(false);
	const [pending, setPending] = useState(false);
	/**
	 * A failure, together with what it is a failure of. Keeping only the message would place every
	 * failure in the same spot. If that spot is the API key field, a user without a network connection
	 * would be told the key is wrong, and aria-invalid would pass that claim to assistive technology.
	 * The kind already comes from connectProvider (rejected versus not_permitted or failed). This code
	 * only reads that judgment.
	 */
	const [failure, setFailure] = useState<ConnectFailure | null>(null);

	/**
	 * A synchronous copy of the in-progress state. `pending` alone is not enough: setState applies on
	 * the next render, so two submissions in the same tick (a double press, or Enter and click
	 * together) both pass. Two verification requests and two writes would then race, and whichever
	 * finishes last wins, which may not be the key the user just entered. The generation hook uses the
	 * same pattern (generatingRef).
	 *
	 * Turning this into a form does not make the guard unnecessary. A form removes the second submit
	 * path, not the chance that the same path runs twice in one tick.
	 */
	const pendingRef = useRef(false);
	const capability = useViewerCapability();
	const label = providerLabel(provider);
	const fieldInvalid = failure?.scope === "field";

	const submit = async (): Promise<void> => {
		/**
		 * The same gate exists inside the flow (connectProvider), but it is checked here too. The flow
		 * returns busy and this function's finally runs. In that window the first submission's button can
		 * be pressed again. A second call of the same action must leave screen state untouched.
		 */
		if (pendingRef.current) return;
		const trimmed = secret.trim();
		if (!store || !trimmed) return;

		setPending(true);
		setFailure(null);

		const controller = new AbortController();
		try {
			/**
			 * Neither verification nor saving happens in this function. connectProvider owns the order
			 * (cheap verification first, then save only keys that pass) and the same-tick duplicate guard.
			 * Putting those rules here would make them impossible to check without mounting the dialog.
			 */
			const outcome = await connectProvider({
				provider,
				secret: trimmed,
				guard: pendingRef,
				/**
				 * Account eligibility is decided before verification, inside connectProvider. The button that
				 * opens this dialog is already disabled, but a disabled button is not enforcement. The rule
				 * lives in the pure function; the screen only passes the value.
				 */
				byoAllowed: capability.byo,
				/**
				 * Verification does not use a short generation request, because every key save costs the user
				 * money (lib/generation/anthropic.ts). Nothing aborts this signal (see the file header). While
				 * pending the dialog cannot close, so there is no user action that would request an abort.
				 */
				probe: (target, value) =>
					probeProviderCredential(target, value, {
						signal: controller.signal,
					}),
				save: (target, value) => store.connect(target, value),
			});

			if (outcome.status === "busy") return;
			if (outcome.status !== "connected") {
				/**
				 * Do not clear the input on failure. A rejected key must be corrected. After a transient
				 * failure the user just presses submit again. Either way the value the user typed must remain.
				 */
				setFailure({
					scope: connectFailureScope(outcome.status),
					message: outcome.message,
				});
				return;
			}

			/**
			 * Clear the input on success, before calling onClose. The dialog unmounts on close anyway, but
			 * clearing first shortens the time this component holds the plaintext key.
			 */
			setSecret("");
			onClose();
		} finally {
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				placement="adaptive"
				className="top-auto bottom-0 max-h-[85dvh] w-full max-w-full flex flex-col gap-0 rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-w-md sm:rounded-xl"
			>
				<DialogHeader className="border-b px-5 py-4 text-left">
					<DialogTitle>
						{replacing
							? t("providerDialog.replaceTitle", { label })
							: t("providerDialog.connectTitle", { label })}
					</DialogTitle>
					<DialogDescription>
						{t("providerDialog.description", { label })}
					</DialogDescription>
				</DialogHeader>

				{/*
				 * Use a real `<form>`. Submission was once split between an Enter handler on the input and a
				 * click handler on the footer button. Two paths for one action mean a fix to one path is easily
				 * missed, and the browser loses the standard form signal. The password and email change
				 * dialogs in this repo use the same shape.
				 *
				 * `noValidate` replaces the browser's validation bubbles with the component's own copy. The
				 * form must wrap the footer too: a type="submit" button outside the form does nothing.
				 */}
				<form
					noValidate
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4">
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label htmlFor={inputId} className="text-sm font-medium">
									{t("providerConnectionDialog.apiKey")}
								</Label>
								{/*
								 * The show/hide toggle is an acceptable convenience. It is the only way to check whether a long
								 * pasted key arrived in full. Do not add automatic copy-to-clipboard.
								 */}
								<button
									type="button"
									/*
									 * The label states what is shown or hidden. This screen has several buttons, so a bare
									 * show or hide cannot say which control it toggles. The visible text stays at the start of
									 * the accessible name, so voice control keeps working. It is a true toggle with a pressed
									 * state, so aria-pressed is correct (the password eye on the login screen uses the same
									 * pattern).
									 */
									aria-pressed={reveal}
									aria-label={
										reveal
											? t("providerConnectionDialog.hideApiKey")
											: t("providerConnectionDialog.showApiKey")
									}
									className="text-sm text-muted-foreground underline underline-offset-2"
									onClick={() => setReveal((current) => !current)}
								>
									{reveal
										? t("providerConnectionDialog.hide")
										: t("providerConnectionDialog.show")}
								</button>
							</div>
							<Input
								id={inputId}
								/*
								 * Keep browsers and password managers from treating this value as a save candidate. Also
								 * turn off auto-capitalization and spell check. Some spell-check implementations send input
								 * to an external checking service.
								 */
								type={reveal ? "text" : "password"}
								autoComplete="off"
								spellCheck={false}
								autoCapitalize="none"
								autoCorrect="off"
								value={secret}
								disabled={pending || !store}
								/*
								 * Mark the field invalid only when the failure is a judgment about this field's value. A
								 * provider rejecting the key is a fact about the value entered here. A network outage, a
								 * save failure, or an account that cannot use personal keys is not. Setting aria-invalid
								 * for those would send a user with a valid key off to re-issue it.
								 */
								aria-invalid={fieldInvalid}
								aria-describedby={fieldInvalid ? errorId : undefined}
								onChange={(event) => {
									setSecret(event.target.value);
									/*
									 * When the value changes, only the judgment about this field is removed. The rejection
									 * applied to the characters the user has just changed, so keeping it would mark a value
									 * that was never submitted as invalid. A user who fixed one typo would then go discard a
									 * valid key.
									 *
									 * Failures unrelated to the field (network, account, save) stay in place, and the next
									 * submit clears them. Typing one character does not remove guidance the user has not read
									 * yet (provider-feedback.ts).
									 */
									setFailure(failureAfterEdit);
								}}
							/>
							{/*
							 * Field failures appear next to the field. Below the notice block near the footer, the message
							 * would be far from what needs fixing.
							 */}
							{fieldInvalid && failure && (
								<p
									id={errorId}
									role="alert"
									className="text-sm text-destructive"
								>
									{failure.message}
								</p>
							)}
							<a
								href={PROVIDER_KEY_PAGE[provider]}
								target="_blank"
								rel="noreferrer noopener"
								className="text-sm text-muted-foreground underline underline-offset-2"
							>
								{t("providerConnectionDialog.createAnApiKey")}
							</a>
						</div>

						{/*
						 * The notice does not claim absolute security. It states only things that are actually true.
						 * The limits of the threat model are documented honestly in lib/local-provider/crypto.ts.
						 */}
						<div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
							<p>{t("providerConnectionDialog.theApiKeyIsStored")}</p>
							<p>{t("providerConnectionDialog.whenYouUseThisProvider")}</p>
							<p>{t("providerConnectionDialog.apiUsageFeesForThat")}</p>
							<p>{t("providerConnectionDialog.usingAPersonalApiKey")}</p>
						</div>

						{/*
						 * Failures not tied to the field's value: network, provider outage, usage limits, save failure,
						 * and account eligibility. The placement is the point. Next to the input, the failure reads as
						 * a problem with the value, and even without aria-invalid a sighted user would take it that way.
						 */}
						{failure && !fieldInvalid && (
							<p role="alert" className="text-sm text-destructive">
								{failure.message}
							</p>
						)}
					</div>

					<div className="flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={pending}
						>
							{t("common:actions.cancel")}
						</Button>
						<Button
							type="submit"
							disabled={pending || !secret.trim() || !store}
						>
							{pending
								? t("providerConnectionDialog.checking")
								: replacing
									? t("providerConnectionDialog.replace")
									: t("providerConnectionDialog.connect")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
