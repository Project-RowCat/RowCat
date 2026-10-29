import { space } from "@rowcat/design";
import type { PairingSession, SyncController } from "@rowcat/sync";
import { Button, Dialog, DialogActions, Text } from "@rowcat/ui-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	PAIRING_POLL_UNREACHABLE,
	PAIRING_START_FAILED,
	pairingTerminalMessage,
} from "./sync-failure.ts";

/**
 * New device: receives the key from an already-trusted device **without entering the recovery
 * code** (native counterpart of web `pair-device-dialog.tsx`).
 *
 * This screen does three things: creates and shows a code, waits for approval, and hands the result
 * to the controller. Decryption, verification and remembering all happen inside one
 * `session.poll()` call; if the screen could step in between "received" and "trusted", verification
 * could drift later.
 *
 * ## Why polling is allowed here
 *
 * Automatic sync has no periodic polling (a quiet app makes no requests). This is the exception: an
 * explicit five-minute procedure the user waits on while looking at this screen, and the timer goes
 * away when the dialog closes.
 *
 * ## Closing the dialog starts over
 *
 * The pairing private key lives only inside the `PairingSession` object. Persisting it to the
 * device would turn a five-minute convenience into a durable ingredient for opening the key.
 */

/** Poll interval. Seconds are enough: a person is copying the code meanwhile. */
const POLL_MS = 2_000;
/** Consecutive failure cap: stop and report instead of hammering for five minutes while disconnected. */
const MAX_CONSECUTIVE_FAILURES = 5;

type Phase = "starting" | "waiting" | "paired" | "expired" | "failed";

export function PairDeviceDialog({
	open,
	controller,
	onClose,
	onPaired,
}: {
	open: boolean;
	controller: SyncController;
	onClose: () => void;
	/** Called right after success; this is where the initial sync is woken. */
	onPaired: () => void;
}) {
	const [phase, setPhase] = useState<Phase>("starting");
	const [code, setCode] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const sessionRef = useRef<PairingSession | null>(null);
	/**
	 * Keeps the callback out of the effect's dependencies. Parents normally pass a new arrow on every
	 * render; restarting the whole pairing each time would change the code the user is copying for no
	 * reason.
	 */
	const onPairedRef = useRef(onPaired);
	onPairedRef.current = onPaired;

	useEffect(() => {
		if (!open) return;
		/** Under StrictMode's double mount, stops the first run from continuing as if it were the second. */
		let live = true;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let failures = 0;

		void (async () => {
			setPhase("starting");
			setError(null);
			setCode(null);
			let session: PairingSession;
			try {
				session = await controller.startPairing();
			} catch {
				if (live) {
					setPhase("failed");
					setError(PAIRING_START_FAILED);
				}
				return;
			}
			if (!live) {
				// Already closed: leave the screen alone and only close the relay.
				void session.cancel().catch(() => undefined);
				return;
			}
			sessionRef.current = session;
			setCode(session.code);
			setPhase("waiting");

			const tick = async (): Promise<void> => {
				if (!live) return;
				/** Check expiry first so an expired session is not read as a 404 ("cancelled"). */
				if (Date.parse(session.expiresAt) <= Date.now()) {
					setPhase("expired");
					return;
				}
				try {
					const result = await session.poll();
					if (!live) return;
					failures = 0;
					if (result === "paired") {
						sessionRef.current = null;
						setPhase("paired");
						onPairedRef.current();
						return;
					}
				} catch (failure) {
					if (!live) return;
					const terminal = pairingTerminalMessage(failure);
					if (terminal !== null) {
						sessionRef.current = null;
						setPhase("failed");
						setError(terminal);
						return;
					}
					failures += 1;
					if (failures >= MAX_CONSECUTIVE_FAILURES) {
						setPhase("failed");
						setError(PAIRING_POLL_UNREACHABLE);
						return;
					}
				}
				timer = setTimeout(() => void tick(), POLL_MS);
			};
			timer = setTimeout(() => void tick(), POLL_MS);
		})();

		return () => {
			live = false;
			if (timer !== null) clearTimeout(timer);
			/**
			 * Closing the dialog also closes the relay. The private key is already gone, so the envelope
			 * left on the server cannot be opened by anyone. Failures are ignored; the row expires anyway.
			 */
			const session = sessionRef.current;
			sessionRef.current = null;
			if (session) void session.cancel().catch(() => undefined);
		};
	}, [open, controller]);

	return (
		<Dialog
			title="Connect from another device"
			description="Enter this code on a device that already uses sync to continue syncing here without a recovery code."
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<View style={styles.root}>
				{phase === "starting" ? (
					<Text variant="label" tone="muted-foreground">
						Creating a code…
					</Text>
				) : null}

				{phase === "waiting" && code !== null ? (
					<View style={styles.waiting}>
						{/** A value read by eye and typed on another device. No copy button, because
						 * the clipboard is not shared between the two devices. */}
						<Text selectable variant="title" style={styles.code}>
							{code}
						</Text>
						<Text variant="label" tone="muted-foreground">
							Enter this code on your existing device under Account → Data →
							Connect a new device. Once approved, this screen moves on by
							itself. The code expires shortly.
						</Text>
					</View>
				) : null}

				{phase === "paired" ? (
					<View style={styles.waiting}>
						<Text variant="body">Sync is open on this device.</Text>
						<Text variant="label" tone="muted-foreground">
							Conversations and drafts from your other devices will show up here
							shortly.
						</Text>
					</View>
				) : null}

				{phase === "expired" ? (
					<View style={styles.waiting}>
						<Text variant="body">The code expired.</Text>
						<Text variant="label" tone="muted-foreground">
							Starting again creates a new code.
						</Text>
					</View>
				) : null}

				{phase === "failed" && error !== null ? (
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				) : null}

				<DialogActions>
					<Button
						label={phase === "paired" ? "Close" : "Cancel"}
						variant="outline"
						fullWidth
						onPress={onClose}
						style={styles.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	waiting: { gap: space.sm },
	code: { textAlign: "center" },
	/** Fills the row in the stacked action column; stands in for `flex: 1` in a horizontal row. */
	action: { alignSelf: "stretch" },
});
