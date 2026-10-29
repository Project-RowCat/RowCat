import type { AccountPasskey } from "@rowcat/domain";
import {
	ACCOUNT_PASSKEYS_QUERY_KEY,
	accountPasskeysQueryOptions,
	deletePasskeyMutationOptions,
	invalidateAccountPasskeys,
	renamePasskeyMutationOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { isPasskeySupported, registerPasskey } from "#/lib/auth.ts";
import { formatDate } from "#/lib/format/date-time.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import {
	RegisterPasskeyDialog,
	RemovePasskeyDialog,
	RenamePasskeyDialog,
} from "./passkey-dialogs.tsx";
import {
	passkeyApiErrorMessage,
	passkeyRegisterErrorMessage,
} from "./passkey-error.ts";
import { passkeyDisplayName } from "./passkey-label.ts";
import { needsRecentLogin } from "./security-error.ts";

/**
 * Passkeys: **the credentials registered to this account**.
 *
 * It is kept apart from the login-methods section on purpose. That section toggles one provider
 * **record** (one per provider per member). This is a **list**: one person registers on a laptop, a
 * phone and a security key. Merged into one section, "3 passkeys" would sit beside "Google", and
 * the delete button on that row could not say what it removes.
 *
 * ## Only registration goes through a different channel
 *
 * ```text
 * registration             auth client — the browser must run the WebAuthn ceremony itself
 * list · rename · delete   RowCat API  — sanitized projection and security notices
 * ```
 *
 * So the post-success handling differs too. Registration invalidates the cache, because its
 * response cannot seed it (the value is the credential row as-is, including the public key). The
 * other two seed the cache with the list the server returned.
 *
 * ## Browsers without support are not broken
 *
 * Without WebAuthn, **only the add button** disappears and the list is still drawn. A user must be
 * able to delete a passkey registered on another device from this browser, and deletion does not
 * need an authenticator.
 */
