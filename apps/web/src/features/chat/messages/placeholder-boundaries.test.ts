import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans the name-substitution boundary. It checks policy, not rendered output, since web
 * tests here rarely render React. Both mistakes it guards against look correct today, are easy for
 * the next person to make, and pass compile and tests:
 *
 * ```text
 * re-writing placeholder syntax   a screen replaces /\{\{char\}\}/ itself → two parsers diverge
 * saving substituted text         substitution baked into storage, copy or the edit form → original lost
 * ```
 *
 * The second is the whole value of this slice. Substitution runs only at render time (`ChatBody`);
 * stored bodies never change. Copy takes the stored original, search scans it, and the edit form
 * receives it. If that breaks, the user edits text they never wrote, and nothing raises an error.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..", "..");

/** Folders this feature lives in: the chat screen, the story test, and local storage. */
const SCANNED = [
	join(WEB_SRC, "features", "chat"),
	join(WEB_SRC, "features", "conversation"),
	join(WEB_SRC, "features", "playtest"),
	join(WEB_SRC, "lib", "local-chat"),
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
		path: relative(WEB_SRC, file),
		text: readFileSync(file, "utf8"),
	})),
);

describe("name substitution: the rule lives only in the shared package", () => {
	/**
	 * The placeholder notation is wider than it looks (one or two braces, case-insensitive, inner
	 * spaces allowed, half brackets passed through). If a screen re-writes only part of it, the same
	 * response draws differently in the two apps, and only comparing two devices reveals it.
	 */
	it("the screen does not re-write the placeholder syntax", () => {
		for (const file of sources) {
			expect(file.text, file.path).not.toMatch(/replace\([^)]*\{\{\s*char/i);
			expect(file.text, file.path).not.toMatch(/replace\([^)]*\{\{\s*user/i);
			expect(file.text, file.path).not.toMatch(/\/\\\{\\\{/);
		}
	});

	/**
	 * The only caller of substitution is the one component that draws the body. The assertion's value
	 * is that storage, copy and the edit form never call it, which structurally expresses "the stored
	 * original stays untouched".
	 */
	it("the body renderer is the only caller of substitution", () => {
		const callers = sources
			.filter((file) => file.text.includes("resolveChatPlaceholders("))
			.map((file) => file.path)
			.sort();
		expect(callers).toEqual([join("features", "chat", "messages", "body.tsx")]);
	});
});
