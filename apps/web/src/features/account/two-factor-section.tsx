import type { AccountDetails } from "@rowcat/domain";
import { ACCOUNT_QUERY_KEY } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import {
	normalizeAuthenticatorCode,
	type TwoFactorSetupStep,
	twoFactorManageFailure,
	twoFactorManageMessage,
} from "#/features/auth/two-factor.ts";
import { authClient } from "#/lib/auth.ts";
import { recentLoginRequired } from "./security-error.ts";
import {
	TwoFactorDisableDialog,
	TwoFactorRegenerateDialog,
	TwoFactorSetupDialog,
} from "./two-factor-dialogs.tsx";

/**
 * Two-factor authentication: one extra lock on the password door.
 *
 * Actions call the Better Auth client directly (`authClient.twoFactor.*`), the same decision as the
 * password and email changes. Wrapping them in our own routes would send the password and TOTP code
 * through our contract and SDK, and create a second implementation that imitates identity checks.
 * The server's rules at that door (recent login, no trusted devices, no re-showing of secrets) live
 * in `apps/api/src/auth/two-factor-policy.ts`.
 *
 * ## Say honestly what is protected
 *
 * The challenge appears only after **password login**. Social sign-in and passkeys are already a
 * factor other than the password, so they are not challenged. This is why the copy says "when
 * signing in with a password". Writing "every sign-in" would make someone who signed in with Google
 * think their account is broken.
 *
 * ## Accounts without a password get no enable button
 *
 * Such an account has no door to challenge. Drawing an enable button would show "on" for a feature
 * that protects nothing while claiming it does. The password field directly above says what to do
 * first.
 *
 * ## After success, one cell moves: the account
 *
 * Confirming setup and disabling make the server **issue a new session** (same person, new token).
 * So only account info and the session list beneath it (the `["viewer","account"]` prefix) are
 * refetched; `["viewer"]` as a whole is not invalidated, because the member's identity did not
 * change.
 */
export function TwoFactorSection({ account }: { account: AccountDetails }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<
		"setup" | "regenerate" | "disable" | null
	>(null);
	const [step, setStep] = useState<TwoFactorSetupStep>("password");
	/** Secret and codes from the issuing response. Discarded when the dialog closes, since they cannot be fetched again. */
	const [issued, setIssued] = useState<{
		totpURI: string;
		backupCodes: string[];
	} | null>(null);
	const [regenerated, setRegenerated] = useState<string[] | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inFlight = useRef(false);

	const open = (next: "setup" | "regenerate" | "disable") => {
		setError(null);
		setStep("password");
		setIssued(null);
		setRegenerated(null);
		setDialog(next);
	};

	const close = () => {
		setDialog(null);
		setIssued(null);
		setRegenerated(null);
		setError(null);
		/**
		 * On enable or disable, refetch account info and sessions. Closing before setup is finished
		 * leaves the server unchanged (the first code must match before it turns on), so there is nothing
		 * to refetch. The refetch is cheap, so the two cases are not distinguished.
		 */
		void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
	};

	/** Failure becomes a sentence. The recent-login requirement uses the **same sentence** as the other sections of this screen. */
	const failWith = (failure: AuthFailure) => {
		const kind = twoFactorManageFailure(failure).kind;
		setError(
			kind === "recent-login"
				? recentLoginRequired()
				: twoFactorManageMessage(kind),
		);
	};

	/** One at a time: a second submit in the same tick must not issue secrets twice. */
	const run = async (task: () => Promise<void>) => {
		if (inFlight.current) return;
		inFlight.current = true;
		setPending(true);
		setError(null);
		try {
			await task();
		} catch {
			failWith({});
		} finally {
			inFlight.current = false;
			setPending(false);
		}
	};

	const startSetup = (password: string) =>
		run(async () => {
			const outcome = await authClient.twoFactor.enable({ password });
			if (outcome.error || !outcome.data || !("totpURI" in outcome.data)) {
				failWith((outcome.error ?? {}) as AuthFailure);
				return;
			}
			const data = outcome.data as { totpURI: string; backupCodes: string[] };
			setIssued({ totpURI: data.totpURI, backupCodes: data.backupCodes });
			setStep("backup");
		});

	const verifySetup = (code: string) =>
		run(async () => {
			const outcome = await authClient.twoFactor.verifyTotp({
				code: normalizeAuthenticatorCode(code),
			});
			if (outcome.error) {
				failWith(outcome.error as AuthFailure);
				return;
			}
			setStep("done");
			void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
		});

	const regenerate = (password: string) =>
		run(async () => {
			const outcome = await authClient.twoFactor.generateBackupCodes({
				password,
			});
			if (outcome.error || !outcome.data) {
				failWith((outcome.error ?? {}) as AuthFailure);
				return;
			}
			setRegenerated(outcome.data.backupCodes);
		});

	const disable = (password: string) =>
		run(async () => {
			const outcome = await authClient.twoFactor.disable({ password });
			if (outcome.error) {
				failWith(outcome.error as AuthFailure);
				return;
			}
			close();
		});

	return (
		<div className="flex flex-col gap-3 pt-2">
			<p className="text-sm text-muted-foreground">
				{account.twoFactorEnabled
					? t("twoFactorSection.onSigningInWithA")
					: account.hasPassword
						? t("twoFactorSection.offTurnItOnTo")
						: t("twoFactorSection.availableForAccountsThatSign")}
			</p>

			{account.twoFactorEnabled ? (
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => open("regenerate")}
					>
						{t("twoFactorSection.getNewBackupCodes")}
					</Button>
					<Button variant="outline" size="sm" onClick={() => open("disable")}>
						{t("twoFactorSection.turnOffTwoFactorAuthentication")}
					</Button>
				</div>
			) : account.hasPassword ? (
				<div>
					<Button variant="outline" size="sm" onClick={() => open("setup")}>
						{t("twoFactorSection.turnOnTwoFactorAuthentication")}
					</Button>
				</div>
			) : null}

			{dialog === "setup" && (
				<TwoFactorSetupDialog
					step={step}
					totpURI={issued?.totpURI ?? null}
					backupCodes={issued?.backupCodes ?? []}
					pending={pending}
					error={error}
					onPassword={(password) => void startSetup(password)}
					onBackupSaved={() => {
						setError(null);
						setStep("scan");
					}}
					onVerify={(code) => void verifySetup(code)}
					onClose={close}
				/>
			)}
			{dialog === "regenerate" && (
				<TwoFactorRegenerateDialog
					codes={regenerated}
					pending={pending}
					error={error}
					onPassword={(password) => void regenerate(password)}
					onClose={close}
				/>
			)}
			{dialog === "disable" && (
				<TwoFactorDisableDialog
					pending={pending}
					error={error}
					onPassword={(password) => void disable(password)}
					onClose={close}
				/>
			)}
		</div>
	);
}