export function PasskeysSection() {
	const { t } = useTranslation(["account", "common"]);
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const query = useQuery(accountPasskeysQueryOptions(client));
	const retry = usePanelRetry(ACCOUNT_PASSKEYS_QUERY_KEY, query);

	/**
	 * Whether this browser can run the ceremony. **Decided in an effect.**
	 *
	 * Reading `window.PublicKeyCredential` during render would make the server-rendered HTML (always
	 * "unsupported") and the hydrated result disagree. This screen goes through SSR, so the mismatch
	 * really happens.
	 */
	const [supported, setSupported] = useState(false);
	useEffect(() => setSupported(isPasskeySupported()), []);

	const [registerOpen, setRegisterOpen] = useState(false);
	const [registerPending, setRegisterPending] = useState(false);
	const [registerError, setRegisterError] = useState<string | null>(null);

	const [renaming, setRenaming] = useState<AccountPasskey | null>(null);
	const [removing, setRemoving] = useState<AccountPasskey | null>(null);
	const [rowError, setRowError] = useState<string | null>(null);

	const rename = useMutation(renamePasskeyMutationOptions(client, queryClient));
	const remove = useMutation(deletePasskeyMutationOptions(client, queryClient));

	const submitRegister = (name: string): void => {
		setRegisterPending(true);
		setRegisterError(null);
		void registerPasskey(name)
			.then(async (result) => {
				const failure = (result as { error?: AuthFailure | null } | null)
					?.error;
				if (failure) {
					setRegisterError(passkeyRegisterErrorMessage(failure));
					return;
				}
				/**
				 * Do not seed the cache with the response; it is the credential row as-is and includes the
				 * public key. Ask the server **again** instead (the provider connection makes the same
				 * decision).
				 */
				await invalidateAccountPasskeys(queryClient);
				setRegisterOpen(false);
			})
			.catch(() => {
				/**
				 * The browser ceremony threw — **user cancellation arrives here.** Do not draw the caught
				 * exception; use a neutral sentence (its message carries internal details).
				 */
				setRegisterError(passkeyRegisterErrorMessage({}));
			})
			.finally(() => setRegisterPending(false));
	};

	/**
	 * **Separate paused from failed.** When TanStack Query decides there is no network, it pauses
	 * retries, and that state is still `pending`, not an error. A placeholder alone would show offline
	 * users a load that never ends.
	 */
	if (query.isPaused && !query.data)
		return (
			<PasskeysNotice
				message={t("passkeysSection.youReNotConnectedRight")}
				actionLabel={t("passkeysSection.tryAgain")}
				onAction={retry}
				busy={query.isFetching}
			/>
		);

	/**
	 * A failure takes over the screen **only when there is no held value**. If a background refresh
	 * failure covered the held list with an error box, the user would read the passkeys as deleted. A
	 * failure with a value is said by the stale line above the list.
	 */
	if (query.isError && !query.data) {
		/**
		 * A state that needs a fresh login is **guidance, not a failure**. The list query itself does not
		 * require a fresh session, but another gate on this path (session resolution) can wobble, so the
		 * same branch is kept. No "retry" button: pressing it would give the same answer.
		 */
		if (needsRecentLogin(query.error))
			return (
				<PasskeysNotice message={t("passkeysSection.forSecuritySignOutAnd2")} />
			);
		return (
			<PasskeysNotice
				message={passkeyApiErrorMessage(query.error)}
				actionLabel={t("passkeysSection.tryAgain")}
				onAction={retry}
				busy={query.isFetching}
				alert
			/>
		);
	}

	/**
	 * Do not fall back to the placeholder while a held value exists. If the list disappeared during a
	 * background refresh, the user would read the passkeys as deleted.
	 */
	if (!query.data)
		return (
			<output className="block py-2.5 text-sm text-muted-foreground">
				{t("passkeysSection.loadingPasskeys")}
			</output>
		);

	const passkeys = query.data;
	const busy = rename.isPending || remove.isPending;

	/**
	 * A stale line above the held list. Instead of clearing the values, it only says the list may not
	 * be current (the same judgment as the same line in the session list). When the refresh was
	 * rejected because the fresh session expired, a retry button would be a lie, so only the sentence
	 * remains.
	 */
	const staleByRecentLogin = query.isError && needsRecentLogin(query.error);
	const stale = query.isError || query.isPaused;

	return (
		<div className="flex flex-col gap-3 pt-2">
			{stale && (
				<div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
					<p className="text-xs text-muted-foreground">
						{staleByRecentLogin
							? t("passkeysSection.forSecuritySignOutAnd")
							: t("passkeysSection.couldnTRefreshTheCurrent")}
					</p>
					{!staleByRecentLogin && (
						<Button
							variant="outline"
							size="sm"
							disabled={query.isFetching}
							onClick={retry}
						>
							{query.isFetching
								? t("passkeysSection.loading")
								: t("passkeysSection.tryAgain")}
						</Button>
					)}
				</div>
			)}
			{/*
			 * Alternation between the list and the empty state. **The incoming side is joined by
			 * opacity alone** (the same rule as the draft list). Giving the outgoing side an `exit`
			 * would make the empty state's entrance wait for the list's exit animation, and two
			 * surfaces of very different heights would briefly both occupy space.
			 */}
			<AnimatePresence initial={false}>
				{passkeys.length === 0 ? (
					<m.p
						key="empty"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={rowEnter.transition}
						className="text-sm text-muted-foreground"
					>
						{/*
						 * Say that the empty state is not a failure. Also say what to do in a browser
						 * without support: if the screen does not explain why the add button is
						 * missing, it reads as a removed feature.
						 */}
						{supported
							? t("passkeysSection.noPasskeysYetAddOne")
							: t("passkeysSection.noPasskeysYetThisBrowser")}
					</m.p>
				) : (
					/*
					 * The rows carry identity, so they use the **same convention** as the conversation and draft
					 * lists (`lib/motion/list-motion.ts`). Only one path adds a row to this list — the
					 * registration ceremony that just completed — and one path removes one — the delete just
					 * confirmed. Both are things the user did, so there is a value to join. Renaming only changes
					 * the text in place and does not go through this path.
					 *
					 * **`mode="popLayout"` is not used** — same reason as the session list. This row is a function
					 * component (`PasskeyRow`) that takes no `ref`, so Motion cannot track the exiting row, and
					 * the setting does nothing (the session list's comment has the values measured in the
					 * browser). Removal and the fill happen **in order**.
					 */
					<m.ul
						key="list"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={rowEnter.transition}
						className="divide-y"
					>
						<AnimatePresence initial={false}>
							{passkeys.map((passkey) => (
								<PasskeyRow
									key={passkey.id}
									passkey={passkey}
									busy={busy}
									onRename={() => {
										setRowError(null);
										setRenaming(passkey);
									}}
									onRemove={() => {
										setRowError(null);
										setRemoving(passkey);
									}}
								/>
							))}
						</AnimatePresence>
					</m.ul>
				)}
			</AnimatePresence>

			{/*
			 * Do not draw a button on browsers without support. Disabling it would be a false promise of
			 * "coming soon", and this account already has a working sign-in method. The empty state above
			 * or the line below says why it is missing.
			 */}
			{supported ? (
				<div>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => {
							setRegisterError(null);
							setRegisterOpen(true);
						}}
					>
						{t("passkeysSection.addAPasskey")}
					</Button>
				</div>
			) : (
				passkeys.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{t("passkeysSection.thisBrowserDoesnTSupport")}
					</p>
				)
			)}

			{/*
			 * Only failures that must outlive the dialog stand here: the answer to the `rename` or
			 * `delete` just pressed, so the cause is visible (`lib/motion/feedback.ts`). `role="alert"`
			 * stays as it is: the announcement fires when the sentence appears and does not wait for
			 * the animation.
			 */}
			<AnimatePresence initial={false}>
				{rowError && (
					<m.p
						key="row-error"
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-sm text-destructive"
					>
						{rowError}
					</m.p>
				)}
			</AnimatePresence>

			{registerOpen && (
				<RegisterPasskeyDialog
					pending={registerPending}
					error={registerError}
					onClose={() => {
						setRegisterOpen(false);
						setRegisterError(null);
					}}
					onSubmit={submitRegister}
				/>
			)}

			{renaming && (
				<RenamePasskeyDialog
					currentName={renaming.name}
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
									setRowError(passkeyApiErrorMessage(failure)),
							},
						)
					}
				/>
			)}

			{removing && (
				<RemovePasskeyDialog
					name={removing.name}
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
									setRowError(passkeyApiErrorMessage(failure)),
							},
						)
					}
				/>
			)}
		</div>
	);
}

