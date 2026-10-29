import { SYNC_ERROR_CODE } from "@rowcat/contracts";
import type { PairingSession, SyncController } from "@rowcat/sync";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";

/**
 * - Obtains the key from an already trusted device without the recovery code. Three steps: create
 *   and show a code, wait for approval, and pass the approval to the controller. Decryption,
 *   verification and storage happen in one controller call (`session.poll()`), so the screen cannot
 *   come between receiving and trusting, where verification could be deferred.
 * - Polling is allowed only here. Automatic sync never polls, since an idle app makes no
 *   requests. This is an explicit five-minute wait that the user watches, and its timer ends when
 *   the dialog closes. Pairing events are not sent over the SSE wake-up stream either: a
 *   five-minute poll is smaller and more isolated than widening the notification channel into a
 *   general real-time bus.
 * - Reloading restarts the flow. The pairing private key lives only in the `PairingSession`
 *   object. Persisting it to IndexedDB would store material that can open the DEK for a five-minute
 *   convenience, which is exactly what this slice exists to prevent.
 */

/**
 * Polling interval. Seconds are enough, since the wait covers the time a person needs to copy the
 * code.
 */
const POLL_MS = 2_000;
/**
 * Cap on consecutive failures. Polling does not retry forever. With the network down for the full
 * five minutes, about 150 requests would go out and the user would see nothing. After a few
 * failures the flow stops and tells the user.
 */
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
	/** Called right after pairing succeeds. This is where the initial sync is triggered. */
	onPaired: () => void;
}) {
	const { t } = useTranslation(["sync", "common"]);
	const [phase, setPhase] = useState<Phase>("starting");
	const [code, setCode] = useState<string | null>(null);
	const [expiresAt, setExpiresAt] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** A per-second tick for the remaining-time display. It is independent of polling. */
	const [now, setNow] = useState(() => Date.now());
	/**
	 * The open session. A ref is needed to clean up the relay on close. It is a ref rather than state
	 * because nothing renders from it. As state, each new session would trigger a render that changes
	 * nothing.
	 */
	const sessionRef = useRef<PairingSession | null>(null);
	/**
	 * The callback is kept out of the effect's dependency list. Parents normally pass a new arrow
	 * function on each render, which is this callback's natural shape. As a dependency, every parent
	 * re-render would restart the whole pairing flow: the code would change, and a user copying it
	 * would fail for no visible reason.
	 */
	const onPairedRef = useRef(onPaired);
	onPairedRef.current = onPaired;

	useEffect(() => {
		if (!open) return;
		/**
		 * Under StrictMode's double mount, the first run must not continue as if it were the second. A
		 * first session that arrives late leaves the screen alone and only closes its own relay.
		 */
		let live = true;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let failures = 0;

		const stop = (): void => {
			if (timer !== null) clearTimeout(timer);
			timer = null;
		};

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
					setError(translator("sync")("pair.startFailed"));
				}
				return;
			}
			if (!live) {
				void session.cancel().catch(() => undefined);
				return;
			}
			sessionRef.current = session;
			setCode(session.code);
			setExpiresAt(session.expiresAt);
			setPhase("waiting");

			const tick = async (): Promise<void> => {
				if (!live) return;
				/**
				 * Expiry is checked first. The server makes the same decision and is authoritative, but without
				 * this check an expired session would return a 404 that reads as 'cancelled'. To the user these
				 * are different events.
				 */
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
					/**
					 * Terminal failures are separated from transient ones. Terminal failures stop the flow, since
					 * retrying would give the same result. Network failures are retried a few more times.
					 */
					const terminal = terminalMessage(failure);
					if (terminal !== null) {
						sessionRef.current = null;
						setPhase("failed");
						setError(terminal);
						return;
					}
					failures += 1;
					if (failures >= MAX_CONSECUTIVE_FAILURES) {
						setPhase("failed");
						setError(translator("sync")("pair.pollFailed"));
						return;
					}
				}
				timer = setTimeout(() => void tick(), POLL_MS);
			};
			timer = setTimeout(() => void tick(), POLL_MS);
		})();

		return () => {
			live = false;
			stop();
			/**
			 * Closing the dialog also closes the relay. The private key is already gone, so no one can open
			 * the envelope left on the server. A failure to cancel is ignored, because the row expires on
			 * its TTL anyway.
			 */
			const session = sessionRef.current;
			sessionRef.current = null;
			if (session) void session.cancel().catch(() => undefined);
		};
	}, [open, controller]);

	useEffect(() => {
		if (!open || phase !== "waiting") return;
		const id = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(id);
	}, [open, phase]);

	const remaining =
		expiresAt === null ? 0 : Math.max(0, Date.parse(expiresAt) - now);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader>
					<DialogTitle>{t("pair.title")}</DialogTitle>
					<DialogDescription>{t("pair.description")}</DialogDescription>
				</DialogHeader>

				{phase === "starting" && (
					<p className="text-sm text-muted-foreground">{t("pair.creating")}</p>
				)}

				{phase === "waiting" && code !== null && (
					<div className="flex flex-col gap-3">
						{/*
						 * The code is read by eye and typed on another device, so letter spacing and size are the substance
						 * of that task. There is no copy button, because the two devices do not share a clipboard.
						 */}
						<p className="select-all rounded-lg border bg-muted/40 p-4 text-center font-mono text-xl tracking-[0.2em]">
							{code}
						</p>
						<p className="text-sm text-muted-foreground">
							<Trans
								t={t}
								i18nKey="pair.instructions"
								components={{ strong: <strong /> }}
							/>
						</p>
						{/*
						 * The value counts down every second, so the digit counter is `continuous`. The `:` stays fixed and
						 * only the digits roll (`4:59 → 4:58` moves one cell).
						 *
						 * It is not a live region. Announcing a value that changes every second would interrupt screen
						 * readers, and reading and copying the code would become impossible.
						 */}
						<p className="text-sm text-muted-foreground tabular-nums">
							{t("pair.timeLeft")}{" "}
							<AnimatedCount
								value={formatRemaining(remaining)}
								cadence="continuous"
							/>
						</p>
					</div>
				)}

				{phase === "paired" && (
					<div className="flex flex-col gap-1">
						<p className="text-sm">{t("pair.pairedTitle")}</p>
						<p className="text-sm text-muted-foreground">
							{t("pair.pairedBody")}
						</p>
					</div>
				)}

				{phase === "expired" && (
					<div className="flex flex-col gap-1">
						<p className="text-sm">{t("pair.expiredTitle")}</p>
						<p className="text-sm text-muted-foreground">
							{t("pair.expiredBody")}
						</p>
					</div>
				)}

				{phase === "failed" && error !== null && (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{phase === "paired"
							? t("common:actions.close")
							: t("common:actions.cancel")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const formatRemaining = (ms: number): string => {
	const total = Math.floor(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Maps a terminal failure to a sentence. Returns `null` for transient failures, which keep the flow
 * waiting.
 *
 * The most important branch is `pairingKeyRejected`. There the user should check where the code was
 * entered, not retry. This device has also stored nothing at that point. Without saying so, users
 * would assume something was saved wrongly.
 */
function terminalMessage(failure: unknown): string | null {
	const t = translator("sync");
	const row = failure as { name?: string; code?: string } | null;
	if (row?.name === "PairingKeyRejectedError") return t("pair.wrongAccount");
	if (row?.code === SYNC_ERROR_CODE.pairingNotFound)
		return t("pair.expiredOrCancelled");
	/**
	 * The envelope arrived but could not be opened (wrong code, wrong account, or tampering). The
	 * specific cause is not reported. The user's action is the same in every case, and distinguishing
	 * causes would give an attacker a signal.
	 */
	if (row?.name === "SyncCryptoError" || row?.name === "SyncCodecError")
		return t("pair.incomplete");
	if (row?.code === "login_required") return t("pair.loginRequired");
	return null;
}
