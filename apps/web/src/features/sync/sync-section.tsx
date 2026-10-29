import { Button } from "@rowcat/ui-web/components/button";
import { Switch } from "@rowcat/ui-web/components/switch";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "#/lib/format/relative-time.ts";
import { translator } from "#/lib/i18n/current.ts";
import {
	useAutoSyncSnapshot,
	useSyncRuntime,
	useSyncSnapshot,
} from "#/lib/local-sync/provider.tsx";
import { feedbackEnter } from "#/lib/motion/feedback.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { ApprovePairingDialog } from "./approve-pairing-dialog.tsx";
import { PairDeviceDialog } from "./pair-device-dialog.tsx";
import { RecoveryCodeDialog } from "./recovery-code-dialog.tsx";
import { RecoverySummary } from "./recovery-summary.tsx";
import { ResetSyncDialog } from "./reset-sync-dialog.tsx";
import {
	autoSyncToggleFailed,
	forgetDeviceFailed,
	recoveryRotateFailed,
} from "./sync-failure.ts";
import { UnlockDialog } from "./unlock-dialog.tsx";

/**
 * The one sync section under Account → Data. It is the entire product surface of this slice: two
 * status lines, a toggle and a few buttons.
 *
 * Not built: device list, conflict list, sync history, progress bar, last error code.
 *
 * The missing device list is not an oversight. The server does not know device identities (pairing
 * rows disappear once consumed, cancelled or expired). A list would put a `Revoke remotely`
 * button beside each entry, and that button would be a lie: a device that already holds the DEK
 * cannot be made to forget it from the server side.
 */

/**
 * Maps error codes to sentences. Codes are not shown raw: `sync_quota_exceeded` is accurate, but it
 * does not tell the user what they can do, and the string belongs to us, not to the user.
 */
const KNOWN_ERRORS = [
	"sync_quota_exceeded",
	"sync_keyring_proof_invalid",
	"account_restricted",
	"login_required",
] as const;

const errorText = (code: string): string => {
	const t = translator("sync");
	const known = KNOWN_ERRORS.find((candidate) => candidate === code);
	return known ? t(`error.${known}`) : t("error.fallback");
};

/*
 * Does not take a member id. The only reason this screen ever needed the member was the Web Locks
 * name, and that name now belongs to the runtime. If the screen held identity, it would eventually
 * decide something based on that value.
 */
