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

/**
 * The mail copy imports its components from `react-email`, which is a devDependency (its preview
 * CLI is the weight). The image installs production dependencies only, so the bundle must carry the
 * components; a `dist/` that imports `react-email` builds fine and dies on the first send.
 */
describe("runtime imports that are not runtime dependencies", () => {
	const bundled = (Array.isArray(config) ? config : [config]).flatMap(
		(item) => {
			const deps = (item as { deps?: { alwaysBundle?: unknown } }).deps;
			return Array.isArray(deps?.alwaysBundle) ? deps.alwaysBundle : [];
		},
	);

	test.each([["react-email"]])("%s is always bundled", async (name) => {
		const manifest = (
			await import("../package.json", { with: { type: "json" } })
		).default as { dependencies: Record<string, string> };
		expect(manifest.dependencies[name]).toBeUndefined();
		expect(
			bundled.some(
				(pattern) => pattern instanceof RegExp && pattern.test(name),
			),
		).toBe(true);
	});
});
