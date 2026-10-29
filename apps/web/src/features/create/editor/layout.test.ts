import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans what the editor's layout motion reacts to. The check mirrors the repo's other
 * motion scan (lib/motion/active-indicator.test.ts). Motion re-measures geometry on every render
 * unless layoutDependency is set, and typing causes renders, so a missing value shows up only as
 * heavy typing on drafts with several cards, which neither types nor visuals reveal. The check
 * verifies that a value exists, not Motion's internals; whether the values are correct (ordered as
 * intended) is confirmed in the browser.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
/**
 * The scan covers the whole create feature. Reading only the editor folder would miss relayouts in
 * neighboring folders.
 */
const CREATE = join(HERE, "..");

/** An opening JSX tag; its attribute list may span several lines. */
interface JsxTag {
	file: string;
	line: number;
	name: string;
	source: string;
}

/**
 * Collects opening tags line by line without a parser. Biome indents with tabs, so a multi-line tag
 * ends with a `>` at the same depth as its opening line and does not mix with nested tags that sit
 * deeper.
 */
function openingTags(file: string): JsxTag[] {
	const lines = readFileSync(file, "utf8").split("\n");
	const tags: JsxTag[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const opened = /^(\t*)<([A-Za-z][\w.]*)$/.exec(line);
		if (!opened) continue;
		const [, indent = "", name = ""] = opened;
		const closing = `${indent}>`;
		const end = lines.findIndex((row, at) => at > i && row === closing);
		if (end < 0) continue;
		tags.push({
			file: basename(file),
			line: i + 1,
			name,
			source: lines.slice(i, end + 1).join("\n"),
		});
	}
	return tags;
}

/**
 * The draft list screen is exempt. Its renders come from changes to the draft records themselves,
 * and its row geometry changes only on explicit actions such as delete confirmation, so the default
 * per-render measurement is acceptable. The exclusion is listed by name so new files fall under the
 * rule by default. The published-work list and its card (published-work-list.tsx,
 * creator-work-card.tsx) are not exempt; they simply do not use layout motion, because the server
 * list grows via `Show more`, and re-animating existing cards would make the whole list look rebuilt.
 */
const OUTSIDE_EDITOR: ReadonlySet<string> = new Set([
	join("drafts", "list.tsx"),
]);

function tsxFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) tsxFiles(full, found);
		else if (entry.endsWith(".tsx")) found.push(full);
	}
	return found;
}

function featureTags(): JsxTag[] {
	return tsxFiles(CREATE)
		.filter((file) => !OUTSIDE_EDITOR.has(relative(CREATE, file)))
		.flatMap((file) => openingTags(file));
}

const at = (tag: JsxTag) => `${tag.file}:${tag.line} <${tag.name}>`;

describe("editor layout motion", () => {
	it("every node with layout carries a reason to relayout", () => {
		const missing = featureTags()
			.filter((tag) => tag.source.includes('layout="position"'))
			.filter((tag) => !tag.source.includes("layoutDependency"))
			.map(at);

		// A node without a dependency value re-measures on every render, and typing is what produces
		// those renders.
		expect(missing).toEqual([]);
	});

	it("a section re-measures only when its own structure changes", () => {
		const sections = featureTags().filter(
			(tag) => tag.name === "EditorSection",
		);
		// If no sections are found, the scan has passed for nothing: the formatting changed or the path
		// is wrong.
		expect(sections.length).toBeGreaterThan(3);

		const missing = sections
			.filter((tag) => !tag.source.includes("layoutDependency"))
			.map(at);
		expect(missing).toEqual([]);
	});

	it("the sections are one group", () => {
		/**
		 * Without a LayoutGroup, a section that grows would not move the sections below it, because their
		 * own structure has not changed, so they would jump rather than flow. layoutDependency therefore
		 * requires the group, and this check confirms the group is present in page.tsx.
		 */
		const editor = readFileSync(join(HERE, "page.tsx"), "utf8");
		expect(editor).toContain("<LayoutGroup>");
	});
});
