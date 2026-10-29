import type { AdultVerificationStartDto } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import {
	type AdultVerificationFailure,
	beginFailure,
	providerCancelled as cancelledFailure,
	completionFailure,
	providerFailed as rejectedFailure,
	staleAccount as staleFailure,
	providerSurfaceFailed as surfaceFailure,
	unsupportedHandoff as unsupportedFailure,
} from "./adult-verification-error.ts";
import {
	type NativeVerificationPlan,
	planNativeVerification,
} from "./adult-verification-handoff.ts";
import {
	ADULT_VERIFICATION_IDLE,
	ADULT_VERIFICATION_SETTLED,
	type AdultVerificationPhase,
} from "./adult-verification-state.ts";

/**
 * Ordering and locking of adult verification, everything testable without a screen. This app's
 * tests do not render React, and here manual testing is especially costly: a screen that runs twice
 * makes two paid external calls, and a callback arriving mid account switch would try to confirm
 * verification against someone else's account (`report-turn.ts` and `generation-turn.ts` sit in the
 * same place for the same reason).
 *
 * ```text
 * this file     order of start/confirm · same-tick second press · duplicate callbacks · account switch
 * use-adult-…   state · refs · mutation wiring · unmount
 * ```
 *
 * Trust boundary of the procedure:
 *
 * ```text
 * 1. note the current account
 * 2. synchronous lock
 * 3. RowCat server creates the attempt (begin)        ← the SERVER makes identityVerificationId
 * 4. re-check ownership
 * 5. authority window                                  ← its "success" is a signal, not evidence
 * 6. re-check ownership
 * 7. RowCat server re-asks the authority (complete)   ← no body; asks by the reference it stored
 * 8. re-check ownership
 * 9. the server-settled viewer lands in the cache      ← @rowcat/query's policy does this
 * ```
 *
 * All three ownership checks (4, 6, 8) are needed: without one, a callback arriving mid account
 * switch would move the current account's eligibility on one authority response. The server
 * re-decides by session so this is not the last door, but without it the screen draws someone
 * else's procedure as its own.
 *
 * The authority's success is not eligibility. `providerCompleted()` leads to `completing`, and no
 * line here writes `verified`/`adult`/`showAdult`; the response object never enters this module
 * (the caller judges with `providerReportedSuccess` and only picks which method to call), so an
 * `adult: true` in the response has no place to be read.
 *
 * `retryCompletion()` is the recovery that does not reopen the authority: if the line drops right
 * after the authority finished, only the server confirmation fails, and reopening would make the
 * user repeat a verification they just completed (one more paid call). The server still holds the
 * attempt, so asking again is enough.
 */

export interface AdultVerificationPorts {
	/** `mutateAsync` of `beginAdultVerificationMutationOptions`; takes no argument. */
	begin(): Promise<AdultVerificationStartDto>;
	/**
	 * `mutateAsync` of `completeAdultVerificationMutationOptions`. Takes no argument by contract:
	 * there is nowhere to put a verification identifier, and the server finds the open attempt of the
	 * session-resolved member itself.
	 */
	complete(): Promise<Viewer>;
	/**
	 * Opens the address in the system browser when the server chose `redirect`. Returns nothing: the
	 * browser closing is all we learn, and the returned address's values are claims (the server
	 * decides with its own secret).
	 */
	openBrowser(url: string): Promise<void>;
	/** The account this screen draws; asked again before every irreversible request. */
	viewerId(): string | null;
	/** The only channel through which this module reaches React. */
	emit(phase: AdultVerificationPhase): void;
}

/** What one operation actually did; the value tests read. */
export type AdultVerificationStep =
	| "started"
	| "verified"
	| "skipped"
	| "failed";

export interface AdultVerificationTurn {
	/** Starts verification. A second press in the same tick folds away. */
	start(): Promise<AdultVerificationStep>;
	/** The authority window ended in success; now ask the server. */
	providerCompleted(): Promise<AdultVerificationStep>;
	providerRejected(): void;
	providerDismissed(): void;
	/** The window itself failed to appear (SDK, webview). */
	providerCrashed(): void;
	/** Re-asks the server only, without reopening the authority. */
	retryCompletion(): Promise<AdultVerificationStep>;
	/** The screen is gone; late callbacks touch neither state nor server. */
	dispose(): void;
}

