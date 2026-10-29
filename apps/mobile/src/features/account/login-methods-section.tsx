import { space } from "@rowcat/design";
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
import { Badge, Button, Separator, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	type ConnectableProvider,
	linkAccountProvider,
} from "../../lib/account-security-auth.ts";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import { AnimatedLabel } from "../../lib/motion/animated-label.tsx";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import { LOGIN_METHOD_LABEL } from "./account-copy.ts";
import {
	canConnectOnMobile,
	connectOutcomeNotice,
	isConnectableProvider,
	LOGIN_METHOD_ROWS,
} from "./connect-login-method.ts";
import { DisconnectMethodDialog } from "./disconnect-method-dialog.tsx";
import {
	LOGIN_METHOD_CONNECT_FAILED,
	LOGIN_METHOD_CONNECT_LABEL,
	LOGIN_METHOD_CONNECTING_LABEL,
	LOGIN_METHOD_CREDENTIAL_HINT,
	LOGIN_METHOD_DISCONNECT_LABEL,
	LOGIN_METHOD_LAST_NOTE,
	LOGIN_METHOD_LINKED_LABEL,
	LOGIN_METHOD_UNAVAILABLE_HINT,
	LOGIN_METHOD_UNLINKED_LABEL,
	loginMethodLinkedSince,
} from "./security-copy.ts";
import {
	authSecurityErrorMessage,
	securityErrorMessage,
} from "./security-error.ts";

/**
 * Login methods: connected and connectable methods drawn as one list.
 *
 * Drawing only connected methods would hide that "Google can be connected" and make rows appear and
 * vanish mid security operation. The row count is fixed by the vocabulary (`LOGIN_METHOD_ROWS`),
 * and each row owns its state and its operation.
 *
 * The screen does not decide whether disconnecting is allowed. One pure function in
 * `@rowcat/domain` (`canDisconnectLoginMethod`) decides, and the server re-decides with the same
 * rule; what is drawn here is guidance, not enforcement, and direct API calls get the same answer.
 *
 * Connecting is not signing in. There is no place here to call `signInWithGoogle`, which creates a
 * new account when the provider identity has no owner; the one path is `linkAccountProvider` in
 * `lib/account-security-auth.ts`. A successful link leaves the Better Auth user and `member.id`
 * unchanged, so `Viewer.id`, the local SQLite scope and the sync namespace stay put. Only the
 * account info is re-fetched (`invalidateAccountDetails`; invalidating all of `["viewer"]` would
 * re-query gallery, notifications and analytics).
 *
 * Only one round trip runs at a time: two provider ceremonies started side by side would let the
 * later overwrite the earlier's auth state, and the failure would surface after the user finished
 * the provider screen. So while one runs, the other rows' connect buttons are locked too.
 *
 * The server states the result, except that explicit failures split off first. The browser session
 * does not tell success from cancel (`@better-auth/expo` ends quietly on `result.type !==
 * "success"`), so after the round trip the account info is re-fetched and judged by whether the
 * list contains the method (`connectOutcomeNotice`). But when `linkAccountProvider` returns an
 * explicit failure (`AuthErrorLike`), Better Auth or the transport actually answered with a
 * refusal, and folding it into the neutral sentence would hide what the user can do (sign in again,
 * wait, check the connection). That branch alone goes through `authSecurityErrorMessage` and states
 * the real reason. A cancel produces no error, so it still gets the neutral sentence.
 */
export function LoginMethodsSection({ account }: { account: AccountDetails }) {
	const queryClient = useQueryClient();
	const [target, setTarget] = useState<LoginMethodProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Which method we are leaving for; decides which row draws the in-progress label. */
	const [connecting, setConnecting] = useState<ConnectableProvider | null>(
		null,
	);
	/** The method whose round trip ended; the result sentence is judged by its current link state. */
	const [settled, setSettled] = useState<ConnectableProvider | null>(null);

	const disconnect = useMutation(
		disconnectLoginMethodMutationOptions(getRowCatClient(), queryClient),
	);

	const linked = new Map(
		account.methods.map((method) => [method.provider, method]),
	);

	const check =
		target === null
			? null
			: canDisconnectLoginMethod({ methods: account.methods, target });

	const startConnect = (provider: ConnectableProvider): void => {
		if (connecting !== null) return;
		setError(null);
		setSettled(null);
		setConnecting(provider);
		void linkAccountProvider(provider).then(async (failure) => {
			/**
			 * Whether an error occurred and whether it is connected are different questions. Account info is
			 * re-fetched even after an explicit failure because we do not know at which stage of the
			 * ceremony it failed, and the server is the authority for the list.
			 */
			await invalidateAccountDetails(queryClient);
			setConnecting(null);
			if (failure) {
				/**
				 * An explicit failure is not folded into the neutral sentence (see header). A named reason gets
				 * its own sentence, otherwise the connect operation's generic one; `settled` is not set, so it
				 * does not stack with the neutral notice.
				 */
				setError(
					authSecurityErrorMessage(failure, LOGIN_METHOD_CONNECT_FAILED),
				);
				return;
			}
			/**
			 * Ended without error; from here the server's list decides. Someone who closed the sheet and a
			 * ceremony that ended quietly are the same value, so the non-committal sentence applies
			 * (`connectOutcomeNotice`).
			 */
			setSettled(provider);
		});
	};

	/**
	 * The round trip ended and the method is still not connected: one non-committal sentence. `null`
	 * when connected; success is stated by the row itself ("connected" + timestamp).
	 */
	const outcome = settled
		? connectOutcomeNotice(settled, linked.has(settled))
		: null;

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

	return (
		<View style={methods.stack}>
			<View>
				{LOGIN_METHOD_ROWS.map((provider, index) => (
					<Fragment key={provider}>
						{index === 0 ? null : <Separator />}
						<LoginMethodRow
							provider={provider}
							method={linked.get(provider)}
							canDisconnect={
								canDisconnectLoginMethod({
									methods: account.methods,
									target: provider,
								}).allowed
							}
							/** Locked while another method is leaving (see header). */
							blocked={connecting !== null || disconnect.isPending}
							pending={connecting === provider}
							onConnect={
								canConnectOnMobile(provider)
									? () => startConnect(provider)
									: null
							}
							onDisconnect={() => {
								setError(null);
								setSettled(null);
								setTarget(provider);
							}}
						/>
					</Fragment>
				))}
			</View>

			{/**
			 * Answers outside the list: a connect round trip returns as a result for the whole
			 * section, not one row, and disconnect failures are already said inside the dialog;
			 * only sentences that must outlive the dialog stand here.
			 */}
			{outcome ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{outcome}
					</Text>
				</FeedbackLine>
			) : null}
			{error && !target ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : null}

			{target && check ? (
				<DisconnectMethodDialog
					target={target}
					/**
					 * The remaining methods are the decision's value; filtering again here would let the two
					 * diverge and the confirmation text would lie.
					 */
					remaining={check.allowed ? check.remaining : []}
					open
					pending={disconnect.isPending}
					error={error}
					onClose={() => {
						setTarget(null);
						setError(null);
					}}
					onConfirm={confirmDisconnect}
				/>
			) : null}
		</View>
	);
}

