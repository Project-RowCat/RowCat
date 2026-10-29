import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RUNTIME_BETA, runtimeBetaBadgeLabel } from "./runtime-beta.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "..", path), "utf8");

/**
 * The beta badge must not lie in either direction. Over-promising cannot be kept, because raising
 * the version means published works must be republished, and under-promising is untrue while still
 * driving creators away.
 */
describe("how far the compatibility promise reaches", () => {
	test("makes no promise it cannot keep", () => {
		/**
		 * The host's artifact check requires an exact RUNTIME_API_VERSION match, and the server holds no
		 * authoring source, so 'forever', 'absolutely', and 'always unchanged' are promises that cannot
		 * be kept.
		 */
		for (const overreach of [
			"forever",
			"never",
			"guarantee",
			"lifetime",
			"will stay exactly",
		])
			expect(RUNTIME_BETA.promise).not.toContain(overreach);
	});

	test("makes no scary disclaimer", () => {
		for (const scare of [
			"at any time",
			"without notice",
			"may not work",
			"may stop",
			"not responsible",
		])
			expect(RUNTIME_BETA.promise).not.toContain(scare);
	});

	test("the badge's name says what is in beta", () => {
		expect(runtimeBetaBadgeLabel()).toContain(RUNTIME_BETA.label);
		expect(runtimeBetaBadgeLabel()).toContain("runtime");
		expect(runtimeBetaBadgeLabel()).toBe(
			`${RUNTIME_BETA.srPrefix}${RUNTIME_BETA.label}`,
		);
	});

	/**
	 * Do not set the name as aria-label: a role-less span does not support that attribute, so it is
	 * silently ignored. All three surfaces build the name from body text (the sr-only prefix) instead.
	 */
	test("the badge's name is body text, not an attribute", () => {
		for (const file of [
			"features/runtime-studio/runtime-studio-header.tsx",
			"features/runtime-templates/runtime-template-gallery.tsx",
			"features/docs/runtime-docs-page.tsx",
		]) {
			const source = read(file);
			expect(source, `${file}: the hidden prefix builds the name`).toContain(
				"RUNTIME_BETA.srPrefix",
			);
			expect(source, `${file}: no aria-label on the badge`).not.toContain(
				"aria-label={RUNTIME_BETA",
			);
		}
	});
});

/**
 * The badge appears only on the creator's surfaces. On the playback screen it would read as saying
 * the creator's published work is unfinished, which is not the product's to say.
 */
describe("where the badge stands", () => {
	test("the three creator surfaces read the same value", () => {
		for (const file of [
			"features/runtime-studio/runtime-studio-header.tsx",
			"features/runtime-templates/runtime-template-gallery.tsx",
			"features/docs/runtime-docs-page.tsx",
		])
			expect(
				read(file),
				`${file}: the badge comes from the shared constant`,
			).toContain("RUNTIME_BETA");
	});

	test("playback surfaces do not read this value", () => {
		for (const file of [
			"features/runtime-player/runtime-player-copy.ts",
			"features/runtime-player/runtime-player-screen.tsx",
		]) {
			let source: string;
			try {
				source = read(file);
			} catch {
				continue;
			}
			expect(source, `${file}: players are not told it is beta`).not.toContain(
				"RUNTIME_BETA",
			);
			expect(source).not.toContain("Beta");
		}
	});
});
