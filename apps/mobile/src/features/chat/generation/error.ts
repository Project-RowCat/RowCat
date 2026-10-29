import type { GenerationExecution } from "@rowcat/chat";
import { CHAT_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import {
	ProviderError,
	type ProviderErrorCode,
} from "../../../lib/generation/errors.ts";

/**
 * Generation failure -> the sentence the user reads and the next action.
 *
 * Raw failure text never reaches the screen: only reasons we have named get a sentence, the rest
 * fold to a generic one. Rendering `RowCatApiError.message` would make it impossible to enumerate
 * which code's wording is on screen (500 envelopes with provider text, HTML from proxies).
 *
 * The model is never swapped on the user's behalf: falling back to another model or BYO would
 * change who is billed and which server sees the prompt, with nothing visible happening.
 */

/** Echoing the raw message of an unnamed failure is the most common leak path. */
export const OPAQUE_FAILURE_MESSAGE = "No response was received.";

/**
 * Deployment has no managed generation (503) or cannot route that model (400). One sentence for
 * both because the user can do nothing in either case. It does not say "try again later": nothing
 * changes until configuration does.
 */
export const MANAGED_UNAVAILABLE_MESSAGE =
	"This model can't generate conversations right now.";

/** Both rate limits (per-minute and daily) share one code, and waiting is the remedy for either. Same sentence as web. */
export const RATE_LIMITED_MESSAGE =
	"Too many generation requests. Please try again in a moment.";

/**
 * The deployment's managed generation is allowlist-only and this member is not on it (403). Waiting
 * or pressing again does not help; connecting a personal key does, so the sentence points there.
 * Same sentence as web.
 */
export const MANAGED_NOT_ALLOWED_MESSAGE =
	"This server's default AI is only for allowed accounts. Connect a personal API key in AI settings.";

/** The response arrived but could not be written to the device: a storage failure, not a network one. */
export const PERSISTENCE_FAILED_MESSAGE =
	"Couldn't save the response on this device.";

/**
 * Generation was blocked before it started. Kept apart from provider failures because retrying
 * means nothing here: no request went out and the same conditions always give the same answer.
 *
 * The class builds the sentence on purpose: the pure function decides
 * (`resolveGenerationExecution`) and the app owns the wording, since Korean in the shared package
 * would tie pure rules to a locale.
 */
export class ChatGenerationBlockedError extends Error {
	readonly reason: Extract<
		GenerationExecution,
		{ status: "blocked" }
	>["reason"];
	/**
	 * Whether the block is a missing connection, which is what justifies showing the path to settings
	 * -> AI. False for the child restriction: connecting is itself blocked there, and pointing at a
	 * path that does not exist is worse than none.
	 */
	readonly needsProviderSetup: boolean;

	constructor(execution: Extract<GenerationExecution, { status: "blocked" }>) {
		super(blockedMessage(execution));
		this.name = "ChatGenerationBlockedError";
		this.reason = execution.reason;
		this.needsProviderSetup = execution.reason === "provider_not_connected";
	}
}

function blockedMessage(
	execution: Extract<GenerationExecution, { status: "blocked" }>,
): string {
	/**
	 * The child restriction comes first: showing the connect guidance first would send an under-14
	 * member off to get a key only to be blocked again, after we lost the chance to say why.
	 */
	if (execution.reason === "managed_only")
		return "This story protects its prompt, so you can only chat with RowCat-provided models.";
	if (execution.reason === "byo_not_permitted")
		return "Members under 14 can't generate conversations with a personal API key.";
	/** A connect screen exists now, so this names the next step (the link itself is drawn by `generationRecovery`). */
	if (execution.reason === "provider_not_connected")
		return "The AI provider set for this conversation isn't connected on this device.";
	return "The selected model is no longer available.";
}

/**
 * The confirmed response could not be written to the device. Kept apart from network failures
 * because the facts differ for the user: the response arrived and was read, yet is gone on the next
 * open. Folding it into "no response received" would be false.
 */
export class ChatPersistenceError extends Error {
	constructor(options?: { cause?: unknown }) {
		super(PERSISTENCE_FAILED_MESSAGE, options);
		this.name = "ChatPersistenceError";
	}
}

/**
 * A failure the server sent after the stream started, carried with its code.
 *
 * Folding it into `new Error(event.message)` loses the frame's `code`, and the screen could no
 * longer tell a settlement failure (received text remains) from a provider failure (response was
 * cut). `message` is never rendered as-is; it is kept for diagnostics, and the wording table below
 * is keyed by code only.
 */
export class ChatStreamFailure extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ChatStreamFailure";
		this.code = code;
	}
}

/**
 * The whole provider vocabulary, used to narrow stream-frame codes. A `Record` so a new code breaks
 * compilation here (an array would drop it silently).
 */
const PROVIDER_ERROR_CODES: Record<ProviderErrorCode, true> = {
	invalid_credential: true,
	rate_limited: true,
	quota_exceeded: true,
	model_unavailable: true,
	network: true,
	content_blocked: true,
	provider_error: true,
};

