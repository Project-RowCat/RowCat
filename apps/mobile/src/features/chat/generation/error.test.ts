import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../../../lib/generation/errors.ts";
import {
	ChatGenerationBlockedError,
	ChatPersistenceError,
	ChatStreamFailure,
	CONTINUE_LABEL,
	canRetryGeneration,
	EMPTY_ANSWER_MESSAGE,
	generationFailureMessage,
	generationRecovery,
	MANAGED_NOT_ALLOWED_MESSAGE,
	MANAGED_UNAVAILABLE_MESSAGE,
	OPAQUE_FAILURE_MESSAGE,
	PROVIDER_SETTINGS_LABEL,
	RATE_LIMITED_MESSAGE,
	RETRY_LABEL,
} from "./error.ts";

/** Failure to screen sentence; this table is defined by what it does not say.

Most important is the last group: the raw text of an unbounded failure never reaches the screen. The regression is one line drawing `error.message`, and the screen works fine until the rare moment a vendor response body or a proxy HTML error leaks, which is not reproducible. */

const apiError = (code: string, message = "a sentence the server made") =>
	new RowCatApiError({ status: 400, code, message });

describe("a deployment that can't use managed", () => {
	/** Both codes share a sentence because the user can do the same thing (nothing); the branch lives in server logs. */
	it.each([
		"chat_provider_unconfigured",
		"chat_managed_model_unavailable",
	])("%s folds into the same notice", (code) => {
		expect(generationFailureMessage(apiError(code))).toBe(
			MANAGED_UNAVAILABLE_MESSAGE,
		);
		expect(canRetryGeneration(apiError(code))).toBe(false);
	});

	/** Must not say "try again shortly": the answer is the same until configuration changes. */
	it("the copy doesn't recommend retrying", () => {
		expect(MANAGED_UNAVAILABLE_MESSAGE).not.toMatch(/in a moment|try again/i);
	});
});

/** Managed generation rate limit and daily cap: with billing gone these limits protect the operator key. Waiting clears them, so they get their own sentence and retry (same judgement as the web table). */
describe("managed rate limit", () => {
	const limited = new RowCatApiError({
		status: 429,
		code: "chat_rate_limited",
		message: "member=abc 400/day",
	});

	it("has its own sentence and doesn't copy the server's raw text", () => {
		expect(generationFailureMessage(limited)).toBe(RATE_LIMITED_MESSAGE);
		expect(generationFailureMessage(limited)).not.toContain("member=abc");
	});

	it("doesn't block retrying", () => {
		expect(canRetryGeneration(limited)).toBe(true);
	});
});

/** Outside the managed-generation allowlist (`chat_managed_not_allowed`, 403).

The person can neither wait nor press again; they can connect their own key. So the destination is AI settings like a rejected key, and neither `Regenerate` nor `Continue generating` stands (the same 403 would return). Same judgement as the web group. */
describe("outside the managed allowlist", () => {
	const cases = [
		[
			"envelope",
			new RowCatApiError({
				status: 403,
				code: "chat_managed_not_allowed",
				message: "server sentence",
			}),
		],
		[
			"frame",
			new ChatStreamFailure("chat_managed_not_allowed", "server sentence"),
		],
	] as const;

	it.each(cases)("even arriving as %s it sends to AI settings", (_, error) => {
		expect(canRetryGeneration(error)).toBe(false);
		expect(generationFailureMessage(error)).toBe(MANAGED_NOT_ALLOWED_MESSAGE);
		expect(generationFailureMessage(error)).not.toContain("server sentence");
		expect(
			generationRecovery({
				error,
				unanswered: true,
				continuable: true,
				stopped: false,
			})?.action,
		).toEqual({ kind: "providers", label: PROVIDER_SETTINGS_LABEL });
	});
});

