import { space } from "@rowcat/design";
import type { AccountSession } from "@rowcat/domain";
import {
	ACCOUNT_SESSIONS_QUERY_KEY,
	accountSessionsQueryOptions,
	revokeOtherSessionsMutationOptions,
	revokeSessionMutationOptions,
} from "@rowcat/query";
import { Button, Notice, Separator, Spinner, Text } from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import { ACCOUNT_RETRY_LABEL } from "./account-copy.ts";
import { RevokeOthersDialog } from "./revoke-others-dialog.tsx";
import {
	REAUTH_ACTION_LABEL,
	SESSION_CURRENT_LABEL,
	SESSION_CURRENT_NOTE,
	SESSION_OTHER_LABEL,
	SESSION_REVOKE_LABEL,
	SESSIONS_LIST_FAILED,
	SESSIONS_LIST_OFFLINE,
	SESSIONS_LIST_STALE,
	SESSIONS_REVOKE_OTHERS_LABEL,
	sessionsExpandLabel,
	sessionTimesNote,
} from "./security-copy.ts";
import {
	RECENT_LOGIN_REQUIRED,
	securityErrorMessage,
} from "./security-error.ts";
import { securityListView, sessionListView } from "./security-state.ts";
import { useReauth } from "./use-reauth.ts";

/**
 * Active sessions: the sign-ins currently open on this account.
 *
 * - Own query, not on account info: this list can fail on the library's fresh-session requirement
 *   and would drag email, password and login methods down with it. Freshness is 0 on purpose; a
 *   stale answer defeats "who is in my account now".
 * - Needing a fresh login is not an error (normal for 30-day sessions vs the 24h `freshAge`): it
 *   is drawn as the next step with a re-login path instead of `Try again`. The requirement is not
 *   turned off because the same `freshAge` guards account-deletion identity checks.
 * - No revoke button on the current device: that is sign-out, which has its own path
 *   (`session-transition.ts`, with cookie and cache cleanup); the server rejects it too
 *   (`current_session_revoke`).
 * - Device names are not invented from User-Agent or IP: a wrong label makes users revoke a
 *   healthy session. The current device is the server's `current`, stated in text.
 * - One lock (`busy`) across both operations: the two responses carry lists from different
 *   moments, and the late one would revive a row already removed.
 */