/**
 * One row: state and operation.
 *
 * State is stated in text (`Linked`, `Not linked` plus link time). Colour or icon alone would make the
 * two rows look the same to someone who cannot tell colours apart, and here that confusion ends in
 * disconnecting a working method.
 */
function LoginMethodRow({
	provider,
	method,
	canDisconnect,
	blocked,
	pending,
	onConnect,
	onDisconnect,
}: {
	provider: LoginMethodProvider;
	method: LoginMethod | undefined;
	canDisconnect: boolean;
	/** Whether any operation is running; this row's buttons lock meanwhile. */
	blocked: boolean;
	/** Whether the running operation is this row's; it switches the label. */
	pending: boolean;
	/** Whether connecting can start from this row; `null` means no operation or it lives elsewhere. */
	onConnect: (() => void) | null;
	onDisconnect: () => void;
}) {
	const linkedAt = method ? formatDate(method.linkedAt) : null;

	return (
		<View style={methods.row}>
			<View style={methods.info}>
				<View style={methods.head}>
					<Text variant="body">{LOGIN_METHOD_LABEL[provider]}</Text>
					{/**
					 * The badge word switches in place: connecting or disconnecting changes the
					 * row, and a silent swap forces re-reading the list to know the round trip
					 * landed (the web row uses the same rhythm).
					 *
					 * The two words never stand together. Overlapping would stretch the box to the
					 * longer one and make assistive tech read `Connected Not connected` together
					 * (`lib/motion/animated-label.tsx`).
					 */}
					<AnimatedLabel value={method ? "linked" : "unlinked"}>
						<Badge
							label={
								method ? LOGIN_METHOD_LINKED_LABEL : LOGIN_METHOD_UNLINKED_LABEL
							}
							variant={method ? "secondary" : "outline"}
						/>
					</AnimatedLabel>
				</View>
				{linkedAt ? (
					<Text variant="caption" tone="muted-foreground">
						{loginMethodLinkedSince(linkedAt)}
					</Text>
				) : null}
			</View>

			{method ? (
				canDisconnect ? (
					<Button
						label={LOGIN_METHOD_DISCONNECT_LABEL}
						variant="outline"
						size="sm"
						disabled={blocked}
						onPress={onDisconnect}
					/>
				) : (
					/**
					 * For the last method, the reason and the next step replace the button. A disabled button does
					 * not say why, so users read the screen as broken or keep pressing; here there is something
					 * real they can do.
					 */
					<Text variant="caption" tone="muted-foreground" style={methods.hint}>
						{LOGIN_METHOD_LAST_NOTE}
					</Text>
				)
			) : onConnect ? (
				<Button
					label={
						pending ? LOGIN_METHOD_CONNECTING_LABEL : LOGIN_METHOD_CONNECT_LABEL
					}
					variant="outline"
					size="sm"
					busy={pending}
					disabled={blocked}
					onPress={onConnect}
				/>
			) : (
				/**
				 * No dead button. Credentials come from the password section above, not here, and a social
				 * method with no wiring just states it cannot be started in this app; a disabled button would
				 * be a promise of "coming soon".
				 */
				<Text variant="caption" tone="muted-foreground" style={methods.hint}>
					{isConnectableProvider(provider)
						? LOGIN_METHOD_UNAVAILABLE_HINT
						: LOGIN_METHOD_CREDENTIAL_HINT}
				</Text>
			)}
		</View>
	);
}

const methods = StyleSheet.create({
	stack: { gap: space.sm },
	row: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
		paddingVertical: space.md,
	},
	info: { flex: 1, gap: space.px, minWidth: 0 },
	head: { alignItems: "center", flexDirection: "row", gap: space.sm },
	/** Guidance in the operation slot; shares width so it does not push the row. */
	hint: { flexShrink: 1, maxWidth: "60%" },
});
