import { Button } from "@rowcat/ui-web/components/button";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { AccountDeletion } from "./use-account-deletion.ts";

/**
 * The screen after the account is gone — **it does not return to the account screen.**
 *
 * That is why this component exists. From the moment server deletion is confirmed, no section of
 * the account screen can be drawn: it would try to fetch the email again, that lookup returns 401,
 * and the screen shows "could not load account info". To someone who just deleted their account,
 * that reads as a failure.
 *
 * Only two states are drawn.
 *
 * ```text
 * purging         the account is gone and this device is being cleaned up.
 * cleanup-failed  the account is gone, and only this device's cleanup failed.
 * ```
 *
 * `done` is not here: that state leads straight to the sign-in screen, so there is nothing to draw.
 */
export function DeletionTerminal({ deletion }: { deletion: AccountDeletion }) {
	const { t } = useTranslation(["account", "common"]);
	if (deletion.phase === "cleanup-failed")
		return <CleanupFailed deletion={deletion} />;
	return (
		<div className="mt-6 flex flex-col gap-2">
			<h2 className="text-base font-semibold">
				{t("deletionTerminal.deletingAccount")}
			</h2>
			<p className="text-sm text-muted-foreground">
				{t("deletionTerminal.cleaningUpDataSavedOn")}
			</p>
		</div>
	);
}

/**
 * **States the two facts separately.**
 *
 * Writing "deletion failed" is false: the account really is gone and cannot be restored. What
 * failed is only this device's cleanup, which the user can retry. Folding the two into one sentence
 * would make the user try to sign in, and that attempt would fail forever.
 *
 * It also shows that retrying needs no authentication. The target (member id) is a value held in
 * memory from before deletion, so retry works even without a session.
 */
function CleanupFailed({ deletion }: { deletion: AccountDeletion }) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4">
			<div className="flex flex-col gap-1.5">
				<h2 className="text-base font-semibold">
					{t("deletionTerminal.yourAccountWasDeleted")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t("deletionTerminal.butTheConversationsAndDrafts")}
				</p>
				{/*
				 * Does not state as confirmed what is not confirmed. "Everything has been erased from this device"
				 * is not true right now, and that falsehood becomes a real harm when the user hands the device on.
				 */}
				<p className="text-sm text-muted-foreground">
					{t("deletionTerminal.youCanAlsoDeleteThe")}
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button onClick={deletion.retryCleanup}>
					{t("deletionTerminal.cleanUpAgain")}
				</Button>
				<Button variant="outline" render={<Link to="/login" replace />}>
					{t("deletionTerminal.goToSignIn")}
				</Button>
			</div>
		</div>
	);
}
