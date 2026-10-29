import { describe, expect, test } from "vitest";
import { resolveMobileUpdateCiConfig } from "./mobile-update-ci-config.ts";

describe("CI connection for OTA publish jobs", () => {
	test("all three empty is a normal deployment with no connection", () => {
		expect(
			resolveMobileUpdateCiConfig({ repository: "", token: "", channels: "" }),
		).toEqual({ ok: true, config: null });
	});

	test.each([
		{ repository: "rowcat/rowcat", token: "", channels: "production" },
		{ repository: "", token: "t", channels: "production" },
		{ repository: "rowcat/rowcat", token: "t", channels: "" },
	])("half is a boot error — %o", (input) => {
		expect(resolveMobileUpdateCiConfig(input).ok).toBe(false);
	});

	test("the repository is owner/repo, and the channels are in the vocabulary", () => {
		expect(
			resolveMobileUpdateCiConfig({
				repository: "https://github.com/rowcat/rowcat",
				token: "t",
				channels: "production",
			}).ok,
		).toBe(false);
		expect(
			resolveMobileUpdateCiConfig({
				repository: "rowcat/rowcat",
				token: "t",
				channels: "production,development",
			}).ok,
		).toBe(false);
	});

	test("channels are read in order without duplicates", () => {
		expect(
			resolveMobileUpdateCiConfig({
				repository: "rowcat/rowcat",
				token: " t ",
				channels: "production, preview,production",
			}),
		).toEqual({
			ok: true,
			config: {
				repository: "rowcat/rowcat",
				token: "t",
				channels: ["production", "preview"],
			},
		});
	});
});
