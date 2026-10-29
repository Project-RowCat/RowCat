import { CHAT_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import {
	ProviderError,
	type ProviderErrorCode,
} from "#/lib/generation/errors.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Generation failure → the sentence the user reads and the next action. The conversation screen and
 * the story test share this.
 *
 * Each screen used to keep its own `error instanceof …` chain, and those copies really did diverge.
 * The judgment lives in one place because this table is defined by what it does **not** say: the
 * raw text of an unbounded failure never reaches the screen.
 *
 * ```text
 * GenerationBlockedError   our own sentence, used as is            → settings (no connection)
 * ProviderError            our own sentence, used as is            → settings (key rejected) · retry
 * chat_rate_limited        the server's per-minute and daily cap   → wait, then retry
 * chat_managed_not_allowed outside this deployment's managed list  → settings (connect own key)
 * anything else            folded into a generic sentence          → retry
 * ```
 *
 * The last line is the core rule. A `RowCatApiError`'s `message` is built by the server and is
 * usually readable, but rendering it directly would make it impossible to enumerate which code's
 * copy reaches the screen (a 500 envelope carrying provider text, or HTML leaked by a proxy). So
 * only failures we named carry a sentence; the rest fold.
 */

/** Generic sentence for an unbounded failure. Showing the raw text is the most common leak path. */
const opaqueFailureMessage = (): string =>
	translator("conversation")("failure.opaque");

/**
 * The deployment has managed generation turned off (503), or cannot route this model (400).
 *
 * Both codes share one sentence because **what the user can do is the same** (nothing). It does not
 * say "try again later": nothing changes until the configuration does, so pressing again always
 * gets the same answer.
 */
const managedUnavailableMessage = (): string =>
	translator("conversation")("failure.managedUnavailable");

/**
 * Hit the managed generation rate limit or the daily cap (429).
 *
 * Both caps share one code and therefore one sentence; either way the only option is to wait.
 */
const rateLimitedMessage = (): string =>
	translator("conversation")("failure.rateLimited");

/**
 * This deployment's managed generation is closed by an allowlist and this account is not on it
 * (403).
 *
 * The sentence ends with **the next action** on purpose. It does not clear by waiting or pressing
 * again; it clears when the operator changes the list or the user connects their own key. Only the
 * latter is something this person can do, so the sentence points there.
 */
const managedNotAllowedMessage = (): string =>
	translator("conversation")("failure.managedNotAllowed");

/** The reply was received but could not be written to the device. A storage failure, not a network one. */
const persistenceFailedMessage = (): string =>
	translator("conversation")("failure.persistenceFailed");

/**
 * A failure the server sent **after the stream started**. It keeps the code rather than losing it.
 *
 * ⚠️ This used to be `new Error(event.message)`, and that one line did two bad things. It dropped
 * the code, so a settlement failure and a provider failure looked the same (the user knows
 * different facts in each: in the first, the text they received remains; in the second, the
 * response was cut off). And the server-built sentence landed in `message`. Mobile uses a class of
 * the same name at the same seat.
 *
 * **`message` never reaches the screen directly.** The sentence table below branches on the code
 * only; this field is kept for diagnostics.
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
 * The confirmed response could not be **written to the device**.
 *
 * It is separated from a network failure because the facts differ for the user. The response did
 * arrive and was read on screen, but it is gone when the conversation is opened next time. Folding
 * that into "response not received" would hide what happened, and the sentence would be false.
 */
export class ChatPersistenceError extends Error {
	constructor(options?: { cause?: unknown }) {
		super(persistenceFailedMessage(), options);
		this.name = "ChatPersistenceError";
	}
}

/**
 * The full provider vocabulary. This table **narrows** the code on a stream frame to that
 * vocabulary.
 *
 * It is a `Record` so that compilation breaks here when the vocabulary grows. With an array, a new
 * code would simply be missing from this table, and that failure would fold into the generic
 * sentence described under "provider failures that arrive as frames" below. It would show up as one
 * wrong sentence, not as an error.
 */
const PROVIDER_ERROR_CODES: Record<ProviderErrorCode, true> = {
	invalid_credential: true,
	rate_limited: true,
	quota_exceeded: true,
	model_unavailable: true,
	network: true,
	content_blocked: true,
	browser_blocked: true,
	provider_error: true,
};

const isProviderErrorCode = (code: string): code is ProviderErrorCode =>
	Object.hasOwn(PROVIDER_ERROR_CODES, code);

/**
 * Turns a **provider failure that arrived as a frame** back into a `ProviderError`. It is the first
 * line of the tables below.
 *
 * BYO adapters send failures that happen after the stream starts as `error` frames, not as
 * exceptions (Gemini's `content_blocked`, or an overload received mid-stream → `rate_limited`). The
 * generation hook turns such a frame into `ChatStreamFailure(code)`. While these tables recognized
 * provider reasons only through `instanceof ProviderError`, every such failure folded into `No response was
 * received.` plus `Regenerate`. For content blocking that put a retry button on screen, and each press sent
 * one more paid call.
 *
 * **The sentence is built fresh.** The frame's `message` is not used: on the managed path the
 * server built it, and here there is no way to tell where a frame of that shape came from. Our
 * table's sentence is applied only when the code is in the vocabulary (server codes start with
 * `chat_`, so they do not overlap).
 */
function asProviderFailure(error: Error): Error {
	if (error instanceof ChatStreamFailure && isProviderErrorCode(error.code))
		return new ProviderError(error.code);
	return error;
}

/**
 * The **machine-readable name** of this failure. It comes from the same place whether it arrived in
 * an envelope or as a stream frame.
 *
 * Two consumers: the sentence table below, and the story test's observation record
 * (`generation-debug.ts`). If the latter wrote its own judgment, the two screens would name the
 * same failure differently.
 */
export function failureCode(error: Error | null): string | null {
	if (isRowCatApiError(error)) return error.code;
	if (error instanceof ChatStreamFailure) return error.code;
	return null;
}

/**
 * The **sentence the screen may copy as is** for this failure.
 *
 * Only errors with no room for vendor response bodies, account details or prompts get their own
 * sentence.
 */
export function generationFailureMessage(failure: Error | null): string {
	if (!failure) return opaqueFailureMessage();
	const error = asProviderFailure(failure);
	if (
		error instanceof GenerationBlockedError ||
		error instanceof ProviderError ||
		/**
		 * This sentence is **ours** (the constants above). Three branches use an exception's `message` as
		 * is, and all three take their sentence from this repository.
		 */
		error instanceof ChatPersistenceError
	)
		return error.message;

	/**
	 * Only failures the server named get their own sentence. Failures arriving mid-stream are split
	 * here too; carrying that code is the reason `ChatStreamFailure` exists.
	 */
	const code = failureCode(error);
	if (
		code === CHAT_ERROR_CODE.providerUnconfigured ||
		code === CHAT_ERROR_CODE.managedModelUnavailable
	)
		return managedUnavailableMessage();
	if (code === CHAT_ERROR_CODE.rateLimited) return rateLimitedMessage();
	if (code === CHAT_ERROR_CODE.managedNotAllowed)
		return managedNotAllowedMessage();

	return opaqueFailureMessage();
}

/**
 * Is this a failure that is **resolved on the settings screen**? This is the only basis for showing
 * the route to settings.
 *
 * There are three cases. Generation could not start because no connection exists
 * (`GenerationBlockedError`). A connection exists but the provider rejected its key. Or this
 * deployment closed managed generation with an allowlist and this account is not on it, so the
 * operator's key does not run for this account (`chat_managed_not_allowed`). In all three the next
 * step is to connect or replace one's own key, and the settings screen is the only place for that.
 * Showing `Regenerate` would repeat the same failure.
 *
 * **A stored connection is not deleted because it was rejected.** A 401 could mean the key was
 * revoked, or that the account's permissions changed for a moment. Deleting without being able to
 * tell which would remove a valid key after one failure. Removal is an explicit action the user
 * takes in settings.
 *
 * Limits and credits (`rate_limited`, `quota_exceeded`) are not here. They are the provider
 * account's situation, and nothing on our settings screen can fix them.
 */
export function needsProviderSetup(failure: Error | null): boolean {
	const error = failure && asProviderFailure(failure);
	return (
		(error instanceof GenerationBlockedError && error.needsConnection) ||
		(error instanceof ProviderError && error.code === "invalid_credential") ||
		failureCode(error) === CHAT_ERROR_CODE.managedNotAllowed
	);
}

/**
 * Is it acceptable to show `Regenerate` on this failure?
 *
 * Before this predicate existed, **every failure showed that button.** On a failure where the key
 * was rejected or the provider quota is exhausted, pressing it only gets the same failure again.
 * The user hopes a retry might work, but each press really sends one more request to the provider.
 *
 * ```text
 * invalid_credential   the key must change                  → settings, not retry
 * quota_exceeded       the provider account needs a look    → waiting does not clear it
 * model_unavailable    a different model is needed         → the same answer comes back
 * content_blocked      the scene or model must change      → see the note below
 * rate_limited         clears with waiting                 → retry
 * network·provider     may be transient                    → retry
 * ```
 *
 * **A failure that was blocked before starting is always false.** Under the same conditions the
 * answer is always the same. In particular, a child-account restriction does not even show a
 * connection prompt (`needsProviderSetup` is false), so without this predicate that person would be
 * left with an endlessly pressable `Regenerate`.
 *
 * A failure frame that arrives after the stream starts goes through the same table.
 * `ChatStreamFailure` carries the code, and `asProviderFailure` turns a provider-vocabulary code
 * back into a `ProviderError`.
 */
export function canRetryGeneration(failure: Error | null): boolean {
	if (!failure) return true;
	const error = asProviderFailure(failure);
	if (error instanceof GenerationBlockedError) return false;
	if (error instanceof ProviderError)
		return (
			error.code !== "invalid_credential" &&
			error.code !== "quota_exceeded" &&
			error.code !== "model_unavailable" &&
			/**
			 * **Content blocking does not show retry, and that judgment is an approximation.**
			 *
			 * Generation is sampling, so the same request could pass next time. The button is still removed
			 * for the expected value. On adult turns we have already sent every tunable threshold lowered
			 * (`safetySettingsFor` in the adapter), so what is still blocked is either **a prohibition we
			 * cannot turn off** or the account's policy with the provider. Pressing again usually means one
			 * more paid call for the same answer.
			 *
			 * The sentence says two things the user can do instead (change the scene or use another model).
			 * If `Regenerate` were also shown beside that guidance, the user would press the cheaper option
			 * first.
			 */
			error.code !== "content_blocked"
		);
	/** A failure caused by deployment config or routing gives the same answer under the same conditions. */
	const code = failureCode(error);
	return (
		code !== CHAT_ERROR_CODE.providerUnconfigured &&
		code !== CHAT_ERROR_CODE.managedModelUnavailable &&
		/** The allowlist does not change on retry. What changes is the operator's decision or my own key. */
		code !== CHAT_ERROR_CODE.managedNotAllowed
	);
}

/**
 * The one action the user can take for this failure. Three screens share it.
 *
 * It exists because those three screens **were already copies.** The conversation screen, the story
 * test and the reply suggestion panel each stacked the same `if` ladder, and when a fourth branch
 * (`Continue generating`) was added, only one screen got it. When the order lives in one place, that drift
 * cannot be expressed (see "State order belongs to a pure function" in
 * `docs/design/FAILURE-FEEDBACK.md`).
 *
 * **Having only one action is also a rule.** Two buttons on one failure blur which one to do now,
 * and one of them is usually something the user has already tried. Mobile has the same shape for
 * the same reason (`apps/mobile/src/features/chat/generation/error.ts`).
 */
export type GenerationRecoveryAction =
	/** Continue writing after the cut-off response. **This recovery is considered before `Regenerate`.** */
	| { kind: "continue"; label: string }
	/** Regenerate under the same conditions. Meaningful only for a turn that is unanswered. */
	| { kind: "retry"; label: string }
	/** The provider connection on this device must be fixed — go to `Settings → AI`. */
	| { kind: "providers"; label: string };

/**
 * What this line **is**: a failure, or something that simply happened.
 *
 * The axis exists because of the empty-answer branch below. On that turn nothing broke: the
 * provider sent a normal finish and there was just no text to read. Placing it on the same red
 * surface as a failure would make the user read a malfunction, and with no statement there is
 * nothing to press.
 *
 * **The value is carried, not recomputed by the screen from `error`.** Once that judgment moves
 * down to the screen, this ladder being a single place is only half true.
 */
export type GenerationRecoveryTone = "failure" | "notice";

export interface GenerationRecovery {
	message: string;
	tone: GenerationRecoveryTone;
	/** Without an action only the sentence is drawn. **Never draw a button that goes nowhere.** */
	action: GenerationRecoveryAction | null;
}

export const continueLabel = (): string =>
	translator("conversation")("actions.continue");
export const retryLabel = (): string =>
	translator("conversation")("actions.retry");
export const providerSettingsLabel = (): string =>
	translator("conversation")("actions.providerSettings");

/**
 * A normal finish with **no text to read** — the sentence for where the save rule discarded that
 * response.
 *
 * `resolveGenerationOutcome` makes that judgment: if the body is empty after tracking blocks are
 * stripped, no message is created and the turn stays unanswered. This really happens in
 * conversations with a narration pack (only the table was drawn and the turn ended, or drawing the
 * table hit the output cap). What remains on screen is **only the user's own message, just sent**.
 *
 * ⚠️ **That value reached nothing for a while.** The only reader of `unanswered` is this ladder,
 * and its first line was `if (!error) return null`, so every unanswered turn without a failure
 * folded away. To the user, generation ran and then vanished without a word. That is the shape of
 * the "stops mid-output" reports this repository received.
 */
export const emptyAnswerMessage = (): string =>
	translator("conversation")("failure.emptyAnswer");

export function generationRecovery(input: {
	error: Error | null;
	/** Whether a turn without an answer remains — the only condition under which `Regenerate` has meaning. */
	unanswered: boolean;
	/**
	 * Whether the tail of the last response is open. The judgment comes from the shared rule
	 * (`continuationTarget`).
	 *
	 * It receives the fact only, not the target itself. Passing a message would make this table aware
	 * of the conversation's shape, and then "what to continue" becomes this table's question.
	 */
	continuable: boolean;
	/**
	 * Did the **user end this turn themselves** (stop)?
	 *
	 * Used only in the empty-answer branch below. Stopping is not an error (this repository's rule),
	 * and "not saved" on something the user stopped themselves reads as a malfunction report. Not
	 * checked when a failure accompanies it: then what ended the turn was that failure, not the stop.
	 */
	stopped: boolean;
}): GenerationRecovery | null {
	const { error } = input;
	/**
	 * **No failure but no answer** — a response with no body (`emptyAnswerMessage` above). This is a
	 * neutral notice, not a red surface, and the only action is retry.
	 */
	if (!error)
		return input.unanswered && !input.stopped
			? {
					message: emptyAnswerMessage(),
					tone: "notice",
					action: { kind: "retry", label: retryLabel() },
				}
			: null;
	const message = generationFailureMessage(error);

	/** A failure resolved on the settings screen comes first — nothing here clears by pressing again. */
	if (needsProviderSetup(error))
		return {
			message,
			tone: "failure",
			action: { kind: "providers", label: providerSettingsLabel() },
		};

	/**
	 * **Continuing from the cut-off point is this failure's recovery — before `Regenerate`.**
	 *
	 * They do different things: continue appends after the text already read, while retry erases that
	 * text and receives it fresh. In practice they never both apply (once a single character is saved,
	 * the turn has an answer). The order is written here anyway because that fact lives outside this
	 * file.
	 */
	if (input.continuable && canRetryGeneration(error))
		return {
			message,
			tone: "failure",
			action: { kind: "continue", label: continueLabel() },
		};

	return {
		message,
		tone: "failure",
		action:
			input.unanswered && canRetryGeneration(error)
				? { kind: "retry", label: retryLabel() }
				: null,
	};
}