describe("blocked before starting", () => {
	const blocked = (
		reason:
			| "byo_not_permitted"
			| "provider_not_connected"
			| "model_unavailable",
	) =>
		new ChatGenerationBlockedError({
			status: "blocked",
			target: { provider: "anthropic-byo", model: "claude" },
			reason,
		});

	it("uses its own sentence as is", () => {
		expect(generationFailureMessage(blocked("model_unavailable"))).toBe(
			blocked("model_unavailable").message,
		);
	});

	/** The sentence states the fact; the control draws the way.

This check used to be "do not send to a connection screen that does not exist"; that premise is gone (`/settings/ai`). What it prevents now is giving the same guidance twice: `generationRecovery` draws `Open AI settings` for this failure, so naming that path in the sentence too gives two guides for one failure (`docs/design/FAILURE-FEEDBACK.md`).

Compare by the vocabulary of the action, not by words: the earlier `/connect in settings|please connect/` now misses both forms by accident and would pass while guarding nothing. */
	it("the sentence doesn't spell out the path — the operation owns that path", () => {
		const message = blocked("provider_not_connected").message;
		expect(message).not.toContain(PROVIDER_SETTINGS_LABEL);
		expect(message).not.toMatch(/Settings\s*(→|->)\s*AI/);
	});

	/** The action must actually exist for the check above to mean anything; otherwise it is a dead end. */
	it("a failure with no connection gets an operation going to AI settings", () => {
		const recovery = generationRecovery({
			error: blocked("provider_not_connected"),
			unanswered: true,
			stopped: false,
			continuable: false,
		});
		expect(recovery?.action).toEqual({
			kind: "providers",
			label: PROVIDER_SETTINGS_LABEL,
		});
	});

	/** No such action stands for the child restriction: the person can do nothing there, and pointing at a path that does not exist is worse than no path. */
	it("that operation doesn't stand for under-14s", () => {
		const recovery = generationRecovery({
			error: blocked("byo_not_permitted"),
			unanswered: true,
			stopped: false,
			continuable: false,
		});
		expect(recovery?.action).toBeNull();
	});

	/** Telling a child "connect a key" makes that guidance a dead end. */
	it("under-14s are told age is the reason", () => {
		expect(blocked("byo_not_permitted").message).toContain("under 14");
	});

	it("the same conditions give the same answer, so retrying isn't recommended", () => {
		expect(canRetryGeneration(blocked("provider_not_connected"))).toBe(false);
	});
});

describe("local save failure", () => {
	/** Said separately from network failure: the response did arrive and was read on screen but is gone on reopen, and folding that into "response not received" leaves the user unable to tell what happened. */
	it("says it's a device problem", () => {
		const message = generationFailureMessage(new ChatPersistenceError());
		expect(message).toContain("device");
		expect(message).not.toBe(OPAQUE_FAILURE_MESSAGE);
	});
});

describe("a failure without a boundary folds", () => {
	/** This group is why the file exists: no path may send a server, provider or proxy sentence to the screen verbatim. */
	it.each([
		new Error("upstream 502: <html>Bad Gateway</html>"),
		new TypeError("Network request failed"),
		apiError("chat_provider_failed", 'Provider response: {"error":"..."}'),
		apiError("http_error", "The request failed (HTTP 500)."),
		new ChatStreamFailure("chat_provider_failed", "provider said: rate limit"),
	])("the raw text doesn't reach the screen", (error) => {
		expect(generationFailureMessage(error)).toBe(OPAQUE_FAILURE_MESSAGE);
	});

	it("there is a sentence even without an error", () => {
		expect(generationFailureMessage(null)).toBe(OPAQUE_FAILURE_MESSAGE);
	});

	/** An unnamed failure is worth retrying (mostly network). */
	it("an unnamed failure offers retry", () => {
		expect(canRetryGeneration(new TypeError("Network request failed"))).toBe(
			true,
		);
	});
});

