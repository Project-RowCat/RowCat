import type { ByoProvider } from "@rowcat/chat";
import { space } from "@rowcat/design";
import { AlertDialog, Button, Notice, Spinner, Text } from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { formatDate } from "../../lib/format.ts";
import { nativeStreamingFetch } from "../../lib/generation/native-fetch.ts";
import { probeProviderCredential } from "../../lib/generation/transport.ts";
import { useProviderConnections } from "../../lib/local-data/use-provider-connections.ts";
import { AnimatedLabel } from "../../lib/motion/animated-label.tsx";
import { useViewerCapability } from "../../lib/viewer-capability.ts";
import { connectProvider } from "./connect-provider.ts";
import { ProviderConnectionDialog } from "./provider-connection-dialog.tsx";
import {
	type ProviderRow,
	resolveProviderConnectionsState,
} from "./provider-connections-state.ts";
import {
	PROVIDER_BYO_LOCKED,
	PROVIDER_CANCEL_LABEL,
	PROVIDER_CONNECT_LABEL,
	PROVIDER_CONNECTED,
	PROVIDER_DISCONNECT_FAILURE,
	PROVIDER_DISCONNECT_LABEL,
	PROVIDER_DISCONNECTED,
	PROVIDER_LIST_FAILURE,
	PROVIDER_REPLACE_LABEL,
	PROVIDER_RETRY_LABEL,
	PROVIDER_SECTION_DESCRIPTION,
	PROVIDER_SECTION_TITLE,
	PROVIDER_TITLE,
	providerConnectedSince,
	providerDisconnectDescription,
	providerDisconnectTitle,
} from "./provider-copy.ts";
import { SettingsField, SettingsSection } from "./settings-parts.tsx";

/**
 * AI providers: **which providers this device can generate with directly.**
 *
 * ## This section is second on the screen
 *
 * `Generation defaults` (default generation) comes first. A conversation works with the RowCat-provided model
 * without a personal API key, so placing connections above it would make the app look as if it
 * requires a key from members who have none.
 *
 * ## There are always two rows
 *
 * A row does not disappear with the connection state, and it does not come from the catalogue.
 * **This section must stay up even when the model catalogue fails.** People come here mostly
 * because a connection is wrong, and if the list depended on the server response, the thing to fix
 * would vanish (the fixed list is in `provider-copy.ts`, and the decision is in
 * `provider-connections-state.ts`).
 *
 * ## Only the upper half locks
 *
 * For members under 14, `Link` (connect) and `Replace key` (replace) are disabled, but `Disconnect`
 * **stays open.** Deleting a stored key does not create a credential that leaves the device; it
 * removes one that already exists. Locking it symmetrically would leave that person unable to
 * delete an API key still on their device. This is the same axis as deletion and blocking staying
 * open under sanctions.
 *
 * And **we do not delete a stored key on our own.** Deleting someone's API key because their age
 * was confirmed is not our job. At fourteen they simply use it again.
 *
 * ## The secret does not pass through this component
 *
 * Only the summary (`Linked` and the time) lives here. An entered key lives only in the dialog's state
 * and goes straight from submit to the coordinator. This file has no variable holding the value and
 * no port that reads it.
 */