export function SessionsSection() {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const query = useQuery(accountSessionsQueryOptions(client));
	const { reauth, pending: reauthPending } = useReauth();

	const [confirmingAll, setConfirmingAll] = useState(false);
	// Pure display state; not in the address or device storage.
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const revokeOne = useMutation(
		revokeSessionMutationOptions(client, queryClient),
	);
	const revokeOthers = useMutation(
		revokeOtherSessionsMutationOptions(client, queryClient),
	);

	const view = securityListView({
		isPaused: query.isPaused,
		isError: query.isError,
		error: query.error,
		hasData: query.data !== undefined,
	});

	const retry = useCallback(() => {
		if (query.data === undefined) {
			void queryClient.resetQueries({
				queryKey: ACCOUNT_SESSIONS_QUERY_KEY,
				exact: true,
			});
			return;
		}
		void query.refetch();
	}, [query.data, query.refetch, queryClient]);

	if (view.state === "loading") return <Spinner />;

	if (view.state === "offline")
		return (
			<Notice
				message={SESSIONS_LIST_OFFLINE}
				actionLabel={ACCOUNT_RETRY_LABEL}
				onAction={retry}
				busy={query.isFetching}
			/>
		);

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
				message={SESSIONS_LIST_FAILED}
				actionLabel={ACCOUNT_RETRY_LABEL}
				onAction={retry}
				busy={query.isFetching}
			/>
		);

	const list = sessionListView({ sessions: query.data ?? [], expanded });
	const busy = revokeOne.isPending || revokeOthers.isPending;

	return (
		<View style={sessions.stack}>
			{view.retryable ? (
				<Notice
					message={SESSIONS_LIST_STALE}
					actionLabel={ACCOUNT_RETRY_LABEL}
					onAction={retry}
					busy={query.isFetching}
				/>
			) : null}

			<View>
				{list.rows.map((session, index) => (
					<Fragment key={session.id}>
						{index === 0 ? null : <Separator />}
						{/**
						 * Rows appear and disappear here (`lib/motion/list-motion.tsx`), as on web. Not for
						 * virtualized lists: `FlatList` remounts rows while scrolling, so the entrance would
						 * run on every scroll; this is a short `map`ed list.
						 */}
						<MotionRow>
							<SessionRow
								session={session}
								busy={busy}
								onRevoke={() => {
									setError(null);
									revokeOne.mutate(
										{ sessionId: session.id },
										{
											onError: (failure) =>
												setError(securityErrorMessage(failure)),
										},
									);
								}}
							/>
						</MotionRow>
					</Fragment>
				))}
			</View>

			{/**
			 * States how many rows are hidden; without the number this button hides what more there
			 * is and the count under `Sign out all` looks inconsistent. Counts are not abbreviated.
			 */}
			{list.hidden > 0 ? (
				<View style={sessions.actions}>
					<Button
						label={sessionsExpandLabel(list.hidden)}
						variant="ghost"
						size="sm"
						onPress={() => setExpanded(true)}
					/>
				</View>
			) : null}

			{/** No button when nothing to revoke: disabled would read as "coming soon". */}
			{list.others > 0 ? (
				<View style={sessions.actions}>
					<Button
						label={SESSIONS_REVOKE_OTHERS_LABEL}
						variant="outline"
						size="sm"
						disabled={busy}
						onPress={() => {
							setError(null);
							setConfirmingAll(true);
						}}
					/>
				</View>
			) : null}

			{error && !confirmingAll ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : null}

			{confirmingAll ? (
				<RevokeOthersDialog
					count={list.others}
					open
					pending={revokeOthers.isPending}
					error={error}
					onClose={() => {
						setConfirmingAll(false);
						setError(null);
					}}
					onConfirm={() =>
						revokeOthers.mutate(undefined, {
							onSuccess: () => setConfirmingAll(false),
							onError: (failure) => setError(securityErrorMessage(failure)),
						})
					}
				/>
			) : null}
		</View>
	);
}

/**
 * One session row. The current device is distinguished by text (`This device`/`Another device`), not color or
 * order, because mis-picking one's own row signs oneself out. Draws only what is known: sign-in and
 * expiry times.
 */
function SessionRow({
	session,
	busy,
	onRevoke,
}: {
	session: AccountSession;
	busy: boolean;
	onRevoke: () => void;
}) {
	const created = formatDateTime(session.createdAt);
	const expires = formatDateTime(session.expiresAt);

	return (
		<View style={sessions.row}>
			<View style={sessions.info}>
				<Text variant="body">
					{session.current ? SESSION_CURRENT_LABEL : SESSION_OTHER_LABEL}
				</Text>
				{created && expires ? (
					<Text variant="caption" tone="muted-foreground">
						{sessionTimesNote(created, expires)}
					</Text>
				) : null}
			</View>

			{session.current ? (
				/** No control on the current device: that is sign-out, which owns cache and scope cleanup. */
				<Text variant="caption" tone="muted-foreground" style={sessions.hint}>
					{SESSION_CURRENT_NOTE}
				</Text>
			) : (
				<Button
					label={SESSION_REVOKE_LABEL}
					variant="outline"
					size="sm"
					disabled={busy}
					onPress={onRevoke}
					/** The same word repeats per row, so the accessible name must say which row. */
					accessibilityLabel={`${SESSION_OTHER_LABEL} ${SESSION_REVOKE_LABEL}${
						created ? ` (signed in ${created})` : ""
					}`}
				/>
			)}
		</View>
	);
}

const sessions = StyleSheet.create({
	stack: { gap: space.sm },
	row: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
		paddingVertical: space.md,
	},
	info: { flex: 1, gap: space.px, minWidth: 0 },
	actions: { flexDirection: "row" },
	hint: { flexShrink: 1, maxWidth: "50%" },
});