const isProviderErrorCode = (code: string): code is ProviderErrorCode =>
	Object.hasOwn(PROVIDER_ERROR_CODES, code);

/**
 * Turns a provider failure that arrived as a frame back into a `ProviderError`; the first line of
 * the tables below (same as web).
 *
 * BYO adapters report post-start failures as `error` frames (Gemini `content_blocked`, mid-stream
 * overload -> `rate_limited`), which become `ChatStreamFailure(code)` in the turn. While the tables
 * only recognized `instanceof ProviderError`, all of those folded to the generic sentence plus `Regenerate`,
 * so a content block offered a retry that cost one more paid call each press.
 *
 * The sentence is rebuilt: the frame's `message` is server-made on the managed path and is not
 * used. Our wording is applied only when the code is in the vocabulary (server codes carry a
 * `chat_` prefix, so they do not collide).
 */
function asProviderFailure(error: Error): Error {
	if (error instanceof ChatStreamFailure && isProviderErrorCode(error.code))
		return new ProviderError(error.code);
	return error;
}

/**
 * The machine-readable name of a failure, whether it came from an envelope or a stream frame.
 * Exported because two consumers need it (the recovery prompt and the playtest's debug trace); a
 * second judgement in the latter would let two screens name the same failure differently.
 */
export function failureCode(error: Error): string | null {
	if (isRowCatApiError(error)) return error.code;
	if (error instanceof ChatStreamFailure) return error.code;
	return null;
}

/**
 * The sentence the screen may show for this failure. Only errors with no room for vendor response
 * bodies, account info or prompts get their own sentence.
 */
export function generationFailureMessage(failure: Error | null): string {
	if (!failure) return OPAQUE_FAILURE_MESSAGE;
	const error = asProviderFailure(failure);
	if (
		error instanceof ChatGenerationBlockedError ||
		error instanceof ChatPersistenceError ||
		/**
		 * Provider failures get their own sentence too: it comes from our vocabulary
		 * (`lib/generation/errors.ts`) and the vendor response body is never read, so nothing can flow
		 * in. That is why they do not fold to `OPAQUE_FAILURE_MESSAGE`.
		 */
		error instanceof ProviderError
	)
		return error.message;

	const code = failureCode(error);
	if (
		code === CHAT_ERROR_CODE.providerUnconfigured ||
		code === CHAT_ERROR_CODE.managedModelUnavailable
	)
		return MANAGED_UNAVAILABLE_MESSAGE;
	if (code === CHAT_ERROR_CODE.rateLimited) return RATE_LIMITED_MESSAGE;
	if (code === CHAT_ERROR_CODE.managedNotAllowed)
		return MANAGED_NOT_ALLOWED_MESSAGE;

	return OPAQUE_FAILURE_MESSAGE;
}

/**
 * Whether `Try again` may be offered. Withheld for: blocked before start (same answer under the same
 * conditions), deployment without managed generation, and a member outside the managed allowlist. A
 * button there only gives the hope that a few more presses might work.
 */
export function canRetryGeneration(failure: Error | null): boolean {
	if (!failure) return true;
	const error = asProviderFailure(failure);
	if (error instanceof ChatGenerationBlockedError) return false;
	/**
	 * Provider failures differ by kind. Offering `Regenerate` for all of them lets someone whose key was
	 * rejected press the same button repeatedly, one more provider request each time.
	 *
	 * ```text
	 * invalid_credential   key must change          -> settings, not retry
	 * quota_exceeded       provider account issue   -> waiting does not help
	 * model_unavailable    pick another model       -> same answer
	 * content_blocked      change scene or model    -> see the caveat below
	 * rate_limited         waiting helps            -> retry
	 * network, provider    may be transient         -> retry
	 * ```
	 */
	if (error instanceof ProviderError)
		return (
			/**
			 * Content blocks offer no retry, and that judgement is an approximation. Sampling means the same
			 * request could pass next time, but on adult turns we already lowered every tunable threshold
			 * (the adapter's `safetySettingsFor`), so what is still blocked is a prohibition we cannot turn
			 * off or a policy between that account and the provider; pressing again mostly buys one more
			 * paid call and the same answer. Same judgement as web.
			 */
			error.code !== "content_blocked" &&
			error.code !== "invalid_credential" &&
			error.code !== "quota_exceeded" &&
			error.code !== "model_unavailable"
		);
	const code = failureCode(error);
	return (
		code !== CHAT_ERROR_CODE.providerUnconfigured &&
		code !== CHAT_ERROR_CODE.managedModelUnavailable &&
		/** The allowlist does not change on retry; only an operator decision or the member's own key does. */
		code !== CHAT_ERROR_CODE.managedNotAllowed
	);
}

/**
 * The one thing the user can do about a failure, shared by the conversation screen and the
 * playtest. Exists so the two screens do not stack their own `if`s: they already shared one wording
 * table while writing actions separately, and any further provider branches would have diverged on
 * one screen only.
 *
 * Exactly one action is also a rule: two buttons on one failure blur which is the next step, and
 * one of them is usually something the user already tried (`docs/design/FAILURE-FEEDBACK.md`).
 */
