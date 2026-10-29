import { space } from "@rowcat/design";
import type { AccountPasskey } from "@rowcat/domain";
import {
	ACCOUNT_PASSKEYS_QUERY_KEY,
	accountPasskeysQueryOptions,
	deletePasskeyMutationOptions,
	renamePasskeyMutationOptions,
} from "@rowcat/query";
import { Button, Notice, Separator, Spinner, Text } from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import { ACCOUNT_RETRY_LABEL } from "./account-copy.ts";
import {
	RemovePasskeyDialog,
	RenamePasskeyDialog,
} from "./passkey-dialogs.tsx";
import { passkeyDisplayName } from "./passkey-label.ts";
import {
	PASSKEY_DELETE_LABEL,
	PASSKEY_EMPTY_NOTE,
	PASSKEY_LIST_FAILED,
	PASSKEY_LIST_OFFLINE,
	PASSKEY_LIST_STALE,
	PASSKEY_REGISTER_UNAVAILABLE_NOTE,
	PASSKEY_RENAME_LABEL,
	passkeyRegisteredAt,
	REAUTH_ACTION_LABEL,
} from "./security-copy.ts";
import {
	RECENT_LOGIN_REQUIRED,
	securityErrorMessage,
} from "./security-error.ts";
import { securityListView } from "./security-state.ts";
import { useReauth } from "./use-reauth.ts";

/**
 * Passkeys: the list of credentials registered on this account.
 *
 * Kept apart from the login-methods section, which toggles one provider record (one per provider
 * per member). This is a list (laptop, phone, security key); merged, a "Google" row would sit
 * beside "3 passkeys" and its delete button could not say what it deletes.
 *
 * ## No registration path on this app (an intended parity gap)
 *
 * The web runs the WebAuthn ceremony through `@better-auth/passkey/client`. `@better-auth/expo`
 * 1.7.0 has no native credential adapter and the repo lacks that library. The alternatives are all
 * worse:
 *
 * ```text
 * hand-built WebAuthn challenges       we would write the protocol; a mistake is account takeover
 * a WebView login page                 origin and session there are not this app's
 * an unverified native library         never shown to match the server plugin
 * ```
 *
 * So no add button is drawn: a disabled one is a promise we cannot keep. One sentence says why it
 * is absent and what can be done here.
 *
 * List, rename and delete stay: they need no authenticator, and passkeys registered on other
 * devices must be removable from this app.
 *
 * ## A failed lookup is never drawn as an empty list
 *
 * "No passkeys registered" after a failure misleads the user about their account's safety. The
 * order belongs to a pure function (`securityListView`): held value, paused, sign in again,
 * failure, loading.
 *
 * ## No optimistic updates
 *
 * Rename and delete seat the server-confirmed list (`@rowcat/query` policy). The transient lie
 * would be "you can no longer sign in from this device", and someone would leave on it. Account
 * info and the session list are untouched: a passkey is not a `LoginMethodProvider` value, and
 * deleting a credential does not end open sessions.
 */