/**
 * One passkey row.
 *
 * It draws **only what is known**: the name the user gave and the registration time. The
 * authenticator model, transport and backup status are not in the response, and even if they were,
 * nothing here would let the user judge by them.
 */
function PasskeyRow({
	passkey,
	busy,
	onRename,
	onRemove,
}: {
	passkey: AccountPasskey;
	busy: boolean;
	onRename: () => void;
	onRemove: () => void;
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
			 * The exiting row is not pressable. Putting the guard on the `exit` target would mean it never
			 * applies in a tab that receives no frames (`lib/motion/exit-guard.ts`). Here, that means the
			 * `Rename` and `Delete` buttons of an already-removed passkey remain live buttons in the meantime.
			 */
			style={useExitGuard()}
			className="flex flex-wrap items-center justify-between gap-2 py-3"
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-sm font-medium break-all">
					{passkeyDisplayName(passkey.name)}
				</span>
				<span className="text-xs text-muted-foreground">
					{t("passkeysSection.registered", {
						date: formatDate(passkey.createdAt),
					})}
				</span>
			</div>
			<div className="flex shrink-0 gap-2">
				<Button variant="ghost" size="sm" disabled={busy} onClick={onRename}>
					{t("passkeysSection.rename")}
				</Button>
				<Button variant="outline" size="sm" disabled={busy} onClick={onRemove}>
					{t("passkeysSection.delete")}
				</Button>
			</div>
		</m.li>
	);
}

/**
 * A line that stands in place of the list. **It is never drawn as an empty value.**
 *
 * If the lookup failed and the list is left empty, the screen says "no passkeys registered", which
 * is false. That kind of lie makes the user misjudge their account's security (the session list
 * made the same call).
 */
function PasskeysNotice({
	message,
	actionLabel,
	onAction,
	busy,
	alert,
}: {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	/** Lock the button while the refetch runs, so two presses do not overlap as restarts. */
	busy?: boolean;
	/**
	 * Only failures are alerts. Stopped (offline) and guidance wait quietly. That distinction is first
	 * written in the same prop of `my-reports-section.tsx`.
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
					{busy ? t("passkeysSection.loading") : actionLabel}
				</Button>
			)}
		</div>
	);
}
