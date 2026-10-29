import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans the namespace of shared layout names. The mistake's shape never changes. A new
 * movable surface copies the active indicator from a neighboring file and keeps its `group`. Types
 * pass (both are strings), and it renders. The symptom appears only when two surfaces are visible
 * at once, and then the indicator flies across the screen. The sidebar is exactly that screen: the
 * global `Conversations` item and the room in the recent list can be on together. The check is policy, not
 * Motion's internals. It asserts only that one name is not used by two surfaces. How layoutId
 * produces transforms is checked in a browser. The LayoutGroup wrapper (sidebar-fixed,
 * sidebar-sheet) is not checked here; it handles one component living in two containers, while this
 * scan blocks different surfaces choosing the same name. Same rule as list-motion.test.ts and
 * page-enter.test.ts.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

/**
 * The literal `group="..."` form in one place. Forms passed as expressions are caught separately
 * below.
 */
const GROUP_LITERAL = /\bgroup=\{?"([^"]+)"\}?/g;
const USAGE = /<MotionActiveIndicator\b/g;

function sourceFiles(): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules") continue;
				walk(full);
				continue;
			}
			if (!entry.name.endsWith(".tsx")) continue;
			if (entry.name.endsWith(".test.tsx")) continue;
			files.push(full);
		}
	};
	walk(WEB_SRC);
	return files;
}

/** Maps each file to the group names it uses. Files that draw no indicator are not stored. */
function groupsByFile(): Map<string, Set<string>> {
	const found = new Map<string, Set<string>>();
	for (const file of sourceFiles()) {
		const source = readFileSync(file, "utf8");
		if (!USAGE.test(source)) {
			USAGE.lastIndex = 0;
			continue;
		}
		USAGE.lastIndex = 0;
		const groups = new Set<string>();
		for (const match of source.matchAll(GROUP_LITERAL)) {
			const name = match[1];
			if (name) groups.add(name);
		}
		found.set(relative(WEB_SRC, file), groups);
	}
	return found;
}

describe("active indicator namespaces", () => {
	/**
	 * If the scan finds nothing, this test passes forever. That is exactly how a stale regex looks, so
	 * the test first confirms that targets exist.
	 */
	it("something really draws the indicator", () => {
		expect(groupsByFile().size).toBeGreaterThan(0);
	});

	/**
	 * The type system catches a missing name, since `group` is required. This check covers the case
	 * above it: a file that draws the indicator with no string literal, meaning the name is built from
	 * a variable. That would create a name this scan cannot see. It would also open a path for domain
	 * values, such as a room id, to leak into layoutId, and then the indicator could not move between
	 * items.
	 */
	it("names are written as strings, not computed", () => {
		for (const [file, groups] of groupsByFile()) {
			expect(groups.size, `${file} has no group literal`).toBeGreaterThan(0);
		}
	});

	/**
	 * Core rule: one name belongs to one surface. If two files use the same name, Motion treats them
	 * as siblings and steals the indicator from one when the other turns on. A file is not necessarily
	 * a surface (one file can hold two lists), but the reverse holds in this repo: if a surface spans
	 * files, that is already the signal to extract a component.
	 */
	it("each name is used in one file only", () => {
		const owner = new Map<string, string>();
		const collisions: string[] = [];
		for (const [file, groups] of groupsByFile()) {
			for (const group of groups) {
				const previous = owner.get(group);
				if (previous && previous !== file)
					collisions.push(`"${group}": ${previous} + ${file}`);
				else owner.set(group, file);
			}
		}
		expect(collisions).toEqual([]);
	});
});
