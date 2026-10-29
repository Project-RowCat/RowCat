import type {
	ReportCreateRequest,
	ReportReason,
	ReportTarget,
} from "@rowcat/contracts";
import { reportErrorMessage } from "./report-error.ts";

/**
 * Report submission rules, checkable without a screen. Ordering, locking and failure handling live
 * here rather than in the hook, because this app's tests do not render React. A screen running this
 * path twice would create two identical reports in the operator queue. Chat generation is split the
 * same way (`generation-turn.ts` and `use-chat-generation.ts`).
 * - This file: no send without a reason, collapse a second confirmation in the same tick, mark
 *   only `My reports` stale on success, and turn failure into a sentence.
 * - The dialog: form state, keyboard and container.
 *
 * The lock is not React state. `if (pending) return` only becomes true after render, so two taps in
 * one frame, or assistive tech activating twice in one tick, would both pass. The lock is a closure
 * variable set before the first `await`.
 *
 * No waiting for cache invalidation. The submission is finished once the server confirms it, and a
 * cleanup failure is not a report failure. That is why `invalidate` returns `void`; a value that
 * can be awaited eventually gets an `await`.
 *
 * Nothing optimistic. The response (`ReportCreateResponse`) carries only an id and a timestamp, not
 * enough to build a `My reports` row (no target, status or reason label), so there is no `setQueryData`.
 * The list fills when the server answers again.
 */

/** Outcome of one submission attempt. The screen must not derive any other state from it. */
export type ReportTurnResult =
	/** Confirmed by the server. The `My reports` invalidation was requested but not awaited. */
	| { kind: "submitted" }
	/**
	 * Not sent. This is not a failure: a person who pressed twice would read "could not submit" while
	 * the first request is still in progress.
	 */
	| { kind: "skipped"; why: "pending" | "no-reason" }
	/** Rejected by the server or unreachable. The form keeps its values so it can retry. */
	| { kind: "failed"; message: string };

export interface ReportTurnPorts {
	/** The single `client.moderation.report` call; no per-target endpoints. */
	submit: (request: ReportCreateRequest) => Promise<unknown>;
	/**
	 * Must return `void` (see header). The scope is decided by `@rowcat/query`: reports change no
	 * public cell (gallery, detail, comments, profile, personalization).
	 */
	invalidate: () => void;
}

export interface ReportTurnInput {
	target: ReportTarget;
	/** May be null; reports without a reason are not sent because they cannot be reviewed. */
	reason: ReportReason | null;
	details: string;
}

export interface ReportTurn {
	run: (input: ReportTurnInput) => Promise<ReportTurnResult>;
}

export function createReportTurn(ports: ReportTurnPorts): ReportTurn {
	/** Synchronous latch for a second confirmation in the same tick (see header). */
	let running = false;

	return {
		async run({ target, reason, details }) {
			if (running) return { kind: "skipped", why: "pending" };
			if (!reason) return { kind: "skipped", why: "no-reason" };
			running = true;
			try {
				/**
				 * Only three fields leave: the target, the reason and the free text. The target snapshot is not
				 * assembled here because the contract has no slot for one; that absence is why a reporter
				 * cannot fabricate evidence.
				 */
				await ports.submit({ target, reason, details });
				ports.invalidate();
				return { kind: "submitted" };
			} catch (failure) {
				/**
				 * The raw error is not forwarded. The request body carries the user's description and, for AI
				 * reports, conversation text; an error object holding it must not reach screen state, where it
				 * could be drawn or logged.
				 */
				return { kind: "failed", message: reportErrorMessage(failure) };
			} finally {
				running = false;
			}
		},
	};
}
