import { describe, expect, it } from "vitest";
import { resolveGenerationExecution } from "./generation-availability.ts";
import {
	generationTargetKey,
	readGenerationTarget,
	sameGenerationTarget,
} from "./generation-preference.ts";
import {
	checkOpenRouterModel,
	checkOpenRouterUpstream,
	OPENROUTER_UPSTREAM_MAX_LENGTH,
	openRouterUpstreamOf,
	readOpenRouterUpstream,
	withOpenRouterUpstream,
} from "./openrouter.ts";

const TARGET = {
	provider: "openrouter-byo",
	model: "anthropic/claude-sonnet-5",
} as const;

describe("a model name typed in the picker", () => {
	it.each([
		"qwen/qwen3-max",
		"meta-llama/Llama-4-Scout",
		"mistralai/mistral-small:free",
		"~anthropic/claude-sonnet-latest",
		"openrouter/auto",
	])("accepts the gateway's id %s, verbatim", (name) => {
		expect(checkOpenRouterModel(`  ${name} `)).toEqual({
			ok: true,
			model: name,
		});
	});

	it.each([
		["", "empty"],
		["gpt-6", "invalid"],
		["qwen/ qwen3", "invalid"],
		["/model", "invalid"],
		["vendor/", "invalid"],
		["a/b/c", "invalid"],
		[`vendor/${"x".repeat(200)}`, "invalid"],
	] as const)("refuses %j (%s)", (name, reason) => {
		expect(checkOpenRouterModel(name)).toEqual({ ok: false, reason });
	});

	/** Typed outside the catalogue on purpose, so not "missing" from it. */
	it("runs on the route even though the catalogue does not list it", () => {
		const input = {
			connectedProviders: ["openrouter-byo"] as const,
			byoAllowed: true,
			catalog: [
				{ provider: "openrouter-byo", model: "openai/gpt-6-sol" },
			] as const,
		};
		expect(
			resolveGenerationExecution({
				...input,
				connectedProviders: [...input.connectedProviders],
				catalog: [...input.catalog],
				target: { provider: "openrouter-byo", model: "qwen/qwen3-max" },
			}).status,
		).toBe("executable");
		/** Only OpenRouter: another provider's unlisted model is still missing. */
		expect(
			resolveGenerationExecution({
				connectedProviders: ["anthropic-byo"],
				byoAllowed: true,
				catalog: [{ provider: "anthropic-byo", model: "claude-sonnet-5" }],
				target: { provider: "anthropic-byo", model: "claude-made-up" },
			}),
		).toMatchObject({ status: "blocked", reason: "model_unavailable" });
		/** And the connection is still required. */
		expect(
			resolveGenerationExecution({
				connectedProviders: [],
				byoAllowed: true,
				catalog: [],
				target: { provider: "openrouter-byo", model: "qwen/qwen3-max" },
			}),
		).toMatchObject({ status: "blocked", reason: "provider_not_connected" });
	});
});

describe("the host", () => {
	it.each([
		"anthropic",
		"amazon-bedrock",
		"google-vertex/us-east5",
		"deepinfra/fp8",
		"baseten/us/fast",
	])("accepts the gateway's slug %s", (slug) => {
		expect(readOpenRouterUpstream(slug)).toBe(slug);
	});

	it.each([
		"",
		"Anthropic",
		"amazon bedrock",
		"/anthropic",
		"anthropic/",
		"a//b",
		"../key",
		"anthropic?x=1",
		"x".repeat(OPENROUTER_UPSTREAM_MAX_LENGTH + 1),
		42,
		null,
	])("refuses %s as stored", (value) => {
		expect(readOpenRouterUpstream(value)).toBeNull();
	});

	it("typed text: trimmed and lowercased, empty means the gateway chooses", () => {
		expect(checkOpenRouterUpstream("  Amazon-Bedrock ")).toEqual({
			ok: true,
			upstream: "amazon-bedrock",
		});
		expect(checkOpenRouterUpstream("   ")).toEqual({
			ok: true,
			upstream: null,
		});
		expect(checkOpenRouterUpstream("amazon bedrock")).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("pins and unpins without touching the model", () => {
		const pinned = withOpenRouterUpstream(TARGET, "amazon-bedrock");
		expect(pinned).toEqual({ ...TARGET, upstream: "amazon-bedrock" });
		expect(openRouterUpstreamOf(pinned)).toBe("amazon-bedrock");
		expect(withOpenRouterUpstream(TARGET, null)).toEqual(TARGET);
		expect(withOpenRouterUpstream(TARGET, "Not A Slug")).toEqual(TARGET);
	});

	it("survives the read boundary, and a bad stored one drops alone", () => {
		expect(readGenerationTarget({ ...TARGET, upstream: "anthropic" })).toEqual({
			...TARGET,
			upstream: "anthropic",
		});
		expect(readGenerationTarget({ ...TARGET, upstream: "../x" })).toEqual(
			TARGET,
		);
		expect(
			readGenerationTarget({
				provider: "anthropic-byo",
				model: "claude-sonnet-5",
				upstream: "anthropic",
			}),
		).toEqual({ provider: "anthropic-byo", model: "claude-sonnet-5" });
	});

	it("is part of sameness but not of the catalogue key", () => {
		const pinned = withOpenRouterUpstream(TARGET, "anthropic");
		expect(sameGenerationTarget(pinned, TARGET)).toBe(false);
		expect(sameGenerationTarget(pinned, { ...pinned })).toBe(true);
		expect(generationTargetKey(pinned)).toBe(generationTargetKey(TARGET));
	});
});
