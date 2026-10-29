import { describe, expect, it } from "vitest";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import {
	PREVIEW_GENERATION_FAILURE,
	previewGenerationFailure,
	toPreviewGenerationFailure,
} from "./runtime-preview-generation-failure.ts";

/**
 * Exceptions from the trusted stack must not cross to the worker. Before this boundary, an unknown
 * exception became a failed result carrying error.message. The worker turned it into a named
 * RuntimeGenerationError. The host's general sanitizer folds only exceptions that carry no reason,
 * so the sentence passed through to QuickJS's RuntimeError.message. That is a window through which
 * creator code could read our infrastructure's errors.
 */

const SENSITIVE = [
	"401",
	"api.example.internal",
	"sk-live-secret",
	"Authorization",
	"Bearer",
	"anthropic",
	"internal-model",
	"/srv/",
	"provider.ts",
	"https://",
] as const;

const HOSTILE_MESSAGE = [
	"401 from https://api.example.internal/v1/messages",
	"Authorization: Bearer sk-live-secret",
	"provider=anthropic model=internal-model",
	"at /srv/rowcat/provider.ts:42",
].join("\n");

const assertClean = (result: unknown): void => {
	const serialized = JSON.stringify(result);
	for (const secret of SENSITIVE) expect(serialized).not.toContain(secret);
};

describe("unknown infrastructure failure", () => {
	it("the reason is failed and the sentence is RowCat's", () => {
		const result = toPreviewGenerationFailure(new Error(HOSTILE_MESSAGE));
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: PREVIEW_GENERATION_FAILURE.failed,
		});
		assertClean(result);
	});

	/** Checks the sentence, not only the reason. The defect lived in the sentence itself. */
	it("no fragment of the original sentence survives in the result", () => {
		const result = toPreviewGenerationFailure(new Error(HOSTILE_MESSAGE));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		for (const secret of SENSITIVE)
			expect(result.message).not.toContain(secret);
		expect(result.message).toBe("No AI response was received.");
	});

	/**
	 * The same guarantee holds when the thrown value is not an Error. Provider SDKs also throw plain
	 * objects and strings.
	 */
	it.each([
		["string", HOSTILE_MESSAGE],
		[
			"plain object",
			{ message: HOSTILE_MESSAGE, url: "https://api.example.internal" },
		],
		["response-like object", { status: 401, body: HOSTILE_MESSAGE }],
		["null", null],
		["undefined", undefined],
	])("%s also becomes a safe failed", (_label, thrown) => {
		const result = toPreviewGenerationFailure(thrown);
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: PREVIEW_GENERATION_FAILURE.failed,
		});
		assertClean(result);
	});

	/**
	 * An error with a code is `failed` unless the code is one we know. Inventing a name for an unknown
	 * reason would become a wrong instruction someday; the host makes the same judgement in the same
	 * place.
	 */
	it("an unknown code gets no reason", () => {
		const result = toPreviewGenerationFailure(
			Object.assign(new Error(HOSTILE_MESSAGE), { code: "provider_teapot" }),
		);
		expect(result).toMatchObject({ reason: "failed" });
		assertClean(result);
	});
});

describe("reasons disclosed on purpose", () => {
	/**
	 * A blocked generation has a named reason, but its sentence is still static.
	 * `GenerationBlockedError.message` is our wording but names the provider. That is harmless in the
	 * studio, yet if the same contract later runs on a player's device, the word would reveal another
	 * device's setup to creator code. Concrete guidance belongs to the trusted settings screen.
	 */
	it("generation blocked for lack of a connection is not-authorized and carries no provider name", () => {
		const blocked = new GenerationBlockedError({
			status: "blocked",
			reason: "provider_not_connected",
			target: { provider: "anthropic-byo", model: "claude-sonnet-5" },
		});
		/** The original message names the provider. That fact is the premise of this check. */
		expect(blocked.message).toContain("Anthropic");

		const result = toPreviewGenerationFailure(blocked);
		expect(result).toEqual({
			ok: false,
			reason: "not-authorized",
			message: PREVIEW_GENERATION_FAILURE["not-authorized"],
		});
		if (result.ok) return;
		for (const name of ["Anthropic", "Gemini", "OpenAI", "Provided by RowCat"])
			expect(result.message).not.toContain(name);
	});

	it("the child restriction folds into the same single reason", () => {
		const blocked = new GenerationBlockedError({
			status: "blocked",
			reason: "byo_not_permitted",
			target: { provider: "gemini-byo", model: "gemini-3-pro" },
		});
		expect(toPreviewGenerationFailure(blocked)).toEqual({
			ok: false,
			reason: "not-authorized",
			message: PREVIEW_GENERATION_FAILURE["not-authorized"],
		});
	});

	/**
	 * Old server code may still send the insufficient-balance code after billing was removed. It must
	 * fold into a nameless failure, so a newly invented reason never reaches creator code.
	 */
	it("the old insufficient-balance code folds into an unnamed failure", () => {
		const result = toPreviewGenerationFailure(
			Object.assign(new Error(HOSTILE_MESSAGE), { code: "insufficient_churu" }),
		);
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: PREVIEW_GENERATION_FAILURE.failed,
		});
		assertClean(result);
	});

	/**
	 * Outside the managed allowlist maps to not-authorized, the same reason as having no connection.
	 * The remedy is the same: connect your own key in settings.
	 */
	it("outside the managed allowlist is not-authorized and carries no original text", () => {
		const result = toPreviewGenerationFailure(
			Object.assign(new Error(HOSTILE_MESSAGE), {
				code: "chat_managed_not_allowed",
			}),
		);
		expect(result).toEqual({
			ok: false,
			reason: "not-authorized",
			message: PREVIEW_GENERATION_FAILURE["not-authorized"],
		});
		assertClean(result);
	});

	it("an abort is a cancellation", () => {
		const aborted = new Error("The operation was aborted.");
		aborted.name = "AbortError";
		expect(toPreviewGenerationFailure(aborted)).toEqual({
			ok: false,
			reason: "cancelled",
			message: PREVIEW_GENERATION_FAILURE.cancelled,
		});
	});
});

describe("vocabulary", () => {
	/** All five reasons carry a sentence, and none has a slot where a value could be inserted. */
	it.each([
		"unavailable",
		"not-authorized",
		"insufficient-balance",
		"cancelled",
		"failed",
	] as const)("the sentence for %s is static", (reason) => {
		const message = PREVIEW_GENERATION_FAILURE[reason];
		expect(message.length).toBeGreaterThan(0);
		expect(previewGenerationFailure(reason)).toEqual({
			ok: false,
			reason,
			message,
		});
		/** The sentences themselves contain no address-, path-, status-code- or secret-like fragments. */
		for (const shape of [
			/https?:\/\//,
			/\/[a-z]+\//,
			/\bsk-/,
			/\b\d{3}\b/,
			/Bearer/i,
		])
			expect(message).not.toMatch(shape);
	});
});
