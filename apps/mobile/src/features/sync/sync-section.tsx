import { space } from "@rowcat/design";
import { Button, Notice, Switch, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	useMobileAutoSyncSnapshot,
	useMobileSyncRuntime,
	useMobileSyncSnapshot,
} from "../../lib/local-sync/provider.tsx";
import { ApprovePairingDialog } from "./approve-pairing-dialog.tsx";
import { PairDeviceDialog } from "./pair-device-dialog.tsx";
import { RecoveryCodeDialog } from "./recovery-code-dialog.tsx";
import { RecoverySummary } from "./recovery-summary.tsx";
import { ResetSyncDialog } from "./reset-sync-dialog.tsx";
import {
	SYNC_APPROVE_LABEL,
	SYNC_AUTO_TOGGLE_LABEL,
	SYNC_AUTO_TOGGLE_NOTE,
	SYNC_FORGET_LABEL,
	SYNC_FORGET_NOTE,
	SYNC_NOW_LABEL,
	SYNC_PAIR_LABEL,
	SYNC_RESET_LABEL,
	SYNC_ROTATE_LABEL,
	SYNC_SETUP_LABEL,
	SYNC_STATUS_CHECKING,
	SYNC_UNLOCK_LABEL,
} from "./sync-copy.ts";
import {
	AUTO_SYNC_TOGGLE_FAILED,
	FORGET_DEVICE_FAILED,
	RECOVERY_ROTATE_FAILED,
} from "./sync-failure.ts";
import {
	autoSyncTextFor,
	syncControlsFor,
	syncStatusTextFor,
} from "./sync-state.ts";
import { UnlockDialog } from "./unlock-dialog.tsx";

/**
 * The sync section of Account → Data. Native counterpart of web `sync-section.tsx`.
 *
 * This is the whole product surface here: two status lines, one toggle, a few buttons. Deliberately
 * not built: **device lists**, conflict lists, sync history, progress bars and remote revoke. The
 * missing device list is not an oversight. The server chose not to know device identities, and
 * drawing a list would necessarily put `Remote revoke` beside it, which is a lie today
 * because all trusted devices share the same key.
 *
 * **This screen creates neither the controller nor automatic sync.** The root runtime owns those
 * instances (`lib/local-sync/provider.tsx`), and the server check (`inspect`) also runs once when
 * that runtime starts. Opening the account screen adds no extra round trip.
 *
 * ## Failures are inline
 *
 * Reissue, forget-device and the toggle do not pass through the controller's state machine, so a
 * failure does not change the status line. Left silent, the button would look like it did nothing.
 * This app has no toasts (this slice does not build that layer). The section stays on screen after
 * a failure, so one `Notice` line is the right place (`docs/design/FAILURE-FEEDBACK.md`).
 */
