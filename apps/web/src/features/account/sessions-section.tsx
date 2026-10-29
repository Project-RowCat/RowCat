import type { AccountSession } from "@rowcat/domain";
import {
	ACCOUNT_SESSIONS_QUERY_KEY,
	accountSessionsQueryOptions,
	revokeOtherSessionsMutationOptions,
	revokeSessionMutationOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { RevokeOthersDialog } from "./revoke-others-dialog.tsx";
import { needsRecentLogin, securityErrorMessage } from "./security-error.ts";

/**
 * Active sessions: the logins currently open on this account.
 *
 * - Has its own query rather than riding on account info. It can fail on Better Auth's
 *   fresh-session requirement, and folding that failure into account info would take email and
 *   login methods down too. The route loader does not prefetch it for the same reason.
 * - Zero freshness is deliberate: someone asking who is signed in must not get a minute-old
 *   answer.
 * - Needing a recent login is guidance, not a failure. Sessions live 30 days, so long-signed-in
 *   users hit it routinely. The requirement stays on because the same `freshAge` guards identity
 *   checks for account deletion.
 * - No revoke button for the current device: that is sign-out, which has its own path (cookie and
 *   local cache cleanup). Allowing it here would let a user end their own session from this list
 *   without explanation.
 * - Device names are not parsed from User-Agent and IPs are not shown: the strings are
 *   unreliable, and a wrong label makes users end working sessions they think belong to someone
 *   else.
 */

/** How many other devices are shown when collapsed. The current device is always visible regardless. */
const VISIBLE_OTHER_SESSIONS = 4;

export function SessionsSection() {
	const { t } = useTranslation(["account", "common"]);
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const query = useQuery(accountSessionsQueryOptions(client));
	const retry = usePanelRetry(ACCOUNT_SESSIONS_QUERY_KEY, query);

	const [confirmingAll, setConfirmingAll] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const revokeOne = useMutation(
		revokeSessionMutationOptions(client, queryClient),
	);
	const revokeOthers = useMutation(
		revokeOtherSessionsMutationOptions(client, queryClient),
	);

	/**
	 * Paused is not failed. TanStack Query pauses retries when it thinks the network is gone
	 * (`fetchStatus: "paused"`), but the query is still `pending`, not errored. Rendering only a
	 * placeholder would show offline users an endless loading state. This branch must come before
	 * `isPending`.
	 */
	if (query.isPaused && !query.data)
		return (
			<SessionsNotice
				message={t("sessionsSection.youReNotConnectedRight")}
				actionLabel={t("sessionsSection.tryAgain")}
				onAction={retry}
				busy={query.isFetching}
			/>
		);

	/**
	 * A failure takes over the panel only when no value is held. A background refresh failing must not
	 * cover a list the user already has with an error box, which would read as a dropped session. A
	 * held value whose refresh failed is described by the stale line above the list.
	 */
	if (query.isError && !query.data) {
		/**
		 * Needing a recent login is guidance, not a failure. Same layout with different wording, and no
		 * retry button: retrying gets the same answer, and a button that does nothing looks broken.
		 */
		if (needsRecentLogin(query.error))
			return (
				<SessionsNotice message={t("sessionsSection.forSecuritySignOutAnd2")} />
			);
		return (
			<SessionsNotice
				message={securityErrorMessage(query.error)}
				actionLabel={t("sessionsSection.tryAgain")}
				onAction={retry}
				busy={query.isFetching}
				alert
			/>
		);
	}

	/**
	 * Once a value is held, do not fall back to the placeholder. Removing the list during a background
	 * refresh would read as a dropped session.
	 */
	if (!query.data)
		return (
			<output className="block py-2.5 text-sm text-muted-foreground">
				{t("sessionsSection.loadingSessions")}
			</output>
		);

	const sessions = query.data;
	const others = sessions.filter((session) => !session.current);
	/**
	 * Keep the two revoke actions from running side by side. The server handles both safely (revoke is
	 * idempotent), but each response carries a list snapshot from a different moment, so the later one
	 * could resurrect a row the other already removed.
	 */
	const busy = revokeOne.isPending || revokeOthers.isPending;

	/**
	 * When collapsed, the current device always stays and only other devices are cut. Cutting from the
	 * front could drop the current device if server ordering ever changed, and the user would then end
	 * a stranger's session without finding their own row.
	 */
	const hidden = expanded
		? 0
		: Math.max(0, others.length - VISIBLE_OTHER_SESSIONS);
	const visible = sessions.filter(
		(session) =>
			session.current ||
			expanded ||
			others.indexOf(session) < VISIBLE_OTHER_SESSIONS,
	);

	/**
	 * Stale line above the held list: instead of clearing the value, say only that it may not be
	 * current (`docs/design/FAILURE-FEEDBACK.md`). When the refresh was rejected because the fresh
	 * session expired, a retry button would lie (it gets the same answer), so only the sentence is
	 * shown.
	 */
	const staleByRecentLogin = query.isError && needsRecentLogin(query.error);
	const stale = query.isError || query.isPaused;

	return (
		<div className="flex flex-col gap-3 pt-2">
			{stale && (
				<div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
					<p className="text-xs text-muted-foreground">
						{staleByRecentLogin
							? t("sessionsSection.forSecuritySignOutAnd")
							: t("sessionsSection.couldnTRefreshTheCurrent")}
					</p>
					{!staleByRecentLogin && (
						<Button
							variant="outline"
							size="sm"
							disabled={query.isFetching}
							onClick={retry}
						>
							{query.isFetching
								? t("sessionsSection.loading")
								: t("sessionsSection.tryAgain")}
						</Button>
					)}
				</div>
			)}
			{/*
			 * Same convention as the conversation and draft lists (`lib/motion/list-motion.ts`).
			 * Sessions have identity (`session.id`), and both ways a row appears or leaves here are
			 * actions the user just took: revealing hidden devices, or signing one out. Doing either
			 * silently would turn "four other devices" into "nine" with no visible cause.
			 *
			 * Do not use `mode="popLayout"`. It clones the exiting child with a `ref` to position it
			 * absolutely, but SessionRow is a plain function component that takes no ref, so the ref
			 * stays null. Motion's PopChild then returns early and generates no exit styles. Checked
			 * in the browser: the exiting row's `position` stayed `static`. A setting that does nothing
			 * reads as already on for the next person.
			 *
			 * So removal and reflow happen in sequence (opacity 120ms, then move 180ms). Sign-out is
			 * immediate with no confirmation, so focus can be inside the exiting row. `useExitGuard()`
			 * keeps that button unpressable; in browser measurement, `pointer-events: none` was already
			 * applied on the first frame where opacity was 1.
			 */}
			<ul className="divide-y">
				<AnimatePresence initial={false}>
					{visible.map((session) => (
						<SessionRow
							key={session.id}
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
					))}
				</AnimatePresence>
			</ul>

			{/*
			 * Say both that the list is collapsed and how many rows are hidden. Without the count the
			 * button does not say what is behind it, and it would not match the count that
			 * `Sign out all other devices` reports. Counts are not abbreviated (repo rule).
			 */}
			{hidden > 0 && (
				<div>
					<Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
						{t("sessionsSection.showMoreDevices", { count: hidden })}
					</Button>
				</div>
			)}

			{/*
			 * No button when there is nothing to sign out. A disabled button would promise "coming
			 * soon", while having nothing to do is the normal state here.
			 */}
			{others.length > 0 && (
				<div>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => {
							setError(null);
							setConfirmingAll(true);
						}}
					>
						{t("sessionsSection.signOutAllOtherDevices")}
					</Button>
				</div>
			)}

			{/*
			 * Failure attaches next to the control that was pressed and leaves with it
			 * (`lib/motion/feedback.ts`). The only path to this sentence is that the just-pressed
			 * sign-out was rejected, so keeping it visually near that cause helps.
			 *
			 * This is the last flow child of the section. It used to sit above `Sign out all other devices`,
			 * so during the 120ms exit it held that button's vertical slot, and the button rose only
			 * after going transparent. Easing cannot hide that shift, which is why `feedback.ts` limits
			 * this rhythm to sentences with no slot below to claim. The portal `RevokeOthersDialog`
			 * below does not take part in flow.
			 *
			 * Presence is not added to the two blocks above: that would not remove the shift, only
			 * delay it (`docs/motion/ARCHITECTURE.md`, things not done). `role="alert"` stays as is:
			 * the announcement fires when the sentence reaches the DOM and does not wait for the
			 * animation. Motion is an explanation layered on top, not the display itself.
			 */}
			<AnimatePresence initial={false}>
				{error && (
					<m.p
						key="revoke-error"
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>

			{confirmingAll && (
				<RevokeOthersDialog
					count={others.length}
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
			)}
		</div>
	);
}

/**
 * One session row. The current device is marked in text (`This device`). Mis-hitting your own row here
 * logs yourself out, so the distinction is not left to color or order (the server fixes the order,
 * but that alone is not enough).
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
	const { t } = useTranslation(["account", "common"]);
	return (
		<m.li
			layout="position"
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			/*
			 * The exiting row must not be pressable. The guard goes on the row's own `style`, not on the
			 * `exit` target: on `exit` it would never apply in a tab receiving no frames, which is exactly
			 * when a removed row lingers longest (`lib/motion/exit-guard.ts`). Without it, the sign-out
			 * button of an already revoked session would stay live during that window.
			 */
			style={useExitGuard()}
			className="flex flex-wrap items-center justify-between gap-2 py-3"
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-sm font-medium">
					{session.current
						? t("sessionsSection.thisDevice")
						: t("sessionsSection.anotherDevice")}
				</span>
				{/*
				 * Show only what the server holds: sign-in time and expiry. These are facts, not a device name.
				 */}
				{/*
				 * At 320px this line wraps to two lines. Default word breaking (`word-break: normal`) splits
				 * some scripts by character, cutting a time across lines. Someone who came to read the time would
				 * have to read the value twice. `keep-all` breaks only at spaces (this text has tight words,
				 * so it never overflows).
				 */}
				<span className="text-xs [word-break:keep-all] text-muted-foreground">
					{t("sessionsSection.signedInExpires", {
						signedIn: formatDateTime(session.createdAt),
						expires: formatDateTime(session.expiresAt),
					})}
				</span>
			</div>

			{session.current ? (
				/*
				 * No actions on the current device. Sign-out lives in the header's account menu, which includes
				 * local cache cleanup. A second sign-out here would be missing that cleanup in one of the two
				 * places.
				 */
				<span className="text-xs text-muted-foreground">
					{t("sessionsSection.thisIsTheDeviceYou")}
				</span>
			) : (
				<Button variant="outline" size="sm" disabled={busy} onClick={onRevoke}>
					{t("sessionsSection.signOut")}
				</Button>
			)}
		</m.li>
	);
}

/**
 * A single line rendered in place of the list. Never render an empty value: if the fetch failed and
 * the list is left blank, the screen falsely says no other device has ever signed in, which leads
 * users to misjudge their account's safety. A failure is stated as a failure.
 */
function SessionsNotice({
	message,
	actionLabel,
	onAction,
	busy,
	alert,
}: {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	/** Lock the button while the refetch runs, so two presses cannot overlap restarts. */
	busy?: boolean;
	/**
	 * Only failure is an alert. Paused (offline) and guidance are waiting states, so they render
	 * quietly. This distinction was first written on the same prop in `my-reports-section.tsx`.
	 */
	alert?: boolean;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<div className="mt-2 flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
			<p
				{...(alert ? { role: "alert" } : {})}
				className="text-sm text-muted-foreground"
			>
				{message}
			</p>
			{actionLabel && onAction && (
				<Button variant="outline" size="sm" onClick={onAction} disabled={busy}>
					{busy ? t("sessionsSection.loading") : actionLabel}
				</Button>
			)}
		</div>
	);
}
