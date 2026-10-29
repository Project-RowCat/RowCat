import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import { ProviderError } from "#/lib/generation/errors.ts";
import {
	ChatPersistenceError,
	ChatStreamFailure,
	canRetryGeneration,
	continueLabel,
	emptyAnswerMessage,
	failureCode,
	generationFailureMessage,
	generationRecovery,
	needsProviderSetup,
	providerSettingsLabel,
	retryLabel,
} from "./generation-error.ts";

/**
 * The wording and next action for a generation failure, as shared by the conversation screen and
 * the work test.
 *
 * By design, half of the assertions check that a string does NOT appear. This table can loosen in
 * only one direction: passing through a sentence the server or provider wrote.
 */

const blocked = (
	reason: "provider_not_connected" | "model_unavailable" | "byo_not_permitted",
) =>
	new GenerationBlockedError({
		status: "blocked",
		reason,
		target: { provider: "anthropic-byo", model: "claude-sonnet-5" },
	});

const apiError = (code: string, message: string, status = 409) =>
	new RowCatApiError({ status, code, message });

describe("generationFailureMessage", () => {
	it("uses the sentence of a bounded error as is", () => {
		expect(generationFailureMessage(new ProviderError("rate_limited"))).toBe(
			new ProviderError("rate_limited").message,
		);
		expect(
			generationFailureMessage(blocked("provider_not_connected")),
		).toContain("isn't connected");
	});

	it.each([
		[
			"any other API error",
			apiError("chat_provider_failed", "upstream 500: sk-secret-123"),
		],
		["a plain exception", new Error("Dexie: QuotaExceededError")],
		["no error", null],
	])("%s folds to the generic sentence", (_label, error) => {
		expect(generationFailureMessage(error)).toBe("No response was received.");
	});

	it("the folded failure's original text does not remain", () => {
		const message = generationFailureMessage(
			apiError(
				"chat_provider_failed",
				"upstream 500: api.example.com key=sk-1",
			),
		);
		expect(message).not.toContain("sk-1");
		expect(message).not.toContain("api.example.com");
	});
});

describe("needsProviderSetup", () => {
	it("true only when unconnected or the key was rejected", () => {
		expect(needsProviderSetup(blocked("provider_not_connected"))).toBe(true);
		expect(needsProviderSetup(new ProviderError("invalid_credential"))).toBe(
			true,
		);
	});

	it.each([
		["rate limit", new ProviderError("rate_limited")],
		["credit", new ProviderError("quota_exceeded")],
		["child restriction", blocked("byo_not_permitted")],
		["none", null],
	])("%s is false", (_label, error) => {
		expect(needsProviderSetup(error)).toBe(false);
	});
});

/**
 * Whether a verdict is correct and whether it is actually wired into the screens are different
 * questions. This block covers the second. The web tests here do not render screens, so it inspects
 * code shape instead.
 *
 * The premise is that three screens share one table. That premise breaks silently once one screen
 * starts stacking its own branches again, which has happened before.
 */
describe("screens do not rewrite the failure ladder", () => {
	const HERE = fileURLToPath(new URL(".", import.meta.url));
	const screenOf = (path: string): string =>
		readFileSync(join(HERE, "..", path), "utf8")
			.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
			.replaceAll(/(^|[^:])\/\/.*$/gm, "$1")
			.replaceAll(/\s+/g, " ");

	/**
	 * Note: this assertion was reversed. For a while it checked that each of the two screens held its
	 * own failure verdict and payment-page link. That was right at the time, because the ladder lived
	 * in each screen. The copies did diverge: when a fourth branch (`Continue generating`) was
	 * added, only one screen got it, and this check still passed.
	 *
	 * It now guards the opposite: screens must have no ladder. Order is held by a pure function
	 * (generationRecovery), and the elements are drawn by a shared component. The only way for a
	 * screen to bypass both is to write its own branch again.
	 */
	it.each([
		"chat/chat-page.tsx",
		"playtest/playtest-page.tsx",
		"chat/suggestion/panel.tsx",
	])("%s has no failure ladder of its own", (path) => {
		const code = screenOf(path);
		expect(code).toContain("generationRecovery(");
		expect(code).toContain("GenerationRecoveryActionButton");
		for (const forbidden of [
			"isInsufficientChuru(",
			"needsProviderSetup(",
			'to="/billing"',
			'to="/settings/ai"',
		])
			expect(code).not.toContain(forbidden);
	});

	/**
	 * Does not swap the model for the user. The chosen target must remain even when the request fails,
	 * and retries must use the same model. Silently falling back to another model would make a
	 * response with different character and cost look like it came from the chosen model.
	 */
	it.each([
		"chat/chat-page.tsx",
		"playtest/playtest-page.tsx",
	])("%s does not change the target on failure", (path) => {
		const code = screenOf(path);
		for (const forbidden of ["setGlobal", "setRoom", "DEFAULT_MANAGED_MODEL"])
			expect(code).not.toContain(forbidden);
	});
});

