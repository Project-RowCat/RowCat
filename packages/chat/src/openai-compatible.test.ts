import { GenerationModelDto } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { generationTargetKey } from "./generation-preference.ts";
import {
	checkOpenAiCompatibleEndpoint,
	OPENAI_COMPATIBLE_MAX_MODELS,
	openAiCompatibleModelRows,
	parseOpenAiCompatibleModels,
	readOpenAiCompatibleConnection,
} from "./openai-compatible.ts";

describe("endpoint", () => {
	it.each([
		["https://api.example.com/v1", "https://api.example.com/v1"],
		["  HTTPS://API.Example.com/v1/  ", "https://api.example.com/v1"],
		["https://api.example.com", "https://api.example.com"],
		["https://api.example.com:8443/v1", "https://api.example.com:8443/v1"],
		["http://localhost:11434/v1", "http://localhost:11434/v1"],
		["http://127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1"],
		["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
		["https://[2001:db8::1]/v1", "https://[2001:db8::1]/v1"],
	])("accepts %s", (raw, endpoint) => {
		expect(checkOpenAiCompatibleEndpoint(raw)).toEqual({ ok: true, endpoint });
	});

	/** Checking an already-checked value changes nothing, so stored values stay one form. */
	it("is idempotent", () => {
		const first = checkOpenAiCompatibleEndpoint("HTTPS://Example.com/v1///");
		if (!first.ok) throw new Error("expected ok");
		expect(checkOpenAiCompatibleEndpoint(first.endpoint)).toEqual(first);
	});

	/** The key would cross the network readable; loopback never leaves the device. */
	it.each([
		"http://api.example.com/v1",
		"http://192.168.0.10:11434/v1",
		"http://10.0.2.2:11434/v1",
	])("refuses plain http off the device: %s", (raw) => {
		expect(checkOpenAiCompatibleEndpoint(raw)).toEqual({
			ok: false,
			reason: "insecure",
		});
	});

	it.each([
		"api.example.com/v1",
		"ftp://example.com",
		"javascript:alert(1)",
		"https://user:pass@example.com/v1",
		"https://example.com/v1?key=x",
		"https://example.com/v1#x",
		"https://exa mple.com",
		"https://example.com:0",
		"https://example.com:99999",
		"https://example.com:abc",
		"https://-bad-.com",
		"https://[zz::1]",
		"https://",
		`https://example.com/${"a".repeat(400)}`,
	])("refuses %s", (raw) => {
		expect(checkOpenAiCompatibleEndpoint(raw)).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("an empty entry is its own reason", () => {
		expect(checkOpenAiCompatibleEndpoint("   ")).toEqual({
			ok: false,
			reason: "empty",
		});
	});
});

describe("models", () => {
	it("splits on lines and commas, trims, keeps order, drops duplicates", () => {
		expect(
			parseOpenAiCompatibleModels(
				" llama3.1:8b \norg/model-7b, llama3.1:8b\n\n",
			),
		).toEqual({ ok: true, models: ["llama3.1:8b", "org/model-7b"] });
	});

	it("names keep their case and punctuation", () => {
		expect(parseOpenAiCompatibleModels("Org/Model-V2.5:Q4_K_M")).toEqual({
			ok: true,
			models: ["Org/Model-V2.5:Q4_K_M"],
		});
	});

	it.each([
		["", "empty"],
		[" , \n", "empty"],
		["two words", "invalid"],
		["a".repeat(201), "invalid"],
		[
			Array.from(
				{ length: OPENAI_COMPATIBLE_MAX_MODELS + 1 },
				(_, i) => `m${i}`,
			).join(","),
			"too_many",
		],
	])("refuses %j as %s", (raw, reason) => {
		expect(parseOpenAiCompatibleModels(raw)).toEqual({ ok: false, reason });
	});
});

describe("picker rows", () => {
	const rows = openAiCompatibleModelRows({
		endpoint: "http://localhost:11434/v1",
		models: ["llama3.1:8b", "qwen3:14b"],
	});

	/** The rows go wherever catalogue rows go, so they must be catalogue-shaped. */
	it("satisfies the catalogue contract", () => {
		for (const row of rows) expect(GenerationModelDto.parse(row)).toEqual(row);
	});

	it("ids meet stored targets", () => {
		expect(rows.map((row) => row.id)).toEqual(
			rows.map((row) =>
				generationTargetKey({
					provider: "openai-compatible-byo",
					model: row.model,
				}),
			),
		);
	});

	/** Nothing about the server is known, so no level and no narration pack is promised. */
	it("carries no capabilities and names the server", () => {
		for (const row of rows) {
			expect(row.reasoning).toBeNull();
			expect(row.promptPack).toBeNull();
			expect(row.requiresConnection).toBe(true);
			expect(row.vendorLabel).toBe("localhost:11434");
		}
	});

	it("no connection, no rows", () => {
		expect(openAiCompatibleModelRows(null)).toEqual([]);
	});
});

describe("reading a stored connection", () => {
	it("passes a canonical value through", () => {
		const value = { endpoint: "https://api.example.com/v1", models: ["m"] };
		expect(readOpenAiCompatibleConnection(value)).toEqual(value);
	});

	/** Re-checking must not silently rewrite; a non-canonical or refused value is no connection. */
	it.each([
		null,
		"https://api.example.com/v1",
		{ endpoint: "https://API.example.com/v1/", models: ["m"] },
		{ endpoint: "http://api.example.com/v1", models: ["m"] },
		{ endpoint: "https://api.example.com/v1", models: [] },
		{ endpoint: "https://api.example.com/v1", models: ["m", "m"] },
		{ endpoint: "https://api.example.com/v1", models: ["two words"] },
		{ endpoint: "https://api.example.com/v1", models: [1] },
	])("refuses %j", (value) => {
		expect(readOpenAiCompatibleConnection(value)).toBeNull();
	});
});
