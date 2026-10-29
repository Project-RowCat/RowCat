import {
	type AccountDetails,
	canDisconnectLoginMethod,
	type LoginMethod,
	type LoginMethodProvider,
} from "@rowcat/domain";
import {
	disconnectLoginMethodMutationOptions,
	invalidateAccountDetails,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDate } from "#/lib/format/date-time.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { labelSwapIn, labelSwapOut } from "#/lib/motion/label-swap.ts";
import {
	type ConnectableProvider,
	connectLoginMethod,
	connectLoginMethodErrorMessage,
	consumeConnectReturn,
} from "./connect-login-method.ts";
import { DisconnectMethodDialog } from "./disconnect-method-dialog.tsx";
import { loginMethodLabel } from "./login-method-label.ts";
import { securityErrorMessage } from "./security-error.ts";

/**
 * Login methods: connected and connectable methods in one list.
 *
 * If only connected methods were drawn, nothing on screen would show that Google can be connected,
 * and putting the connect button in another section would split the same concern across two places.
 * So the list always has one row per method this deployment supports, and each row owns its state
 * and its action.
 *
 * ## Disconnect eligibility is not decided by the screen
 *
 * Rows do not check `methods.length > 1`. A pure function decides (`canDisconnectLoginMethod`) and
 * the server runs the same function again. The screen only guides; it is not enforcement. A direct
 * API call gets the same answer.
 *
 * ## Connecting is not signing in
 *
 * Nothing on this screen can call `signInWithGoogle` or `signInWithApple`. Those find the owner of
 * that provider identity and create a new account when there is none. Here the goal is to attach
 * the identity to the current account (`connect-login-method.ts`).
 */

/**
 * Methods this deployment supports. The order here is the display order (credential first).
 *
 * It must match the server's order (`LOGIN_METHOD_ORDER` in `services/account/index.ts`). The
 * server sends connected methods already sorted, and this list fills in the "not connected" rows
 * around them. If the two orders differed, connecting one method would move rows around.
 */
const PROVIDERS: LoginMethodProvider[] = [
	"credential",
	"google",
	"apple",
	"kakao",
];

/** Connected through an OAuth round trip. Credential is not one; its row action differs. */
const isConnectable = (
	provider: LoginMethodProvider,
): provider is ConnectableProvider => provider !== "credential";