/**
 * One recovery action per failure. The order in this table is the whole of it.
 *
 * It is measured here, not on the screens, because copies diverge when one screen gets one more
 * branch. Locking the order as a value means a change reaches all three screens at once.
 */
describe("generationRecovery", () => {
	it("failures fixed in settings come first", () => {
		expect(
			generationRecovery({
				error: blocked("provider_not_connected"),
				unanswered: true,
				stopped: false,
				continuable: true,
			}),
		).toEqual({
			message: expect.stringContaining("isn't connected"),
			tone: "failure",
			action: { kind: "providers", label: providerSettingsLabel() },
		});
	});

	/**
	 * Note: until this line existed, a turn cut off mid-output had nothing to press. The neutral
	 * notice was folded into failures, and `Regenerate` appears only on turns with no answer.
	 * A turn with a saved partial response counts as answered.
	 */
	it("a response with an open tail gets the continue action", () => {
		expect(
			generationRecovery({
				error: new Error("cut off"),
				unanswered: false,
				stopped: false,
				continuable: true,
			})?.action,
		).toEqual({ kind: "continue", label: continueLabel() });
	});

	it("with nothing to continue, an unanswered turn gets regenerate", () => {
		expect(
			generationRecovery({
				error: new Error("failure"),
				unanswered: true,
				stopped: false,
				continuable: false,
			})?.action,
		).toEqual({ kind: "retry", label: retryLabel() });
	});

	/** A failure that does not clear when pressed again gets no action at all. */
	it("a failure with an exhausted limit gets no action", () => {
		expect(
			generationRecovery({
				error: new ProviderError("quota_exceeded"),
				unanswered: true,
				stopped: false,
				continuable: true,
			})?.action,
		).toBeNull();
	});

	/**
	 * Note: say so when there is no answer even without a failure. That missing line is what the
	 * 'stopped mid-output' symptom was.
	 *
	 * A normal end was received but the body is empty, so the save rule discards that response and
	 * leaves the turn unanswered (resolveGenerationOutcome). The only reader of that value is this
	 * ladder, but its first line was `if (!error) return null`. The user saw generation run and then
	 * vanish without a word, with nothing to press or read.
	 */
	it("a turn that ended without a body gets a neutral notice and regenerate", () => {
		expect(
			generationRecovery({
				error: null,
				unanswered: true,
				stopped: false,
				continuable: false,
			}),
		).toEqual({
			message: emptyAnswerMessage(),
			tone: "notice",
			action: { kind: "retry", label: retryLabel() },
		});
	});

	/**
	 * Stopping is not an error. If a stop the user chose produced a 'not saved' message, it would read
	 * as a bug report (docs/design/FAILURE-FEEDBACK.md).
	 */
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

	it("an answered turn has neither failure nor notice", () => {
		expect(
			generationRecovery({
				error: null,
				unanswered: false,
				stopped: false,
				continuable: true,
			}),
		).toBeNull();
	});

	/**
	 * Every failure branch uses the failure tone. The only neutral case is the empty-reply one above.
	 */
	it("a failure always carries the failure tone", () => {
		for (const error of [
			blocked("provider_not_connected"),
			apiError("chat_rate_limited", "too often", 429),
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

/**
 * Whether retrying a failure is worth offering. Until this predicate existed, every failure got
 * `Regenerate`. That button resends the same request, and each press sends one more request to
 * the provider.
 */
describe("canRetryGeneration", () => {
	it("offered for failures that clear by waiting", () => {
		expect(canRetryGeneration(new ProviderError("rate_limited"))).toBe(true);
		expect(canRetryGeneration(new ProviderError("network"))).toBe(true);
	});

	it("key, quota and model are not fixed by pressing again", () => {
		expect(canRetryGeneration(new ProviderError("invalid_credential"))).toBe(
			false,
		);
		expect(canRetryGeneration(new ProviderError("quota_exceeded"))).toBe(false);
		expect(canRetryGeneration(new ProviderError("model_unavailable"))).toBe(
			false,
		);
	});

	/**
	 * Rate limits and daily caps on managed generation clear with time. Once the billing layer is
	 * gone, the cap is what protects the operator key. So the user gets a specific sentence and a
	 * retry.
	 */
	it("managed rate limiting has its own sentence and offers retry", () => {
		const error = apiError("chat_rate_limited", "member=abc 400/day", 429);
		expect(generationFailureMessage(error)).toBe(
			"Too many generation requests. Please try again in a moment.",
		);
		expect(generationFailureMessage(error)).not.toContain("member=abc");
		expect(canRetryGeneration(error)).toBe(true);
	});

	/**
	 * A failure that blocks before the request starts gives the same answer under the same conditions
	 * every time. Child restriction is that branch.
	 */
	it("not offered for failures blocked before starting", () => {
		expect(canRetryGeneration(blocked("byo_not_permitted"))).toBe(false);
	});
});

/**
 * The failure that arrives after the stream has started. This group guards one thing: the frame's
 * code must reach the screen intact.
 *
 * Note: for a while this app lost that code (`new Error(event.message)`). Managed routing failures
 * folded into 'could not get a response', and `Regenerate` appeared on failures that retrying cannot
 * fix. The mobile app uses the same class name at the same point.
 */
describe("ChatStreamFailure", () => {
	const streamFailure = (code: string, message = "a server-built sentence") =>
		new ChatStreamFailure(code, message);

	it("does not lose the code — read in the same place from an envelope or a frame", () => {
		expect(failureCode(streamFailure("chat_managed_model_unavailable"))).toBe(
			"chat_managed_model_unavailable",
		);
		expect(failureCode(apiError("chat_rate_limited", "too often", 429))).toBe(
			"chat_rate_limited",
		);
		expect(failureCode(new Error("unnamed failure"))).toBeNull();
	});

	it.each([
		"chat_provider_unconfigured",
		"chat_managed_model_unavailable",
	])("%s has its own sentence and does not offer retry", (code) => {
		expect(generationFailureMessage(streamFailure(code))).toBe(
			"This model can't generate conversations right now.",
		);
		expect(canRetryGeneration(streamFailure(code))).toBe(false);
		expect(
			generationRecovery({
				error: streamFailure(code),
				unanswered: true,
				stopped: false,
				continuable: true,
			})?.action,
		).toBeNull();
	});

	/**
	 * Sentences are chosen by code only, so a server-written value never reaches the screen through
	 * any branch.
	 */
	it("no code passes the server-built sentence through as is", () => {
		const raw = "upstream 500: key=sk-live-1";
		for (const code of [
			"chat_rate_limited",
			"chat_managed_model_unavailable",
			"chat_provider_failed",
		])
			expect(generationFailureMessage(streamFailure(code, raw))).not.toContain(
				"sk-live-1",
			);
	});
});

/**
 * Outside the managed generation allowlist (`chat_managed_not_allowed`, 403).
 *
 * What this person can do is neither wait nor press again. It is to connect their own key. So the
 * destination is the same AI settings as for a rejected key, and `Regenerate` does not appear. The
 * request was blocked before it went upstream, but pressing again would return the same 403 every
 * time.
 */
describe("chat_managed_not_allowed", () => {
	const cases = [
		["envelope", apiError("chat_managed_not_allowed", "server sentence", 403)],
		[
			"frame",
			new ChatStreamFailure("chat_managed_not_allowed", "server sentence"),
		],
	] as const;

	it.each(
		cases,
	)("sends to AI settings even when it arrives as an %s", (_, error) => {
		expect(needsProviderSetup(error)).toBe(true);
		expect(canRetryGeneration(error)).toBe(false);
		expect(generationFailureMessage(error)).toContain("AI settings");
		expect(generationFailureMessage(error)).not.toContain("server sentence");
		expect(
			generationRecovery({
				error,
				unanswered: true,
				continuable: true,
				stopped: false,
			})?.action,
		).toEqual({ kind: "providers", label: providerSettingsLabel() });
	});
});

/**
 * The local save failed. This is a different fact from a network failure: the response did arrive
 * and was read on screen, and on the next open it is gone.
 */
describe("ChatPersistenceError", () => {
	it("does not say nothing was received", () => {
		const message = generationFailureMessage(new ChatPersistenceError());
		expect(message).toContain("this device");
		expect(message).not.toBe("No response was received.");
	});

	/** The thrown value is kept only as the cause. Dexie's sentence must not reach the screen. */
	it("the cause's text does not mix into the screen copy", () => {
		const message = generationFailureMessage(
			new ChatPersistenceError({ cause: new Error("QuotaExceededError: db") }),
		);
		expect(message).not.toContain("QuotaExceededError");
	});

	it("can be cleared by pressing again", () => {
		expect(canRetryGeneration(new ChatPersistenceError())).toBe(true);
	});
});

/**
 * Note: when the BYO adapter emits a provider failure mid-stream, it arrives as a frame and becomes
 * `ChatStreamFailure(code)` in the generation hook. While this table did not read it the same way
 * as `ProviderError`, content blocking folded into `No response was received.` with
 * `Regenerate`.
 */
describe("provider failures arriving as frames", () => {
	const frame = (code: string) =>
		new ChatStreamFailure(code, "upstream said: SAFETY blocked prompt");

	it("content blocking has its sentence and shows no regenerate", () => {
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

	it("rate limiting has its sentence and shows regenerate", () => {
		const failure = frame("rate_limited");
		expect(generationFailureMessage(failure)).toBe(
			new ProviderError("rate_limited").message,
		);
		expect(canRetryGeneration(failure)).toBe(true);
	});

	it("key rejection sends to settings", () => {
		expect(needsProviderSetup(frame("invalid_credential"))).toBe(true);
	});

	it("the frame's original text reaches the screen on no branch", () => {
		for (const code of ["content_blocked", "rate_limited", "unknown_thing"])
			expect(generationFailureMessage(frame(code))).not.toContain("upstream");
	});
});