export function ProviderConnectionsSection() {
	const connections = useProviderConnections();
	const capability = useViewerCapability();

	const state = resolveProviderConnectionsState({
		connections: connections.connections,
		loading: connections.loading,
		byoAllowed: capability.byo,
		capabilityLoading: capability.loading,
		lockedMessage: PROVIDER_BYO_LOCKED,
	});

	/** The form open right now. `null` means closed; dialogs are not created per provider. */
	const [form, setForm] = useState<{
		provider: ByoProvider;
		mode: "connect" | "replace";
	} | null>(null);
	/** The disconnect confirmation currently open. */
	const [confirming, setConfirming] = useState<ByoProvider | null>(null);
	const [pending, setPending] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);

	/**
	 * Folds a second submit in the same tick; the coordinator reads this value.
	 *
	 * `pending` is true only **after** the render arrives, so if two fingers touch in the same frame,
	 * both checks return false, two verification requests go out, and two writes race.
	 */
	const guard = useRef(false);

	const submit = (secret: string): void => {
		const target = form;
		const store = connections.store;
		if (!target || !store) return;
		setPending(true);
		setFormError(null);
		void connectProvider({
			provider: target.provider,
			byoAllowed: capability.byo,
			secret,
			/**
			 * Passes **the store as it was when the operation started.** The coordinator does not read "the
			 * store open right now" inside, because of account switching: otherwise a save started on
			 * Alice's screen would finish in Bob's Keychain.
			 */
			store,
			ownsStore: connections.ownsStore,
			probe: (provider, value) =>
				probeProviderCredential(provider, value, {
					/**
					 * Verification gets its own signal. Sharing a lifetime with the other operations on the screen
					 * would leave a request already sent half-finished when the dialog closes.
					 */
					signal: new AbortController().signal,
					fetch: nativeStreamingFetch,
				}),
			guard,
		}).then((outcome) => {
			setPending(false);
			if (outcome.status === "connected") {
				/** On success, close the dialog. **Unmounting is how the plaintext is discarded.** */
				setForm(null);
				return;
			}
			if (outcome.status === "busy") return;
			/**
			 * On failure **keep the dialog open.** The user's next step is inside it, and above all the
			 * value they typed must remain so that retrying takes a single tap.
			 */
			setFormError(outcome.message);
		});
	};

	const disconnect = (provider: ByoProvider): void => {
		const store = connections.store;
		if (!store) return;
		setPending(true);
		setConfirmError(null);
		void store
			.disconnect(provider)
			.then(() => {
				setPending(false);
				setConfirming(null);
			})
			.catch(() => {
				setPending(false);
				setConfirmError(PROVIDER_DISCONNECT_FAILURE);
			});
	};

	return (
		<SettingsSection
			title={PROVIDER_SECTION_TITLE}
			description={PROVIDER_SECTION_DESCRIPTION}
		>
			{state.kind === "loading" ? (
				<View style={provider.loading}>
					<Spinner />
				</View>
			) : (
				<View style={provider.stack}>
					{/**
					 * The reason for being locked is stated **once per section.** Attaching it to each row
					 * would make a two-row list say the same thing twice, and that repetition soon goes unread.
					 */}
					{state.lockedReason ? <Notice message={state.lockedReason} /> : null}

					{/**
					 * Failing to read the list is **not the same as having no connections.** Keep the held
					 * values and add only a stale-data line and a retry.
					 */}
					{connections.failed ? (
						<Notice
							message={PROVIDER_LIST_FAILURE}
							actionLabel={PROVIDER_RETRY_LABEL}
							onAction={connections.reload}
						/>
					) : null}

					{state.rows.map((row) => (
						<ProviderConnectionRow
							key={row.provider}
							row={row}
							busy={pending}
							onConnect={() =>
								setForm({
									provider: row.provider,
									mode: row.connected ? "replace" : "connect",
								})
							}
							onDisconnect={() => setConfirming(row.provider)}
						/>
					))}
				</View>
			)}

			{/**
			 * The dialog is **one at a time.** One dialog per provider would show two stacked layers, and
			 * then Android's back button would have no predictable target.
			 *
			 * When the viewer changes, this whole tree unmounts (the settings shell keys on the member id),
			 * so an unfinished key does not carry over to the next person's form.
			 */}
			{form ? (
				<ProviderConnectionDialog
					/**
					 * The point is that `key` carries both the provider and the mode. If another provider were
					 * opened without closing the dialog, the input's state would persist, and **a key typed for A
					 * would sit in B's form.**
					 */
					key={`${form.provider}:${form.mode}`}
					provider={form.provider}
					mode={form.mode}
					open
					pending={pending}
					error={formError}
					onClose={() => {
						setForm(null);
						setFormError(null);
					}}
					onSubmit={submit}
				/>
			) : null}

			{/**
			 * This is an irreversible confirmation, so it is an `AlertDialog`. What the dialog answers is not
			 * "are you sure?" but **what disappears and what stays**, and that sentence belongs to a pure
			 * module.
			 */}
			<AlertDialog
				open={confirming !== null}
				title={confirming ? providerDisconnectTitle(confirming) : ""}
				description={
					confirming ? providerDisconnectDescription(confirming) : ""
				}
				confirmLabel={PROVIDER_DISCONNECT_LABEL}
				cancelLabel={PROVIDER_CANCEL_LABEL}
				destructive
				busy={pending}
				error={confirmError}
				onConfirm={() => {
					if (confirming) disconnect(confirming);
				}}
				onCancel={() => {
					if (pending) return;
					setConfirming(null);
					setConfirmError(null);
				}}
			/>
		</SettingsSection>
	);
}