/** Recovery over a cut-off response: fixes the failure with nothing to press.

When a stream is cut mid-output the received part is saved and the turn counts as answered, so `Regenerate` does not stand (`unanswered` is false) and the neutral notice folds into the failure; for a while only the failure sentence remained. */
describe("Continue generating", () => {
	it("a reply with an open tail gets a continue operation", () => {
		expect(
			generationRecovery({
				error: new Error("cut off"),
				unanswered: false,
				stopped: false,
				continuable: true,
			})?.action,
		).toEqual({ kind: "continue", label: CONTINUE_LABEL });
	});

	/** Continuing is the same request: after a rejected key or exhausted limit it returns the same answer, and the button would only promise an unknown number of presses. */
	it("doesn't stand on a failure that pressing again can't fix", () => {
		expect(
			generationRecovery({
				error: apiError("chat_managed_model_unavailable"),
				unanswered: false,
				stopped: false,
				continuable: true,
			})?.action,
		).toBeNull();
	});

	/** The connection question is answered first; continuing does not change that failure. */
	it("no connection comes first", () => {
		expect(
			generationRecovery({
				error: new ChatGenerationBlockedError({
					status: "blocked",
					target: { provider: "anthropic-byo", model: "claude" },
					reason: "provider_not_connected",
				}),
				unanswered: false,
				stopped: false,
				continuable: true,
			})?.action?.kind,
		).toBe("providers");
	});

	/** Without anything to continue it is as before: `Regenerate` stands for an unanswered turn. */
	it("with nothing to continue, regenerate stands as is", () => {
		expect(
			generationRecovery({
				error: new Error("failure"),
				unanswered: true,
				stopped: false,
				continuable: false,
			})?.action?.kind,
		).toBe("retry");
	});

	/** A turn with no failure but no answer still speaks; that missing line was the "stops mid-output" report.

A normal end with an empty body makes the save rule discard the response and leave the turn unanswered (`resolveGenerationOutcome`). This ladder is the only reader of that value and its first line was `if (!error) return null`, so nothing stood on screen. */
	it("a turn that ended with no body gets a neutral notice and regenerate", () => {
		expect(
			generationRecovery({
				error: null,
				unanswered: true,
				stopped: false,
				continuable: false,
			}),
		).toEqual({
			message: EMPTY_ANSWER_MESSAGE,
			tone: "notice",
			action: { kind: "retry", label: RETRY_LABEL },
		});
	});

	/** A stop is not an error: no failure copy on something the user cut. */
	it("an empty turn the user stopped gets nothing", () => {
		expect(
			generationRecovery({
				error: null,
				unanswered: true,
				stopped: true,
				continuable: false,
			}),
		).toBeNull();
	});

	it("a turn that got an answer has neither failure nor notice", () => {
		expect(
			generationRecovery({
				error: null,
				unanswered: false,
				stopped: false,
				continuable: true,
			}),
		).toBeNull();
	});

	/** Every failure branch is a red surface; neutral is only the empty-response case above. */
	it("a failure always carries the failure tone", () => {
		for (const error of [
			apiError("chat_rate_limited"),
			new ChatStreamFailure("chat_provider_failed", "x"),
			new Error("unknown"),
		])
			expect(
				generationRecovery({
					error,
					unanswered: true,
					stopped: false,
					continuable: true,
				})?.tone,
				String(error),
			).toBe("failure");
	});
});

/** A BYO provider failure emitted mid-stream arrives as a frame and becomes `ChatStreamFailure(code)` in the generation turn. While this table did not read it like a `ProviderError`, content blocking folded into `No response was received.` plus `Regenerate`. */
describe("provider failures arriving as frames", () => {
	const frame = (code: string) =>
		new ChatStreamFailure(code, "upstream said: SAFETY blocked prompt");

	it("a content block has its sentence and doesn't offer regenerate", () => {
		const failure = frame("content_blocked");
		expect(generationFailureMessage(failure)).toBe(
			new ProviderError("content_blocked").message,
		);
		expect(canRetryGeneration(failure)).toBe(false);
		expect(
			generationRecovery({
				error: failure,
				unanswered: true,
				continuable: false,
				stopped: false,
			})?.action,
		).toBeNull();
	});

	it("a quota has its sentence and offers regenerate", () => {
		const failure = frame("rate_limited");
		expect(generationFailureMessage(failure)).toBe(
			new ProviderError("rate_limited").message,
		);
		expect(canRetryGeneration(failure)).toBe(true);
	});

	it("a key refusal sends to settings", () => {
		expect(
			generationRecovery({
				error: frame("invalid_credential"),
				unanswered: true,
				continuable: false,
				stopped: false,
			})?.action?.kind,
		).toBe("providers");
	});

	it("the frame's raw text reaches the screen on no branch", () => {
		for (const code of ["content_blocked", "rate_limited", "unknown_thing"])
			expect(generationFailureMessage(frame(code))).not.toContain("upstream");
	});
});