export function createAdultVerificationTurn(
	ports: AdultVerificationPorts,
): AdultVerificationTurn {
	/**
	 * Folds a same-tick second press. Does not wait for render: `isPending` is true only after a
	 * render arrives, and two fingers in one frame see false twice. A second run would create another
	 * attempt on the server, which replaces the first and silently kills the window already open.
	 */
	let running = false;
	/**
	 * The account that started the current procedure; `null` means none running. Keyed by member id
	 * because adult eligibility is server account state, unrelated to the local store instance (unlike
	 * conversations and drafts, which look at the instance).
	 */
	let owner: string | null = null;
	/**
	 * Whether this authority window's result was already received. The webview can call both
	 * `onComplete` and `onError`, and the user can close the window while a callback is in flight;
	 * without this flag one verification becomes two server confirmations.
	 */
	let settled = false;
	let disposed = false;
	let phase: AdultVerificationPhase = ADULT_VERIFICATION_IDLE;

	const emit = (next: AdultVerificationPhase) => {
		if (disposed) return;
		phase = next;
		ports.emit(next);
	};

	const fail = (failure: AdultVerificationFailure) => {
		owner = null;
		settled = true;
		emit({ kind: "idle", failure, settled: false });
	};

	/** Whether the account at start is still this screen's account. */
	const owns = () => !disposed && owner !== null && owner === ports.viewerId();

	/**
	 * Asks the server for the result, under the same lock as start. Sharing it is the point: a
	 * callback arriving while start runs would otherwise push a confirmation for an attempt that was
	 * just replaced.
	 */
	const runCompletion = async (): Promise<AdultVerificationStep> => {
		if (running || disposed) return "skipped";
		/** 6. Ownership just before the request. */
		if (!owns()) {
			fail(staleFailure());
			return "skipped";
		}
		running = true;
		emit({ kind: "completing" });
		try {
			await ports.complete();
			/**
			 * 8. Ownership after the response. The account may have changed while the request ran, and
			 *    then this success belongs to the previous person; drawing it as applied on the current
			 *    screen would be wrong. The viewer that lands in the cache is `@rowcat/query`'s policy,
			 *    which seats the server-settled value as-is.
			 */
			if (!owns()) {
				fail(staleFailure());
				return "skipped";
			}
			owner = null;
			emit(ADULT_VERIFICATION_SETTLED);
			return "verified";
		} catch (error) {
			const failure = completionFailure(error);
			/**
			 * While the attempt is still alive it gets its own phase, where the only thing to press is the
			 * server confirmation and the authority window does not reopen.
			 */
			if (failure.kind === "completion_failed") {
				emit({ kind: "completion_failed", failure });
				return "failed";
			}
			fail(failure);
			return "failed";
		} finally {
			running = false;
		}
	};

	/**
	 * The round trip when the server chose `redirect`, preserving that verifier's meaning. The browser
	 * closing does not claim success; it only means the person passed that place, and the next step is
	 * always the server re-asking.
	 */
	const runBrowserRoundTrip = async (
		url: string,
	): Promise<AdultVerificationStep> => {
		try {
			await ports.openBrowser(url);
		} catch {
			fail(surfaceFailure());
			return "failed";
		}
		if (settled || disposed) return "skipped";
		settled = true;
		return runCompletion();
	};

	return {
		async start() {
			/** 2. Synchronous lock, before the first `await`. */
			if (running || disposed) return "skipped";
			/** 1. The current account; with none there is no procedure to start. */
			const started = ports.viewerId();
			if (!started) return "skipped";
			running = true;
			owner = started;
			settled = false;
			emit({ kind: "beginning" });

			let plan: NativeVerificationPlan | null = null;
			try {
				const start = await ports.begin();
				/**
				 * 4. Re-check ownership. If the account changed while the attempt was created, that attempt
				 *    is the previous person's and its window must not open for the current one.
				 */
				if (!owns()) {
					fail(staleFailure());
					return "skipped";
				}
				/**
				 * `expiresAt` is not compared with the device clock: on a skewed device that would drop a
				 * healthy attempt or hold a dead one. Expiry authority is the server's rejection code alone
				 * (`isExhaustedAttempt`).
				 */
				plan = planNativeVerification(start.handoff);
			} catch (error) {
				fail(beginFailure(error));
				return "failed";
			} finally {
				/**
				 * While the authority window is up we are outside our lock. It stays open for minutes, and
				 * holding the lock would block even a restart after cancel.
				 */
				running = false;
			}

			if (!plan || plan.kind === "unsupported") {
				fail(unsupportedFailure());
				return "failed";
			}
			emit({ kind: "provider", plan });
			if (plan.kind === "browser") return runBrowserRoundTrip(plan.url);
			return "started";
		},

		async providerCompleted() {
			if (phase.kind !== "provider" || settled) return "skipped";
			settled = true;
			return runCompletion();
		},

		providerRejected() {
			if (phase.kind !== "provider" || settled) return;
			fail(rejectedFailure());
		},

		providerDismissed() {
			/**
			 * Sends nothing to the server. Folding cancel into completion would make the server re-ask the
			 * authority about an unfinished attempt (a paid call), and the user would read "not completed"
			 * about a window they closed themselves.
			 */
			if (phase.kind !== "provider" || settled) return;
			fail(cancelledFailure());
		},

		providerCrashed() {
			if (phase.kind !== "provider" || settled) return;
			fail(surfaceFailure());
		},

		async retryCompletion() {
			/** Exists only in that phase; calling it elsewhere does nothing. */
			if (phase.kind !== "completion_failed") return "skipped";
			return runCompletion();
		},

		dispose() {
			disposed = true;
			owner = null;
			settled = true;
		},
	};
}
