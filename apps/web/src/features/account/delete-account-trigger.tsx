import { ACCOUNT_QUERY_KEY, accountQueryOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { DeleteAccountDialog } from "./delete-account-dialog.tsx";
import type { AccountDeletion } from "./use-account-deletion.ts";

/**
 * The trigger that opens deletion — **one button, plus a lookup of whether a password is needed,
 * plus the confirmation dialog.**
 *
 * This component is separate because there are two places that open it:
 *
 * ```text
 * /account danger zone   the usual place
 * entry gate             the place for someone held at age or guardian consent; cannot reach /account
 * ```
 *
 * If each place wrote its own button, lookup and dialog, the confirmation copy, password decision
 * and failure handling would diverge, and the mismatch would show up in **an irreversible action**:
 * one side drawing a password field on a social account, or one side proceeding past a
 * `/me/account` failure. The rule is the same as conversation management sharing one set of actions
 * (`useRoomManagement`).
 *
 * **Progress state is not created here.** `AccountDeletion` is taken as an argument because its
 * value divides the whole screen: once the account is gone, the screen as a whole must become the
 * termination panel rather than this button (`deletion-terminal.tsx`), and that judgment belongs to
 * the screen holding it, not this button.
 */
export function DeleteAccountTrigger({
	deletion,
	variant = "destructive",
	size,
	className,
}: {
	deletion: AccountDeletion;
	variant?: ComponentProps<typeof Button>["variant"];
	size?: ComponentProps<typeof Button>["size"];
	className?: string;
}) {
	const { t } = useTranslation(["account", "common"]);
	const [confirming, setConfirming] = useState(false);

	/**
	 * The server knows whether the account must confirm with a password (`/me/account`).
	 *
	 * Blocking deletion on failure is intended: proceeding without knowing would draw a dialog with no
	 * password field for a credential account, and that user would be stuck on the recent-login
	 * requirement with no reason given. For an irreversible action, stopping when unknown is the
	 * correct side.
	 */
	const account = useQuery(accountQueryOptions(getRowCatClient()));

	/**
	 * `Retry`: `refetch()` does nothing on a stalled query. The rule belongs to
	 * `lib/query/panel-retry.ts` alone (this button once called raw `refetch()` and was dead only for
	 * offline users).
	 */
	const retry = usePanelRetry(ACCOUNT_QUERY_KEY, account);

	const busy = deletion.phase === "deleting";

	/**
	 * If a value is held, do not turn it into a notice. If a background refresh failure removed the
	 * deletion button, the user would read something they did not do (deletion blocked). The
	 * `hasPassword` value already held is sufficient.
	 */
	if (account.data === undefined && (account.isError || account.isPaused))
		return (
			/*
			 * `w-full` is this spot's requirement. The action row of the gate flows horizontally
			 * (`flex-wrap`), so unless this notice claims the width it would wrap into two lines beside the
			 * sign-out button. In the account screen's vertical stack the value is already true, so nothing
			 * changes there.
			 *
			 * Paused and failed read differently: the former is waiting (no alert role), the latter is a
			 * failure and should read as an alert.
			 */
			<div className="flex w-full flex-col items-start gap-2">
				{account.isPaused ? (
					<p className="text-sm text-muted-foreground">
						{t("deleteAccountTrigger.youReNotConnectedSo")}
					</p>
				) : (
					<p role="alert" className="text-sm text-muted-foreground">
						{t("deleteAccountTrigger.accountDetailsCouldnTBe")}
					</p>
				)}
				<Button
					variant="outline"
					size="sm"
					onClick={retry}
					disabled={account.isFetching}
				>
					{account.isFetching
						? t("deleteAccountTrigger.loading")
						: t("deleteAccountTrigger.tryAgain")}
				</Button>
			</div>
		);

	return (
		<>
			<Button
				variant={variant}
				size={size}
				className={className}
				disabled={account.isPending || busy}
				onClick={() => setConfirming(true)}
			>
				{t("deleteAccountTrigger.deleteAccount")}
			</Button>

			{confirming && account.data && (
				<DeleteAccountDialog
					hasPassword={account.data.hasPassword}
					pending={busy}
					error={deletion.error}
					onClose={() => setConfirming(false)}
					onConfirm={deletion.requestDelete}
				/>
			)}
		</>
	);
}