export function SyncSection() {
	const { t } = useTranslation("sync");
	const runtime = useSyncRuntime();
	const snapshot = useSyncSnapshot();
	const auto = useAutoSyncSnapshot();
	/**
	 * Not a hand-typed `'auto-sync'`. A value that must be unique across the document, written as a
	 * literal, creates a second place that uses the same word; then nobody knows which element
	 * `htmlFor` points to. This is why the other forms in the repository all use `useId`.
	 */
	const autoSyncId = useId();
	const autoSyncNoteId = `${autoSyncId}-note`;
	const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
	const [recoveryTitle, setRecoveryTitle] = useState(() =>
		t("section.recoveryTitleDefault"),
	);
	const [unlocking, setUnlocking] = useState(false);
	const [pairing, setPairing] = useState(false);
	const [approving, setApproving] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [busy, setBusy] = useState(false);

	/*
	 * The server state check (`inspect`) does not happen here. The runtime does it once at startup,
	 * and the automatic unlock of a remembered device happens in that same pass. If this screen asked
	 * again, merely opening the account screen would add an extra round trip.
	 */
	if (!runtime)
		return (
			<p className="text-sm text-muted-foreground">{t("section.preparing")}</p>
		);
	const { controller, autoSync } = runtime;

	/**
	 * Prevents duplicate runs of the same button. Duplicates across tabs are prevented by Web Locks.
	 *
	 * The caller chooses where a failure is shown. Some actions here have the controller set the
	 * snapshot's `lastError`, and the status line below states it (settings, sync now). The rest
	 * simply throw and end. The two cannot be folded into one rule.
	 *
	 * If `announce` is given, a toast is shown. Not every failure gets a toast, to avoid duplication:
	 * when the status line already states the reason, the same failure as a toast would make the user
	 * read two events, and assistive tech would read the same sentence twice.
	 */
	const guard = async (
		run: () => Promise<void>,
		announce?: string,
	): Promise<void> => {
		if (busy) return;
		setBusy(true);
		try {
			await run();
		} catch {
			if (announce) showErrorToast(announce);
		} finally {
			setBusy(false);
		}
	};

	/**
	 * The key for which group of buttons is shown. It is not `snapshot.state`: using the state
	 * directly would redraw the buttons every time `ready` and `syncing` alternate. That alternation
	 * happens on every sync, so the section would become a constantly moving surface (see 'constantly
	 * running decoration' in `docs/motion/ARCHITECTURE.md`).
	 *
	 * Only three axes change which buttons are drawn, and this value is those three. In the trusted
	 * state, `Sync now`'s `disabled` changing is a state change of the same button, not a switch between
	 * groups, so it does not enter this value.
	 */
	const controls =
		snapshot.state === "disabled"
			? "setup"
			: snapshot.state === "locked"
				? "unlock"
				: snapshot.trusted
					? "trusted"
					: "none";

	return (
		<div className="flex flex-col gap-4">
			<StatusLine snapshot={snapshot} auto={auto} />

			{/*
			 * When there is something to recover, state that one fact. This is not a history.
			 *
			 * The section does not grow into a sync-history dashboard (no transfer events, device list, or
			 * developer-facing conflict counters). Its one job here is to tell the user what they stand to
			 * lose.
			 */}
			<RecoverySummary />

			{/*
			 * When the device becomes trusted, three things appear together: the toggle, the action group,
			 * and the note below. If each picked its own rhythm, one event would look like three, so they
			 * share one rhythm at the same moment.
			 *
			 * There is no exit. These blocks set where the content below sits. An exit would make the shift
			 * happen only after the exit ends, so it would look later and larger. This is the same judgment
			 * as the status line (see 'when what disappears must not take its position with it' in
			 * `docs/motion/ARCHITECTURE.md`).
			 */}
			<AnimatePresence initial={false}>
				{snapshot.trusted && (
					/*
					 * The toggle belongs to this device. It does not propagate to other devices (preferences have
					 * no sync axis). Turning it off does not lock anything: the `Sync now` below keeps running.
					 * Turning it off changes the schedule, not sync itself.
					 */
					<m.div
						key="auto-sync"
						className="flex items-center justify-between gap-4"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
					>
						<div className="flex flex-col gap-1">
							<label htmlFor={autoSyncId} className="text-sm font-medium">
								{t("section.autoSyncLabel")}
							</label>
							{/*
							 * The description is bound to the switch. It answers 'what happens if I turn this on?' and 'how
							 * far does this choice reach?', and both must be known the moment focus reaches the control.
							 */}
							<span
								id={autoSyncNoteId}
								className="text-sm text-muted-foreground"
							>
								{t("section.autoSyncNote")}
							</span>
						</div>
						<Switch
							id={autoSyncId}
							checked={auto.enabled}
							disabled={busy}
							aria-describedby={autoSyncNoteId}
							/**
							 * The toggle snaps back on its own, so a failure must not be silent. Its value comes from
							 * storage, so when the write fails the switch returns to its old position. That snap-back
							 * looks the same as 'my press was not reflected'. The status line does not know about this
							 * failure: preference writes do not go through the controller, so `lastError` is never set.
							 */
							onCheckedChange={(next) =>
								guard(
									() => autoSync.setEnabled(next === true),
									autoSyncToggleFailed(),
								)
							}
						/>
					</m.div>
				)}
			</AnimatePresence>

			<AnimatePresence initial={false}>
				<m.div
					key={controls}
					className="flex flex-wrap gap-2"
					initial={feedbackEnter.initial}
					animate={feedbackEnter.animate}
					transition={feedbackEnter.transition}
				>
					{snapshot.state === "disabled" && (
						<Button
							disabled={busy}
							onClick={() =>
								guard(async () => {
									const issued = await controller.setup();
									// The losing side (409) gets null. In that case the flow moves to the lock screen.
									if (!issued) return;
									setRecoveryTitle(t("section.recoveryTitleSetup"));
									setRecoveryCode(issued.recoveryCode);
								})
							}
						>
							{t("section.setup")}
						</Button>
					)}

					{snapshot.state === "locked" && (
						/*
						 * Two paths side by side, but pairing comes first. For someone who already has another device
						 * open, that path is much shorter; a recovery code means finding paper. The recovery code is
						 * not hidden, though: for someone with no trusted devices left, it is the only path.
						 */
						<>
							<Button disabled={busy} onClick={() => setPairing(true)}>
								{t("section.connectFromOtherDevice")}
							</Button>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => setUnlocking(true)}
							>
								{t("section.useRecoveryCode")}
							</Button>
							{/*
							 * The third path is the exit for someone with neither a key nor a recovery code. For accounts
							 * where the first two paths are blocked (for example, a key registered first by someone who stole
							 * the session), this discards the server's ciphertext and restarts from this device's data. The
							 * action cannot be undone, so the confirmation dialog states first what remains.
							 */}
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => setResetting(true)}
							>
								{t("section.startOver")}
							</Button>
						</>
					)}

					{snapshot.trusted &&
						(snapshot.state === "ready" ||
							snapshot.state === "error" ||
							snapshot.state === "syncing") && (
							<Button
								disabled={busy || snapshot.state === "syncing"}
								/*
								 * Manual sync goes through the same gate as automatic sync. Running them side by side would
								 * encrypt and upload the same record twice, and the loser would double its round trips
								 * through conflict retry. If a run is in progress, the request is not rejected; it waits
								 * for one follow-up run after the current one finishes.
								 */
								onClick={() =>
									guard(async () => void (await autoSync.runManualSync()))
								}
							>
								{t("section.syncNow")}
							</Button>
						)}

					{snapshot.trusted && (
						<>
							{/*
							 * Only a device that holds the key can approve. The controller re-checks this (it rejects when the
							 * DEK is not in memory), but drawing the button only in the trusted state means a browser that is
							 * merely signed in never gets a button to press.
							 */}
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => setApproving(true)}
							>
								{t("section.connectNewDevice")}
							</Button>
							<Button
								variant="outline"
								disabled={busy}
								/**
								 * On success a code dialog opens, so on failure no dialog opens at all. The controller does
								 * not set `lastError` here (reissuing does not go through the state machine). Silence would
								 * let someone who believes they received a new code discard the old one.
								 */
								onClick={() =>
									guard(async () => {
										const issued = await controller.rotateRecoveryCode();
										setRecoveryTitle(t("section.recoveryTitleRotated"));
										setRecoveryCode(issued.recoveryCode);
									}, recoveryRotateFailed())
								}
							>
								{t("section.rotateRecoveryCode")}
							</Button>
							<Button
								variant="outline"
								disabled={busy}
								/**
								 * On success this section switches entirely to the lock screen. On failure nothing on the
								 * screen changes (the status line also stays the same, since this action does not set
								 * `lastError`), and the user leaves believing this device's key was erased. On a shared
								 * browser that mistake is expensive.
								 */
								onClick={() =>
									guard(() => controller.forgetDevice(), forgetDeviceFailed())
								}
							>
								{t("section.forgetDevice")}
							</Button>
						</>
					)}
				</m.div>
			</AnimatePresence>

			<AnimatePresence initial={false}>
				{snapshot.trusted && (
					/*
					 * Explains why there is no 'sign out other devices' or 'delete device' button. All trusted
					 * devices share the same key, so remote revocation is impossible unless the key is rotated and
					 * everything is re-uploaded. A button that only blocked transmission would be a lie to the
					 * user.
					 */
					<m.p
						key="forget-note"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
						className="text-xs text-muted-foreground"
					>
						{t("section.forgetNote")}
					</m.p>
				)}
			</AnimatePresence>

			<RecoveryCodeDialog
				code={recoveryCode}
				title={recoveryTitle}
				onAcknowledge={() => setRecoveryCode(null)}
			/>
			<PairDeviceDialog
				open={pairing}
				controller={controller}
				onClose={() => setPairing(false)}
				/*
				 * The moment pairing finishes is the first moment this device can run. It uses the same signal
				 * as unlock. Calling the controller directly here would create a second execution path running
				 * alongside the coordinator.
				 */
				onPaired={() => autoSync.requestSync("unlocked")}
			/>
			<ApprovePairingDialog
				open={approving}
				onClose={() => setApproving(false)}
				onApprove={(code) => controller.approvePairing(code)}
			/>
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
					/*
					 * The moment the lock is released is the first moment automatic sync can run. If it is not
					 * signaled, nothing happens until the next trigger (returning to the foreground, a local
					 * edit), and the user sees the screen unchanged after unlocking.
					 */
					autoSync.requestSync("unlocked");
				}}
			/>
		</div>
	);
}