export function LoginMethodsSection({ account }: { account: AccountDetails }) {
	const queryClient = useQueryClient();
	const [target, setTarget] = useState<LoginMethodProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	/**
	 * Which method the user is currently leaving for.
	 *
	 * With only two rows a boolean was enough. Now a boolean cannot say which button should show "Redirecting…" (if both did, the user would read the other method's row as connecting too).
	 */
	const [connecting, setConnecting] = useState<ConnectableProvider | null>(
		null,
	);

	const disconnect = useMutation(
		disconnectLoginMethodMutationOptions(getRowCatClient(), queryClient),
	);

	/**
	 * After the user returns from a provider connection, reload account details once.
	 *
	 * The marker in the address stays across renders, so without a guard every render would fetch
	 * again. `consumeConnectReturn` also clears the marker, so reload or back navigation does not draw
	 * the same result again, and a failure code does not stay in the browser history.
	 *
	 * **The values in the address are not trusted.** `connected=google` is a claim anyone can type, so
	 * the list is not changed from it; the server is asked again. The screen only draws what the
	 * server has confirmed.
	 */
	const consumed = useRef(false);
	useEffect(() => {
		if (consumed.current) return;
		const result = consumeConnectReturn();
		if (!result) return;
		consumed.current = true;
		/**
		 * The failing method is named in the address (`errorCallbackURL` carries it). The component could
		 * remember which method it started, but that state is lost when the browser leaves the page. The
		 * parser already validated the value.
		 */
		if (result.status === "failed")
			setError(connectLoginMethodErrorMessage(result.provider, result.code));
		void invalidateAccountDetails(queryClient);
	}, [queryClient]);

	const linked = new Map(
		account.methods.map((method) => [method.provider, method]),
	);

	const check =
		target === null
			? null
			: canDisconnectLoginMethod({ methods: account.methods, target });

	const confirmDisconnect = (): void => {
		if (!target) return;
		setError(null);
		disconnect.mutate(
			{ provider: target },
			{
				onSuccess: () => setTarget(null),
				onError: (failure) => setError(securityErrorMessage(failure)),
			},
		);
	};

	const startConnect = (provider: ConnectableProvider): void => {
		setError(null);
		setConnecting(provider);
		/**
		 * On success the browser navigates to the provider and this component unmounts. It only comes
		 * back on failure, and then the progress state is reset. Without the reset the button would stay
		 * on "Redirecting…" forever.
		 *
		 * Failures arrive in two shapes. A failure with a server response resolves with `{ error }` (for
		 * example, when the provider is not configured for this deployment). A failure with no response
		 * at all throws. Checking only the throw would leave the button quietly back to normal with no
		 * message.
		 */
		void connectLoginMethod(provider)
			.then((result) => {
				const failed = (result as { error?: unknown } | null)?.error;
				if (!failed) return;
				setConnecting(null);
				setError(connectLoginMethodErrorMessage(provider, null));
			})
			.catch(() => {
				setConnecting(null);
				setError(connectLoginMethodErrorMessage(provider, null));
			});
	};

	return (
		// Same rhythm (gap-3 pt-2) as the other security sub-sections: the gap between the list and the
		// error line below.
		<div className="flex flex-col gap-3 pt-2">
			<ul className="divide-y">
				{PROVIDERS.map((provider) => (
					<LoginMethodRow
						key={provider}
						provider={provider}
						method={linked.get(provider)}
						canDisconnect={
							canDisconnectLoginMethod({
								methods: account.methods,
								target: provider,
							}).allowed
						}
						/*
						 * **Rows are also locked while another method is in progress.** If two round trips start side
						 * by side, the later one overwrites the earlier one's `state`, and its failure only shows up
						 * after the user finishes the provider screen.
						 */
						connecting={connecting !== null}
						pending={connecting === provider}
						/*
						 * **Credential is not connected here.** That method is created by setting a password, not by
						 * an OAuth round trip, and that action belongs to the password section below. A button here
						 * would give the same action two entry points, and one of them could not say what it does
						 * ("connect" would open the password dialog).
						 */
						onConnect={
							isConnectable(provider) ? () => startConnect(provider) : null
						}
						onDisconnect={() => {
							setError(null);
							setTarget(provider);
						}}
					/>
				))}
			</ul>

			{/*
			 * Failure outside the list. A connection round trip returns its result for the whole
			 * section, not for one row (it is read from the address), and disconnect failures are
			 * already reported inside the dialog. Only the sentence that must outlive the dialog
			 * is placed here.
			 */}
			<AnimatePresence initial={false}>
				{error && !target && (
					<m.p
						key="connect-error"
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

			{target && check && (
				<DisconnectMethodDialog
					target={target}
					/*
					 * The remaining methods are the **value the check returned**. Filtering again here would
					 * create two answers, and any mismatch would show up as the confirmation text saying something
					 * false.
					 */
					remaining={check.allowed ? check.remaining : []}
					pending={disconnect.isPending}
					error={error}
					onClose={() => {
						setTarget(null);
						setError(null);
					}}
					onConfirm={confirmDisconnect}
				/>
			)}
		</div>
	);
}

/**
 * One row: state and action.
 *
 * State is stated in words ("Linked" badge plus the connection date). Color or icons alone would make
 * two rows look the same to someone who cannot distinguish colors, and in this screen that
 * confusion leads to disconnecting a working method.
 */
function LoginMethodRow({
	provider,
	method,
	canDisconnect,
	connecting,
	pending,
	onConnect,
	onDisconnect,
}: {
	provider: LoginMethodProvider;
	method: LoginMethod | undefined;
	canDisconnect: boolean;
	/** Whether any method's round trip is in progress. While it is, this row's connect button is locked too. */
	connecting: boolean;
	/** Whether the in-progress round trip is **this row's**. This is the axis the copy depends on. */
	pending: boolean;
	/** Whether this method can be connected from this row. `null` means the action is elsewhere. */
	onConnect: (() => void) | null;
	onDisconnect: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<li className="flex flex-wrap items-center justify-between gap-2 py-3">
			<div className="flex min-w-0 flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">
						{loginMethodLabel(provider)}
					</span>
					{/*
					 * The row is never created or removed (the list length is fixed). Connecting and
					 * disconnecting only change what is inside the row, and this badge is where the
					 * state is shown. So it uses in-place word swapping rather than presence
					 * (`label-swap.ts`).
					 */}
					<AnimatePresence initial={false} mode="wait">
						<m.span
							key={method ? "linked" : "unlinked"}
							initial={labelSwapIn.initial}
							animate={labelSwapIn.animate}
							exit={labelSwapOut}
							transition={labelSwapIn.transition}
							className="inline-flex"
						>
							{method ? (
								<Badge variant="secondary">
									{t("loginMethodsSection.linked")}
								</Badge>
							) : (
								<Badge variant="outline">
									{t("loginMethodsSection.notLinked")}
								</Badge>
							)}
						</m.span>
					</AnimatePresence>
				</div>
				{method && (
					<span className="text-xs text-muted-foreground">
						{t("loginMethodsSection.since", {
							date: formatDate(method.linkedAt),
						})}
					</span>
				)}
			</div>

			{method ? (
				/*
				 * When this is the last method, the row shows the reason instead of a button. A disabled button
				 * does not say why it cannot be pressed, so the user either thinks the screen is broken or
				 * keeps pressing it.
				 */
				canDisconnect ? (
					<Button variant="outline" size="sm" onClick={onDisconnect}>
						{t("loginMethodsSection.disconnect")}
					</Button>
				) : (
					<span className="text-xs text-muted-foreground">
						{t("loginMethodsSection.thisIsYourLastSign")}
					</span>
				)
			) : onConnect ? (
				<Button
					variant="outline"
					size="sm"
					onClick={onConnect}
					disabled={connecting}
				>
					{pending
						? t("loginMethodsSection.redirecting")
						: t("loginMethodsSection.link")}
				</Button>
			) : (
				/*
				 * No dead button. This method is connected through the password section below, and this
				 * sentence points there. A disabled button would promise "coming soon", but the user can
				 * actually do it right now.
				 */
				<span className="text-xs text-muted-foreground">
					{t("loginMethodsSection.setAPasswordBelowTo")}
				</span>
			)}
		</li>
	);
}