export function SyncSection() {
	const runtime = useMobileSyncRuntime();
	const snapshot = useMobileSyncSnapshot();
	const auto = useMobileAutoSyncSnapshot();
	const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
	const [recoveryTitle, setRecoveryTitle] = useState("Recovery code");
	const [unlocking, setUnlocking] = useState(false);
	const [pairing, setPairing] = useState(false);
	const [approving, setApproving] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [busy, setBusy] = useState(false);
	/** One failure the status line cannot express; the next action clears it. */
	const [actionError, setActionError] = useState<string | null>(null);

	if (!runtime)
		return (
			<Text variant="label" tone="muted-foreground">
				{SYNC_STATUS_CHECKING}
			</Text>
		);
	const { controller, autoSync } = runtime;

	/**
	 * Prevents duplicate runs of the same button. The caller decides where a failure is shown: actions
	 * where the controller sets `lastError` (setup and sync now) are reported by the status line, and
	 * the rest are left as an inline notice through `announce`.
	 */
	const guard = async (
		run: () => Promise<void>,
		announce?: string,
	): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setActionError(null);
		try {
			await run();
		} catch {
			if (announce) setActionError(announce);
		} finally {
			setBusy(false);
		}
	};

	const controls = syncControlsFor(snapshot);
	const status = syncStatusTextFor(snapshot);

	return (
		<View style={styles.root}>
			<View style={styles.status}>
				<Text variant="body">{status.headline}</Text>
				{status.note ? (
					<Text variant="label" tone="muted-foreground">
						{status.note}
					</Text>
				) : null}
				{controls === "trusted" ? (
					<Text variant="label" tone="muted-foreground">
						{autoSyncTextFor(auto)}
					</Text>
				) : null}
			</View>

			{controls === "trusted" ? (
				/**
				 * The toggle belongs to this device: it does not propagate to other devices, and turning it off
				 * does not lock anything; `Sync now` below still runs. Turning it off stops the schedule, not
				 * sync.
				 */
				<View style={styles.toggleRow}>
					<View style={styles.toggleText}>
						<Text variant="body">{SYNC_AUTO_TOGGLE_LABEL}</Text>
						<Text variant="label" tone="muted-foreground">
							{SYNC_AUTO_TOGGLE_NOTE}
						</Text>
					</View>
					<Switch
						label={SYNC_AUTO_TOGGLE_LABEL}
						value={auto.enabled}
						disabled={busy}
						onValueChange={(next) =>
							void guard(
								() => autoSync.setEnabled(next),
								AUTO_SYNC_TOGGLE_FAILED,
							)
						}
					/>
				</View>
			) : null}

			{/**
			 * If there is recoverable content, state that one fact. **This is not a history.**
			 * Do not widen this section into a sync history dashboard: transfer events, device lists and
			 * developer-facing conflict counters do not belong here.
			 */}
			<RecoverySummary />

			<View style={styles.actions}>
				{controls === "setup" ? (
					<Button
						label={SYNC_SETUP_LABEL}
						disabled={busy}
						onPress={() =>
							void guard(async () => {
								const issued = await controller.setup();
								// A losing call (409) returns null; then the screen moves on to the locked view.
								if (!issued) return;
								setRecoveryTitle("Write down your recovery code");
								setRecoveryCode(issued.recoveryCode);
							})
						}
					/>
				) : null}

				{controls === "unlock" ? (
					/** Pairing comes first: a much shorter path for someone who has another device open.
					 * That does not hide the recovery code: for someone with no trusted device left,
					 * it is the only path. */
					<>
						<Button
							label={SYNC_PAIR_LABEL}
							disabled={busy}
							onPress={() => setPairing(true)}
						/>
						<Button
							label={SYNC_UNLOCK_LABEL}
							variant="outline"
							disabled={busy}
							onPress={() => setUnlocking(true)}
						/>
						{/*
						 * The third path: the exit for **someone with neither a key nor a recovery code.** For accounts
						 * where both earlier paths are blocked (a keyring registered first by someone who stole a session,
						 * or someone who lost the paper), this discards the server's ciphertext and restarts from this
						 * device's data.
						 *
						 * **It has the lowest visual weight (`ghost`).** The first two lose nothing, while this one cannot
						 * be undone. If all three carry equal weight, the most dangerous action reads as the shortest path.
						 * It is not hidden, though: a hidden action is no action at all, and for someone stuck here it is
						 * the only way out.
						 */}
						<Button
							label={SYNC_RESET_LABEL}
							variant="ghost"
							disabled={busy}
							onPress={() => setResetting(true)}
						/>
					</>
				) : null}

				{controls === "trusted" ? (
					<>
						<Button
							label={SYNC_NOW_LABEL}
							disabled={busy || snapshot.state === "syncing"}
							/** Manual sync passes the same gate, so no second execution path runs beside it.
							 * It still runs when automatic sync is off. */
							onPress={() =>
								void guard(async () => {
									await autoSync.runManualSync();
								})
							}
						/>
						<Button
							label={SYNC_APPROVE_LABEL}
							variant="outline"
							disabled={busy}
							onPress={() => setApproving(true)}
						/>
						<Button
							label={SYNC_ROTATE_LABEL}
							variant="outline"
							disabled={busy}
							onPress={() =>
								void guard(async () => {
									const issued = await controller.rotateRecoveryCode();
									setRecoveryTitle("New recovery code");
									setRecoveryCode(issued.recoveryCode);
								}, RECOVERY_ROTATE_FAILED)
							}
						/>
						<Button
							label={SYNC_FORGET_LABEL}
							variant="outline"
							disabled={busy}
							onPress={() =>
								void guard(
									() => controller.forgetDevice(),
									FORGET_DEVICE_FAILED,
								)
							}
						/>
					</>
				) : null}
			</View>

			{actionError ? <Notice tone="destructive" message={actionError} /> : null}

			{controls === "trusted" ? (
				<Text variant="label" tone="muted-foreground">
					{SYNC_FORGET_NOTE}
				</Text>
			) : null}

			<RecoveryCodeDialog
				code={recoveryCode}
				title={recoveryTitle}
				onAcknowledge={() => setRecoveryCode(null)}
			/>
			<PairDeviceDialog
				open={pairing}
				controller={controller}
				onClose={() => setPairing(false)}
				/** Pairing completion is the first moment a sync can run; it uses the same signal as unlock.
				 * Calling the controller directly would create a second execution path. */
				onPaired={() => autoSync.requestSync("unlocked")}
			/>
			<ApprovePairingDialog
				open={approving}
				onClose={() => setApproving(false)}
				onApprove={(code) => controller.approvePairing(code)}
			/>
			{/**
			 * Do not call `autoSync.requestSync()` after a reset. This is where it differs from pairing and unlock.
			 * Those two **acquire** a key, so a run can start right away. This one discards the server's ciphertext
			 * and returns this device to `Not set up`. With nothing to upload to, a requested run
			 * would do nothing and end.
			 */}
			<ResetSyncDialog
				open={resetting}
				onClose={() => setResetting(false)}
				onReset={() => controller.reset()}
			/>
			<UnlockDialog
				open={unlocking}
				onClose={() => setUnlocking(false)}
				onUnlock={async (code) => {
					await controller.unlock(code);
					/** The moment the lock is released is the first moment automatic sync may run. */
					autoSync.requestSync("unlocked");
				}}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	status: { gap: space.xs },
	toggleRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.md,
		justifyContent: "space-between",
	},
	toggleText: { flex: 1, gap: space.px },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
