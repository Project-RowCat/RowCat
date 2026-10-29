import type { AppealCreateRequest } from "@rowcat/contracts";
import { appealErrorMessage } from "./report-error.ts";

/**
 * The **rules** of filing an appeal, covering everything that can be verified without a screen.
 * (The pair of `report-turn.ts`.)
 *
 * This app's tests do not render React. If the ordering, locking and failure handling live inside
 * the hook, the only way to check them is by hand. A screen that runs twice on this path would file
 * two appeals against the same action; the server rejects the second (one per action), so the user
 * would read the failure message for the appeal they just filed.
 *
 * ## The lock is not React state
 *
 * `if (pending) return` is true only **after the render arrives**. If two fingers touch in the same
 * frame, both checks are false. The lock is a variable in this closure and is set **before** the
 * first `await`.
 *
 * ## The body is not trimmed: only emptiness is checked
 *
 * `trim()` decides only **whether there is anything to send**; what goes out is the user's original
 * text. Trimming is the contract's job (`.trim()` on `AppealCreateRequest`). If the screen trimmed
 * in advance, the limit check would differ in two places (the web made the same decision).
 *
 * ## Where it differs from the report turn: waiting for invalidation
 *
 * A report has its own confirmation copy, so it has no reason to wait for cache cleanup. An appeal
 * is the opposite: its result is **one refreshed restriction row** (when the dialog closes, "under
 * review" appears in the button slot) and there is no separate success banner. If the dialog closed
 * before that row became true, the user would see a screen where nothing appears to have happened.
 * So `submitted` returns only after the restriction-status invalidation finishes.
 *
 * However, **an invalidation failure is not a filing failure.** The server has already received the
 * appeal, and folding that into a failure would make the user resubmit and receive
 * `appeal_duplicate`. A cache-refresh failure is swallowed, and the fact of filing is the answer.
 *
 * ## Nothing is optimistic
 *
 * The appeal row is not fabricated from the filing response: the authoritative id, time and status
 * come from the server, and the status response returned by invalidation produces that row. This
 * file has no `setQueryData`.
 *
 * ## The body does not leak outward
 *
 * The appeal body is a moderation letter the user wrote. A failure result carries only a mapped
 * sentence (`appealErrorMessage`); neither the original error object nor the body is kept in the
 * result. Logging is not part of this app's product path at all (`lib/boundaries.test.ts`).
 */

/** The result of one filing attempt. The screen creates no state beyond these three. */
export type AppealTurnResult =
	/** The server confirmed and the restriction-status invalidation has finished; the dialog may close. */
	| { kind: "submitted" }
	/**
	 * Not sent. **This is not a failure.** `pending` means the first run is still in progress (that
	 * run owns the screen state). `empty-message` means there is nothing to send (a disabled button is
	 * guidance, not a guard: accessibility tools can activate disabled controls too).
	 */
	| { kind: "skipped"; why: "pending" | "empty-message" }
	/** The server rejected it or could not be reached. The form keeps its values and can retry. */
	| { kind: "failed"; message: string };

export interface AppealTurnPorts {
	/** Only `client.moderation.appeal`. Operator-side appeal resolution (`resolve…`) is not this app's concern. */
	submit: (request: AppealCreateRequest) => Promise<unknown>;
	/**
	 * Invalidates **only** `MY_MODERATION_QUERY_KEY`: an appeal changes neither the report list, the
	 * viewer, nor the gallery. It is **awaited**, for the reason in the header above.
	 */
	invalidate: () => Promise<void>;
}

export interface AppealTurnInput {
	actionId: string;
	message: string;
}

export interface AppealTurn {
	run: (input: AppealTurnInput) => Promise<AppealTurnResult>;
}

export function createAppealTurn(ports: AppealTurnPorts): AppealTurn {
	/** Folds a second check in the same tick. It does not wait for a render (see the header above). */
	let running = false;

	return {
		async run({ actionId, message }) {
			if (running) return { kind: "skipped", why: "pending" };
			/** A whitespace-only body has nothing to send. It is trimmed only for the check; the value sent is the original. */
			if (!message.trim()) return { kind: "skipped", why: "empty-message" };
			running = true;
			try {
				try {
					await ports.submit({ actionId, message });
				} catch (failure) {
					return { kind: "failed", message: appealErrorMessage(failure) };
				}
				try {
					await ports.invalidate();
				} catch {
					/** A refresh failure is not a filing failure (see the header above); the fact of filing is the answer. */
				}
				return { kind: "submitted" };
			} finally {
				running = false;
			}
		},
	};
}
