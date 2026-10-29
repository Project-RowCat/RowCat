import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans the scene-image boundary. It checks policy, not rendered output, since web tests
 * here have no React rendering. All three mistakes it guards against look correct today, are easy
 * for the next person to make, and pass compile and tests:
 *
 * ```text
 * re-writing token syntax     a screen scans for /\\[img:/ → two parsers diverge
 * assembling a media address  `${base}/media/${id}` → only that copy goes stale when a deploy changes the path
 * touching the original       a screen saves a body with the token removed → copy, search and edit lose it
 * ```
 *
 * The first is the most expensive. With two rule sets, the same response draws differently on web
 * and mobile, and only comparing two devices side by side reveals it.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..", "..");

/** Folders this feature lives in: the chat screen, the story test, and the creation screen. */
const FEATURE_DIRS = ["chat", "conversation", "playtest", "create"];

/**
 * Walks recursively. These features gained subfolders, and a shallow read misses every file inside
 * them, so a second parser placed there would still pass green.
 */
const walk = (dir: string, found: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, found);
		else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
			found.push(full);
	}
	return found;
};

const sources = FEATURE_DIRS.flatMap((dir) => {
	const base = join(WEB_SRC, "features", dir);
	return walk(base).map((file) => ({
		path: `${dir}/${relative(base, file)}`,
		text: readFileSync(file, "utf8"),
	}));
});

describe("scene images: the syntax lives in one place", () => {
	it("the screen does not re-write the token syntax", () => {
		/**
		 * This literal may appear only in human-readable sentences (guidance copy, comments). Once it is
		 * used in a regex or an `includes` scan, that becomes the second parser.
		 */
		for (const file of sources) {
			expect(file.text, file.path).not.toMatch(/\/\\\[img:/);
			expect(file.text, file.path).not.toMatch(/indexOf\(\s*["'`]\[img:/);
			expect(file.text, file.path).not.toMatch(/includes\(\s*["'`]\[img:/);
		}
	});

	it("splitting the body goes through one shared function", () => {
		const body = sources.find((file) => file.path === "chat/messages/body.tsx");
		expect(body).toBeDefined();
		expect(body?.text).toMatch(/parseChatContent/);
		expect(body?.text).toMatch(/from "@rowcat\/chat"/);
	});

	it("the shared function also decides turning triggers into pictures", () => {
		const body = sources.find((file) => file.path === "chat/messages/body.tsx");
		expect(body?.text).toMatch(/resolveSceneImage/);
		/** If the screen scans the list itself, the case and duplicate rules get decided here a second time. */
		expect(body?.text).not.toMatch(/sceneImages\.find\(/);
	});
});

describe("scene images: the SDK builds URLs", () => {
	it("the screen does not assemble media URLs", () => {
		for (const file of sources) {
			expect(file.text, file.path).not.toMatch(/["'`][^"'`]*\/media\/\$\{/);
			expect(file.text, file.path).not.toMatch(/API_BASE_URL/);
		}
	});

	it("places that need a URL call `media.url`", () => {
		const users = sources.filter((file) => file.text.includes("assetId"));
		expect(users.length).toBeGreaterThan(0);
		for (const file of users)
			if (file.text.includes("<img") || file.text.includes("src="))
				expect(file.text, file.path).toMatch(/media\.url\(/);
	});
});

describe("scene images: the stored original is untouched", () => {
	it("the screen does not store text with the token removed", () => {
		/**
		 * Copy, search and edit all read the stored body. Stripping the token at render time is not the
		 * same as stripping it from the stored value, and the latter cannot be undone.
		 */
		for (const file of sources) {
			expect(file.text, file.path).not.toMatch(/stripSceneImage/);
			expect(file.text, file.path).not.toMatch(
				/content\.replace\(\s*\/\\\[img/,
			);
		}
	});
});
