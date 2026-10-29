import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans the name-substitution boundary; same assertions as web's file of the same name.
 * This is exactly where the apps can diverge: each wires substitution itself, so if one substitutes
 * on the storage path instead of the body renderer, or rewrites the placeholder syntax, the same
 * response draws differently in that app only, visible only with two devices side by side.
 *
 * ```text
 * rewriting the placeholder syntax   replace(/\{\{char\}\}/...)   the two parsers diverge
 * storing substituted text           substituting into SQLite, copy or edit form   loses the original
 * ```
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MOBILE_SRC = join(HERE, "..", "..", "..");

/** Folders where this feature lives: conversation screen, playtest and local storage. */
const SCANNED = [
	join(MOBILE_SRC, "features", "chat"),
	join(MOBILE_SRC, "features", "playtest"),
	join(MOBILE_SRC, "lib", "local-data"),
];

const walk = (dir: string, found: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, found);
		else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
			found.push(full);
	}
	return found;
};

const sources = SCANNED.flatMap((base) =>
	walk(base).map((file) => ({
		path: relative(MOBILE_SRC, file),
		text: readFileSync(file, "utf8"),
	})),
);

describe("name substitution — the rule lives only in the shared package", () => {
	it("the screen doesn't rewrite the placeholder syntax", () => {
		for (const file of sources) {
			expect(file.text, file.path).not.toMatch(/replace\([^)]*\{\{\s*char/i);
			expect(file.text, file.path).not.toMatch(/replace\([^)]*\{\{\s*user/i);
			expect(file.text, file.path).not.toMatch(/\/\\\{\\\{/);
		}
	});

	// Not called from storage, copy or the edit form: the stored original stays intact.
	it("only the body renderer calls substitution", () => {
		const callers = sources
			.filter((file) => file.text.includes("resolveChatPlaceholders("))
			.map((file) => file.path)
			.sort();
		expect(callers).toEqual([join("features", "chat", "messages", "body.tsx")]);
	});
});