export type GenerationRecoveryAction =
	/**
	 * Continue a cut-off response; considered before `Regenerate`. Without this branch a turn cut
	 * mid-output had nothing to press: `Regenerate` only stands on unanswered turns (`unanswered`), a
	 * stored partial response is an answered turn, and the neutral notice folds while a failure
	 * stands.
	 */
	| { kind: "continue"; label: string }
	/** Regenerate under the same conditions; meaningful only on `unanswered` turns. */
	| { kind: "retry"; label: string }
	/** The device's provider connection needs fixing: go to `Settings → AI`. */
	| { kind: "providers"; label: string };

/**
 * Whether this line is a failure or just something that happened. The axis exists for the
 * empty-response branch below, where nothing broke: the provider ended normally and there was
 * simply nothing to read. A red surface would read as breakage; saying nothing leaves nothing to
 * press. Carried as a value so screens do not re-derive it from whether an error was present (same
 * value on web).
 */
export type GenerationRecoveryTone = "failure" | "notice";

export interface GenerationRecovery {
	message: string;
	tone: GenerationRecoveryTone;
	/** When null only the sentence is drawn; no button that goes nowhere. */
	action: GenerationRecoveryAction | null;
}

export const CONTINUE_LABEL = "Continue generating";
export const RETRY_LABEL = "Regenerate";
export const PROVIDER_SETTINGS_LABEL = "Open AI settings";

/**
 * The turn ended normally but there was nothing to read, so the save rule discarded the response.
 * `resolveGenerationOutcome` decides: an empty body after tracking blocks are stripped creates no
 * message and leaves the turn unanswered. This really happens with narration packs, and the screen
 * then holds only the user's own line.
 *
 * ⚠️ For a while this value reached nothing: `unanswered` is read only by this ladder, and its
 * first line was `if (!error) return null`, which folded every unanswered turn without a failure.
 */
export const EMPTY_ANSWER_MESSAGE =
	"The response had no body, so it wasn't saved.";

export function generationRecovery(input: {
	error: Error | null;
	/** Whether an unanswered turn remains; the only condition under which `Regenerate` means anything. */
	unanswered: boolean;
	/**
	 * Whether the last response's tail is open; decided by the shared rule (`continuationTarget`).
	 * Takes the fact rather than the target so this table does not learn the conversation's shape.
	 */
	continuable: boolean;
	/**
	 * Whether the user ended this turn themselves (stop). Used only by the empty-response branch:
	 * stopping is not an error, and "not saved" on something they cut reads as a malfunction. Ignored
	 * when a failure is present, since then the failure ended the turn.
	 */
	stopped: boolean;
}): GenerationRecovery | null {
	const { error } = input;
	/** No failure but no answer: an empty-body response (`EMPTY_ANSWER_MESSAGE`). A neutral notice with one action, regenerate. */
	if (!error)
		return input.unanswered && !input.stopped
			? {
					message: EMPTY_ANSWER_MESSAGE,
					tone: "notice",
					action: { kind: "retry", label: RETRY_LABEL },
				}
			: null;
	const message = generationFailureMessage(error);
	const failure = asProviderFailure(error);

	/** Blocked for lack of a connection. The child restriction is not this branch: the error carries that judgement (`needsProviderSetup`) and the reason is not re-read here. */
	if (error instanceof ChatGenerationBlockedError)
		return {
			message,
			tone: "failure",
			action: error.needsProviderSetup
				? { kind: "providers", label: PROVIDER_SETTINGS_LABEL }
				: null,
		};

	/**
	 * The provider rejected the key. We do not delete the stored key: the failure may be transient
	 * (account policy, suspension) and deleting would be data loss nobody asked for. The user is sent
	 * to where it can be replaced instead.
	 */
	if (
		(failure instanceof ProviderError &&
			failure.code === "invalid_credential") ||
		/**
		 * Outside the managed allowlist: the remedy is the same as a rejected key (connect your own), so
		 * the destination is the same AI settings and neither `Regenerate` nor `Continue generating` stands.
		 */
		failureCode(failure) === CHAT_ERROR_CODE.managedNotAllowed
	)
		return {
			message,
			tone: "failure",
			action: { kind: "providers", label: PROVIDER_SETTINGS_LABEL },
		};

	/**
	 * Continuing from the cut is the recovery for this failure and comes before `Regenerate`: continue
	 * appends after the text being read, retry discards it. The two never really hold together (one
	 * stored character makes the turn answered); the order is written down because that fact lives
	 * outside this file.
	 *
	 * `canRetryGeneration` is checked as well because continuing is the same request: after a rejected
	 * key or exhausted quota it gets the same answer.
	 */
	if (input.continuable && canRetryGeneration(error))
		return {
			message,
			tone: "failure",
			action: { kind: "continue", label: CONTINUE_LABEL },
		};

	return {
		message,
		tone: "failure",
		action:
			input.unanswered && canRetryGeneration(error)
				? { kind: "retry", label: RETRY_LABEL }
				: null,
	};
}