/**
 * The status line's current sentence. `snapshot.state` is not used directly because `idle` and
 * `checking` read as the same sentence on screen; separating them would flip identical text once
 * when the runtime starts. The value is not folded further: `ready` and `syncing` are different
 * sentences, and their alternation is the state change the user sees most often here.
 */
const statusPhase = (
	state: ReturnType<typeof useSyncSnapshot>["state"],
): string => (state === "idle" ? "checking" : state);

/**
 * Where this section's state machine is visible. Six states draw different paragraphs (checking,
 * unset, locked, syncing, failed, last sync). If they flipped abruptly in the same place, the
 * change would read as 'the screen was redrawn' and the user could not follow what became what.
 *
 * There is no exit, and that is this slot's rule. The line is the section's first flow child, so it
 * sets the position of the toggle and buttons below. An exit would make the shift happen after the
 * exit finished, so it would look later and larger (the same judgment as the `Show more` button in the
 * session list; see 'when what disappears must not take its position with it' in
 * `docs/motion/ARCHITECTURE.md`).
 *
 * The geometry takes its final value immediately, and only the new sentence arrives, with opacity
 * and 4px. The state never waits on motion. The rhythm is that of the fade-in-out sentences
 * (`feedback.ts`), so values are not chosen separately for each screen.
 */
