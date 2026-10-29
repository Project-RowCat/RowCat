import type { GenerationTarget } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	BYO_PROVIDERS,
	GenerationBlockedError,
	PROVIDER_KEY_PAGE,
	providerLabel,
} from "./availability.ts";
import { ProviderError, providerErrorForStatus } from "./errors.ts";

/**
 * Where a failure is turned into the user's words. The function is pure, so tests run without
 * rendering.
 *
 * Three things are pinned:
 * - Failures with different next actions get different sentences. One shared sentence would leave
 *   one of them as a dead end.
 * - No sentence suggests a substitute provider, such as `Send it through RowCat instead?`. That would break the
 *   BYO definition, since the key and prompt would pass through our server.
 * - No sentence includes the vendor response body, which mixes account ids with our prompt.
 */

const ANTHROPIC: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};

/**
 * No message may suggest a substitute provider. The phrases in this list must never appear in a
 * blocked-state message.
 */
const SUBSTITUTION_HINTS = [
	"through RowCat",
	"instead",
	"switch automatically",
];

describe("the blocking reason splits the sentence", () => {
	it("says so when not connected", () => {
		const error = new GenerationBlockedError({
			status: "blocked",
			target: ANTHROPIC,
			reason: "provider_not_connected",
		});

		expect(error.message).toContain("connected");
		expect(error.message).toContain("Anthropic");
		/** needsConnection is the only basis for showing the `AI provider settings` link. */
		expect(error.needsConnection).toBe(true);
		expect(error.provider).toBe("anthropic-byo");
	});

	it("does not talk about connecting when the model is gone", () => {
		const error = new GenerationBlockedError({
			status: "blocked",
			target: ANTHROPIC,
			reason: "model_unavailable",
		});

		expect(error.needsConnection).toBe(false);
		expect(error.message).toContain("model");
	});

	it("the two reasons' sentences differ", () => {
		const of = (reason: "provider_not_connected" | "model_unavailable") =>
			new GenerationBlockedError({
				status: "blocked",
				target: ANTHROPIC,
				reason,
			}).message;

		expect(of("provider_not_connected")).not.toBe(of("model_unavailable"));
	});

	it("no sentence suggests another provider", () => {
		for (const reason of [
			"provider_not_connected",
			"model_unavailable",
		] as const) {
			const { message } = new GenerationBlockedError({
				status: "blocked",
				target: ANTHROPIC,
				reason,
			});
			for (const hint of SUBSTITUTION_HINTS)
				expect(message).not.toContain(hint);
		}
	});
});

describe("provider failure vocabulary", () => {
	it("the next action differs per status code", () => {
		expect(providerErrorForStatus(401).code).toBe("invalid_credential");
		expect(providerErrorForStatus(403).code).toBe("invalid_credential");
		expect(providerErrorForStatus(402).code).toBe("quota_exceeded");
		expect(providerErrorForStatus(404).code).toBe("model_unavailable");
		expect(providerErrorForStatus(429).code).toBe("rate_limited");
		expect(providerErrorForStatus(500).code).toBe("provider_error");
	});

	it("rate limit and credit are not folded — the latter does not clear by waiting", () => {
		expect(providerErrorForStatus(429).code).not.toBe(
			providerErrorForStatus(402).code,
		);
	});

	it("retry delay is carried only when the provider stated it", () => {
		expect(providerErrorForStatus(429, 30).retryAfterSeconds).toBe(30);
		expect(providerErrorForStatus(429).retryAfterSeconds).toBeUndefined();
	});

	it("every message is non-empty and suggests no substitute", () => {
		for (const code of [
			"invalid_credential",
			"rate_limited",
			"quota_exceeded",
			"model_unavailable",
			"network",
			"browser_blocked",
			"provider_error",
		] as const) {
			const { message } = new ProviderError(code);
			expect(message.length).toBeGreaterThan(0);
			for (const hint of SUBSTITUTION_HINTS)
				expect(message).not.toContain(hint);
		}
	});
});

describe("provider names", () => {
	it("internal enum values do not leak into screen vocabulary", () => {
		for (const provider of ["rowcat", ...BYO_PROVIDERS] as const) {
			const label = providerLabel(provider);
			expect(label).not.toContain("-byo");
			expect(label).not.toBe("rowcat");
		}
	});

	it("every BYO provider has a key issuance page", () => {
		for (const provider of BYO_PROVIDERS)
			expect(PROVIDER_KEY_PAGE[provider]).toMatch(/^https:\/\//);
	});

	it("managed is not in the connection list", () => {
		expect(BYO_PROVIDERS).not.toContain("rowcat");
	});
});