/**
 * One row: name, status, actions.
 *
 * The actions are **always visible.** A finger has no hover, so a hidden action is no action at
 * all. That is why this row has no overflow menu and no long-press. It differs from the
 * conversation list row, where there are twenty rooms and actions had to hang somewhere; here there
 * are only two rows.
 */
function ProviderConnectionRow({
	row,
	busy,
	onConnect,
	onDisconnect,
}: {
	row: ProviderRow;
	busy: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}) {
	const summary = connectionSummaryLine(row);

	return (
		<SettingsField
			label={PROVIDER_TITLE[row.provider]}
			/**
			 * The status is stated **in words, not colour.** A single green dot would tell nothing to
			 * someone who cannot distinguish colours (the account screen's email verification status reached
			 * the same conclusion).
			 *
			 * The word **switches in place.** When the user connects or disconnects, this row changes; if
			 * only the text swapped silently, the user would have to reread the list to confirm the action
			 * took effect (the web's `provider-connections.tsx` uses the same rhythm).
			 *
			 * **The two words never appear together.** That matters especially here because it is read text:
			 * if they overlapped, assistive technology would read `Connected Not connected` together
			 * at once (`lib/motion/animated-label.tsx`).
			 *
			 * The placeholder is **outside** this transition (the `state.loading` branch above). Opening the
			 * store is not something the user did, so giving its arrival an entrance animation would make
			 * the connection status fade in every time settings opens.
			 */
			description={
				<AnimatedLabel value={summary}>
					<Text variant="label" tone="muted-foreground">
						{summary}
					</Text>
				</AnimatedLabel>
			}
		>
			<View style={provider.actions}>
				<Button
					label={
						row.connected ? PROVIDER_REPLACE_LABEL : PROVIDER_CONNECT_LABEL
					}
					variant={row.connected ? "outline" : "primary"}
					size="sm"
					fullWidth
					disabled={busy || !row.canConnect}
					accessibilityLabel={`${PROVIDER_TITLE[row.provider]} ${
						row.connected ? PROVIDER_REPLACE_LABEL : PROVIDER_CONNECT_LABEL
					}`}
					onPress={onConnect}
				/>
				{row.connected ? (
					<Button
						label={PROVIDER_DISCONNECT_LABEL}
						variant="destructive"
						size="sm"
						fullWidth
						/** See the header above: disconnecting is allowed even without eligibility. */
						disabled={busy || !row.canDisconnect}
						accessibilityLabel={`${PROVIDER_TITLE[row.provider]} ${PROVIDER_DISCONNECT_LABEL}`}
						onPress={onDisconnect}
					/>
				) : null}
			</View>
		</SettingsField>
	);
}

/**
 * One status line: **never invent a time we do not know.**
 *
 * `formatDate` sometimes returns `null` (an empty time left by an older version, or a corrupted
 * value). In that case, do not draw `Invalid Date` or substitute today's date; just state the
 * status. A wrong time is worse than no time (the same axis as passkey and session lists not
 * inventing device names).
 */
function connectionSummaryLine(row: ProviderRow): string {
	if (!row.connected) return PROVIDER_DISCONNECTED;
	const when = row.updatedAt ? formatDate(row.updatedAt) : null;
	return when
		? `${PROVIDER_CONNECTED} · ${providerConnectedSince(when)}`
		: PROVIDER_CONNECTED;
}

const provider = StyleSheet.create({
	stack: { gap: space.md },
	loading: { paddingVertical: space.lg },
	actions: { gap: space.sm },
});