function StatusLine({
	snapshot,
	auto,
}: {
	snapshot: ReturnType<typeof useSyncSnapshot>;
	auto: ReturnType<typeof useAutoSyncSnapshot>;
}) {
	return (
		<AnimatePresence initial={false}>
			<m.div
				key={statusPhase(snapshot.state)}
				initial={feedbackEnter.initial}
				animate={feedbackEnter.animate}
				transition={feedbackEnter.transition}
			>
				<StatusText snapshot={snapshot} auto={auto} />
			</m.div>
		</AnimatePresence>
	);
}

function StatusText({
	snapshot,
	auto,
}: {
	snapshot: ReturnType<typeof useSyncSnapshot>;
	auto: ReturnType<typeof useAutoSyncSnapshot>;
}) {
	const { t } = useTranslation("sync");
	const { state, lastSyncedAt, lastError } = snapshot;
	if (state === "idle" || state === "checking")
		return (
			<p className="text-sm text-muted-foreground">{t("status.checking")}</p>
		);
	if (state === "disabled")
		return (
			<div className="flex flex-col gap-1">
				<p className="text-sm">{t("status.disabledTitle")}</p>
				<p className="text-sm text-muted-foreground">
					{t("status.disabledBody")}
				</p>
			</div>
		);
	if (state === "locked")
		return (
			<div className="flex flex-col gap-1">
				<p className="text-sm">{t("status.lockedTitle")}</p>
				{/*
				 * Both paths are named. Naming pairing alone would lead someone with no trusted devices left to
				 * read it as a dead end; naming only the recovery code would send someone with another device open
				 * to go look for paper.
				 */}
				<p className="text-sm text-muted-foreground">
					{t("status.lockedBody")}
				</p>
			</div>
		);
	if (state === "syncing")
		return (
			<p className="text-sm text-muted-foreground">{t("status.syncing")}</p>
		);
	if (state === "error")
		return (
			<div className="flex flex-col gap-1">
				{/*
				 * Local edits remain intact even when sync fails. If that were not said, the user would read the
				 * text they just wrote as at risk. Sync failure is not save failure.
				 */}
				<p className="text-sm">{errorText(lastError ?? "")}</p>
				<p className="text-sm text-muted-foreground">{t("status.errorBody")}</p>
			</div>
		);
	return (
		<div className="flex flex-col gap-1">
			<p className="text-sm">
				{lastSyncedAt
					? t("status.lastSynced", { when: relativeTime(lastSyncedAt) })
					: t("status.neverSynced")}
			</p>
			{/*
			 * States in one line what automatic sync is waiting for. Instead of a toast for every failure, this
			 * line exists. Repeatedly announcing 'sync failed' to someone whose Wi-Fi dropped is noise, not
			 * information.
			 */}
			{/*
			 * What automatic sync is waiting for is one of five sentences. This line has its own transition,
			 * separate from the paragraph above, because there is a path where only it changes (the state stays
			 * `ready` while the connection drops and recovers).
			 *
			 * It does not move: the text changes in place, and a 4px offset would make the same sentence look
			 * as if it jumped up a line. What stops it running constantly while retries happen is that `key`
			 * is the text itself: nothing happens while the same sentence persists.
			 */}
			<AnimatePresence initial={false}>
				<m.p
					key={autoText(auto)}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={feedbackEnter.transition}
					className="text-sm text-muted-foreground"
				>
					{autoText(auto)}
				</m.p>
			</AnimatePresence>
		</div>
	);
}

const autoText = (auto: ReturnType<typeof useAutoSyncSnapshot>): string => {
	const t = translator("sync");
	if (!auto.enabled) return t("auto.off");
	if (auto.phase === "offline") return t("auto.offline");
	if (auto.phase === "backoff") return t("auto.backoff");
	if (auto.phase === "blocked" && auto.errorCategory !== null)
		return t("auto.blocked");
	return t("auto.on");
};