export function PasskeysSection() {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const query = useQuery(accountPasskeysQueryOptions(client));
	const { reauth, pending: reauthPending } = useReauth();

	const [renaming, setRenaming] = useState<AccountPasskey | null>(null);
	const [removing, setRemoving] = useState<AccountPasskey | null>(null);
	const [rowError, setRowError] = useState<string | null>(null);

	const rename = useMutation(renamePasskeyMutationOptions(client, queryClient));
	const remove = useMutation(deletePasskeyMutationOptions(client, queryClient));

	const view = securityListView({
		isPaused: query.isPaused,
		isError: query.isError,
		error: query.error,
		hasData: query.data !== undefined,
	});

	/**
	 * `Try again`: `refetch()` on a paused query creates no request (it returns the existing promise).
	 * With no held value the query restarts from scratch; with one it is an ordinary refetch. Same
	 * rule as the notifications screen.
	 */
	const retry = useCallback(() => {
		if (query.data === undefined) {
			void queryClient.resetQueries({
				queryKey: ACCOUNT_PASSKEYS_QUERY_KEY,
				exact: true,
			});
			return;
		}
		void query.refetch();
	}, [query.data, query.refetch, queryClient]);

	const busy = rename.isPending || remove.isPending;

	if (view.state === "loading") return <Spinner />;

	if (view.state === "offline")
		return (
			<Notice
				message={PASSKEY_LIST_OFFLINE}
				actionLabel={ACCOUNT_RETRY_LABEL}
				onAction={retry}
				busy={query.isFetching}
			/>
		);

	/**
	 * Needing a fresh login is guidance, not a failure. No `Try again`: asking again with the same session
	 * gets the same answer, and a button that does nothing looks broken.
	 */
	if (view.state === "recent_login")
		return (
			<Notice
				message={RECENT_LOGIN_REQUIRED}
				actionLabel={REAUTH_ACTION_LABEL}
				onAction={reauth}
				busy={reauthPending}
			/>
		);

	if (view.state === "error")
		return (
			<Notice
				tone="destructive"
				message={PASSKEY_LIST_FAILED}
				actionLabel={ACCOUNT_RETRY_LABEL}
				onAction={retry}
				busy={query.isFetching}
			/>
		);

	const passkeys = query.data ?? [];

	return (
		<View style={passkey.stack}>
			{/** Keep the held value; one sentence says it is stale, so it is not passed off as current. */}
			{view.retryable ? (
				<Notice
					message={PASSKEY_LIST_STALE}
					actionLabel={ACCOUNT_RETRY_LABEL}
					onAction={retry}
					busy={query.isFetching}
				/>
			) : null}

			{passkeys.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{PASSKEY_EMPTY_NOTE}
				</Text>
			) : (
				<View>
					{/**
					 * Rows with an identity disappear on delete, and one arrives when a lookup brings in a passkey
					 * registered elsewhere (same rhythm as the web section, `passkeys-section.tsx`).
					 *
					 * The divider sits inside the same box as the row; outside, a disappearing row leaves its own line
					 * floating at the top or bottom of the list.
					 */}
					{passkeys.map((item, index) => (
						<MotionRow key={item.id} exit={passkeys.length > 1}>
							{index === 0 ? null : <Separator />}
							<PasskeyRow
								passkey={item}
								busy={busy}
								onRename={() => {
									setRowError(null);
									setRenaming(item);
								}}
								onRemove={() => {
									setRowError(null);
									setRemoving(item);
								}}
							/>
						</MotionRow>
					))}
				</View>
			)}

			{/** Why there is no registration and what can be done here: one sentence instead of a dead button. */}
			<Text variant="caption" tone="muted-foreground">
				{PASSKEY_REGISTER_UNAVAILABLE_NOTE}
			</Text>

			{/** Only failures that must outlive the closed dialog stand here. */}
			{rowError && !renaming && !removing ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{rowError}
					</Text>
				</FeedbackLine>
			) : null}

			{renaming ? (
				<RenamePasskeyDialog
					passkey={renaming}
					open
					pending={rename.isPending}
					error={rowError}
					onClose={() => {
						setRenaming(null);
						setRowError(null);
					}}
					onSubmit={(name) =>
						rename.mutate(
							{ id: renaming.id, name },
							{
								onSuccess: () => setRenaming(null),
								onError: (failure) =>
									setRowError(securityErrorMessage(failure)),
							},
						)
					}
				/>
			) : null}

			{removing ? (
				<RemovePasskeyDialog
					passkey={removing}
					open
					pending={remove.isPending}
					error={rowError}
					onClose={() => {
						setRemoving(null);
						setRowError(null);
					}}
					onConfirm={() =>
						remove.mutate(
							{ id: removing.id },
							{
								onSuccess: () => setRemoving(null),
								onError: (failure) =>
									setRowError(securityErrorMessage(failure)),
							},
						)
					}
				/>
			) : null}
		</View>
	);
}

/**
 * One passkey row. Draws only what is known: the user's label and the registration time.
 * Authenticator model, transport and backup state are not in the response and would not be drawn;
 * the opaque `id` never reaches the screen.
 */
function PasskeyRow({
	passkey: item,
	busy,
	onRename,
	onRemove,
}: {
	passkey: AccountPasskey;
	busy: boolean;
	onRename: () => void;
	onRemove: () => void;
}) {
	const name = passkeyDisplayName(item.name);
	const created = formatDate(item.createdAt);

	return (
		<View style={passkey.row}>
			<View style={passkey.info}>
				<Text variant="body">{name}</Text>
				{created ? (
					<Text variant="caption" tone="muted-foreground">
						{passkeyRegisteredAt(created)}
					</Text>
				) : null}
			</View>
			<View style={passkey.actions}>
				{/**
				 * No single icon button: the two actions differ greatly in outcome (a rename vs losing a sign-in
				 * method) and an icon alone leaves telling them apart to the finger. The label also gives the
				 * accessible name.
				 */}
				<Button
					label={PASSKEY_RENAME_LABEL}
					variant="ghost"
					size="sm"
					disabled={busy}
					onPress={onRename}
					accessibilityLabel={`${name} ${PASSKEY_RENAME_LABEL}`}
				/>
				<Button
					label={PASSKEY_DELETE_LABEL}
					variant="outline"
					size="sm"
					disabled={busy}
					onPress={onRemove}
					accessibilityLabel={`${name} ${PASSKEY_DELETE_LABEL}`}
				/>
			</View>
		</View>
	);
}

const passkey = StyleSheet.create({
	stack: { gap: space.sm },
	row: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
		paddingVertical: space.md,
	},
	info: { flex: 1, gap: space.px, minWidth: 0 },
	actions: { flexDirection: "row", gap: space.sm },
});
