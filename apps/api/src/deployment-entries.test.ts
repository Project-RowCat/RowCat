import { describe, expect, test } from "vitest";
import config from "../tsdown.config.ts";

/**
 * The deployment image carries `dist/` and nothing else (no `tsx`, no sources), so a command an
 * operator is told to run in the container exists only if it is a bundle entry. The setup screen
 * tells a new admin to appoint operators with `dist/db/seed-moderator.mjs`; when that entry was
 * missing, the instruction pointed at nothing and a compose deployment had no way to follow it.
 */
describe("deployment image entries", () => {
	const entries = new Set(
		(Array.isArray(config) ? config : [config]).flatMap((item) => {
			const entry = (item as { entry?: unknown }).entry;
			return Array.isArray(entry) ? entry : [];
		}),
	);

	test.each([
		["the server", "src/index.ts"],
		["jobs", "src/jobs/cli.ts"],
		["mobile OTA incidents", "src/services/mobile-updates/cli.ts"],
		["appointing operators", "src/db/seed-moderator.ts"],
		[
			"the publication compile thread",
			"src/services/story/runtime-compile-worker.ts",
		],
	])("%s is bundled (%s)", (_purpose, path) => {
		expect(entries.has(path)).toBe(true);
	});
});
