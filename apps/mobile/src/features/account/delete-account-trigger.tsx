import { space } from "@rowcat/design";
import { ACCOUNT_QUERY_KEY, accountQueryOptions } from "@rowcat/query";
import { Button, Notice, Spinner, Text } from "@rowcat/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import {
	DELETE_ACCOUNT_LOAD_FAILED,
	DELETE_ACCOUNT_LOADING,
	DELETE_ACCOUNT_OFFLINE,
	DELETE_TRIGGER_LABEL,
} from "./account-copy.ts";
import { DeleteAccountDialog } from "./delete-account-dialog.tsx";
import type { AccountDeletion } from "./use-account-deletion.ts";

/**
 * The deletion trigger: one button, the password-required lookup, and the confirmation dialog
 * (native counterpart of web `delete-account-trigger.tsx`).
 *
 * It is separate because there are two places that open it:
 *
 * ```text
 * delete section on /account   the usual place
 * entry gate                   for someone held by age or guardian consent, who cannot reach /account
 * ```
 *
 * If each wrote its own button, query and dialog, the confirmation, password decision and failure
 * handling would diverge in an irreversible operation (one drawing a password field for social
 * accounts, one proceeding past a failed `/me/account`).
 *
 * Progress state is not made here. `AccountDeletion` comes in as an argument because it splits the
 * whole screen: after the account is gone the screen becomes a terminal panel
 * (`deletion-terminal.tsx`), and that decision belongs to the screen holding it, which both the
 * account screen and the gate read.
 *
 * Without account info, deletion does not start. The server knows whether a password is required
 * (`/me/account`); guessing would draw a credential account a dialog without the password field,
 * then block them on the recent-login rule for no visible reason. A held value is not replaced by
 * guidance, since one failed background refresh should not remove the delete button.
 */
export function DeleteAccountTrigger({
	deletion,
}: {
	deletion: AccountDeletion;
}) {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const account = useQuery(accountQueryOptions(getRowCatClient()));

	/**
	 * `Try again`: on a paused query `refetch()` creates no request. With no held value the query is
	 * restarted from scratch (dropping the paused retryer); otherwise a plain refetch (same rule as
	 * the notifications screen).
	 */
	const retry = useCallback(() => {
		if (account.data === undefined) {
			/**
			 * `exact` is required: this key (`["viewer","account"]`) prefixes the session and passkey
			 * queries, and without it reloading the delete button would discard the security section's two
			 * lists, which requested nothing.
			 */
			void queryClient.resetQueries({
				queryKey: ACCOUNT_QUERY_KEY,
				exact: true,
			});
			return;
		}
		void account.refetch();
	}, [account.data, account.refetch, queryClient]);

	const busy = deletion.phase === "deleting";

	if (account.data === undefined && (account.isError || account.isPaused))
		return (
			/** Paused and failed read differently: the first is waiting, the second is a failure. */
			<Notice
				tone={account.isPaused ? "muted" : "destructive"}
				message={
					account.isPaused ? DELETE_ACCOUNT_OFFLINE : DELETE_ACCOUNT_LOAD_FAILED
				}
				actionLabel="Try again"
				busy={account.isFetching}
				onAction={retry}
			/>
		);

	if (account.data === undefined)
		return (
			<View style={trigger.loadingRow}>
				<Spinner />
				<Text variant="label" tone="muted-foreground">
					{DELETE_ACCOUNT_LOADING}
				</Text>
			</View>
		);

	return (
		<>
			<View style={trigger.row}>
				<Button
					label={DELETE_TRIGGER_LABEL}
					variant="destructive"
					disabled={busy}
					onPress={() => setConfirming(true)}
				/>
			</View>
			{confirming ? (
				<DeleteAccountDialog
					hasPassword={account.data.hasPassword}
					pending={busy}
					error={deletion.error}
					onClose={() => setConfirming(false)}
					onConfirm={deletion.requestDelete}
				/>
			) : null}
		</>
	);
}

const trigger = StyleSheet.create({
	row: { flexDirection: "row" },
	loadingRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
});
