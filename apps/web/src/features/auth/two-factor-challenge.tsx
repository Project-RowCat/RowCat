import {
	AUTHENTICATOR_CODE_LENGTH,
	normalizeTwoFactorCode,
	type TwoFactorCodeMethod,
	twoFactorCodeReady,
} from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "#/lib/auth.ts";
import type { AuthFailure } from "./auth-error.ts";
import { twoFactorChallengeFailure } from "./two-factor.ts";

/**
 * Login challenge: the password was correct, and a second factor is still required.
 *
 * There is no session at this point. The server removed the session that the password sign-in
 * created and left only a 10-minute challenge cookie (`better-auth/plugins/two-factor`). So `/me`
 * answers guest on this screen, which is correct.
 *
 * ## Two methods, one input
 *
 * The six-digit authenticator code is the default. Someone who lost the device uses a backup code.
 * Both share the same input and only the method switches. Two separate inputs would make people
 * often type a backup code into the authenticator field, and that failure shows up only as "code
 * does not match", with no way to see the cause.
 *
 * ## No "remember this device"
 *
 * There is no "don't ask again on this device" option. No screen exists yet to view or revoke that
 * state, and an exemption that cannot be seen or removed would persist on a lost laptop. The server
 * refuses that request too (`apps/api/src/auth/two-factor-policy.ts`).
 */
export function TwoFactorChallenge({
	onAuthenticated,
	onRestart,
}: {
	/** A session now exists. What happens next (re-querying the viewer, navigating) is the screen's call. Same callback as the login form. */
	onAuthenticated: () => Promise<void>;
	/** The challenge expired, or the person chose to start over. Returns to the login form. */
	onRestart: (notice?: string) => void;
}) {
	const { t } = useTranslation("auth");
	const id = useId();
	const errorId = `${id}-error`;
	const [method, setMethod] = useState<TwoFactorCodeMethod>("authenticator");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** Blocks a second submit in the same tick. A backup code is consumed on first use. */
	const inFlight = useRef(false);

	/** Shape rules are the same function as mobile (`two-factor.ts` in `@rowcat/domain`). */
	const normalized = normalizeTwoFactorCode(method, code);
	const ready = twoFactorCodeReady(method, code);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!ready || inFlight.current) return;
		inFlight.current = true;
		setPending(true);
		setError(null);
		try {
			const outcome =
				method === "authenticator"
					? await authClient.twoFactor.verifyTotp({ code: normalized })
					: await authClient.twoFactor.verifyBackupCode({ code: normalized });
			if (outcome.error) {
				const view = twoFactorChallengeFailure(
					outcome.error as AuthFailure,
					method,
				);
				if (view.restart) {
					onRestart(view.message);
					return;
				}
				setError(view.message);
				return;
			}
			await onAuthenticated();
		} catch {
			setError(twoFactorChallengeFailure({}, method).message);
		} finally {
			inFlight.current = false;
			setPending(false);
		}
	};

	const switchMethod = () => {
		setMethod((current) =>
			current === "authenticator" ? "backup" : "authenticator",
		);
		setCode("");
		setError(null);
	};

	return (
		<form
			method="post"
			noValidate
			onSubmit={(event) => void submit(event)}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-col gap-1">
				<h2 className="text-base font-semibold">{t("twoFactor.title")}</h2>
				<p className="text-sm text-muted-foreground">
					{method === "authenticator"
						? t("twoFactor.authenticatorPrompt")
						: t("twoFactor.backupPrompt")}
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-code`}>
					{method === "authenticator"
						? t("twoFactor.authenticatorLabel")
						: t("twoFactor.backupLabel")}
				</Label>
				<Input
					/** Re-created when the method changes, so autofill and input mode do not carry over. */
					key={method}
					id={`${id}-code`}
					name={method === "authenticator" ? "otp" : "backup-code"}
					value={code}
					autoFocus
					spellCheck={false}
					autoCapitalize="off"
					autoComplete={method === "authenticator" ? "one-time-code" : "off"}
					inputMode={method === "authenticator" ? "numeric" : "text"}
					maxLength={
						method === "authenticator" ? AUTHENTICATOR_CODE_LENGTH + 2 : 32
					}
					disabled={pending}
					aria-invalid={error !== null}
					aria-describedby={error !== null ? errorId : undefined}
					onChange={(event) => setCode(event.target.value)}
				/>
			</div>

			{error !== null && (
				<p id={errorId} role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}

			<Button type="submit" disabled={!ready || pending}>
				{pending && <Spinner />}
				{pending ? t("twoFactor.checking") : t("twoFactor.confirm")}
			</Button>

			<div className="flex flex-col items-center gap-1 text-sm">
				<button
					type="button"
					className="rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					disabled={pending}
					onClick={switchMethod}
				>
					{method === "authenticator"
						? t("twoFactor.useBackup")
						: t("twoFactor.useAuthenticator")}
				</button>
				<button
					type="button"
					className="rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					disabled={pending}
					onClick={() => onRestart()}
				>
					{t("twoFactor.restart")}
				</button>
			</div>
		</form>
	);
}
