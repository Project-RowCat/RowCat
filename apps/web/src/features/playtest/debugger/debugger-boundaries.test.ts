import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans what the debugger must not reach. The playtest folder already has a scan
 * (playtest-boundaries.test.ts); this file adds mistakes only the debugger can make, and they
 * happen naturally:
 * - 'Splitting the assembled prompt yields blocks' leads to a parser appearing in the screen.
 * - 'Saving the records lets them survive a refresh' turns observation into product data.
 * - 'Showing the raw provider error is friendlier' leaks credentials into the screen, screenshots
 *   and reports. All three pass the type checker and look plausible.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Source with comments removed. This folder's header names what it does not do (for example, 'does
 * not split the completed text'). If that sentence matched the scan, the explanation would be
 * reported as a violation, and the next person would fix it by deleting the explanation, the
 * opposite of what is wanted.
 */
const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

const files = () =>
	[...sources(HERE)].map((path) => ({
		name: path.slice(HERE.length),
		source: stripComments(readFileSync(path, "utf8")),
	}));

/** If a door appears in this folder, a boundary has been crossed. Each entry has its own reason. */
const FORBIDDEN: { door: string; why: string }[] = [
	{
		door: "localStorage",
		why: "observation records live only in memory; kept, they grow across reloads and then need a way to delete them",
	},
	{ door: "sessionStorage", why: "for the same reason" },
	{ door: "indexedDB", why: "for the same reason" },
	{
		door: "local-chat",
		why: "the debugger does not know the conversation store",
	},
	{
		door: "local-sync",
		why: "observation records are not sync records (no codec, no tombstone)",
	},
	{
		door: "local-authoring",
		why: "the debugger neither reads nor writes drafts; the values it draws are already in hand",
	},
	{
		door: "getRowCatClient",
		why: "observation records don't go to the server; telemetry upload would grow through this door",
	},
	{ door: "useMutation", why: "this surface has no writes" },
	{ door: "fetch(", why: "for the same reason" },
	{
		door: "buildChatGenerationRequest",
		why: "the debugger makes no requests; it draws the records it receives",
	},
	{
		door: "selectLore",
		why: "the assembler already decided lore; doing it again here would split the screen from the prompt",
	},
	{
		door: "ABSOLUTE_GUARD",
		why: "guard text appearing here means a second prompt assembly has started",
	},
	{ door: "@rowcat/runtime-host", why: "the VM stands only inside the worker" },
	{ door: "compileRuntimeProject", why: "the debugger does not compile" },
];

describe("debugger boundaries", () => {
	it.each(FORBIDDEN)("does not import $door: $why", ({ door }) => {
		expect(
			files()
				.filter((file) => file.source.includes(door))
				.map((file) => file.name),
		).toEqual([]);
	});

	it("there are files to scan", () => {
		expect(files().length).toBeGreaterThan(4);
	});
});

/**
 * The completed prompt is not split again. Its structure is fixed before the value becomes a string
 * (prompt-trace.ts in @rowcat/chat). If the screen split the system text by a separator to recover
 * blocks from headers, a one-line change to assembly order would silently mislead the inspector.
 * The error would not throw; it would show the creator a wrong basis for editing the manuscript.
 */
describe("does not parse the prompt", () => {
	const PARSER_SHAPES = [
		'split("\\n\\n")',
		"split('\\n\\n')",
		".match(/#",
		'startsWith("# ")',
		"indexOf(LORE_HEADER)",
		"LORE_HEADER",
		"MEMORY_HEADER",
		"SUMMARY_HEADER",
	];

	it.each(PARSER_SHAPES)("%s does not appear", (shape) => {
		expect(
			files()
				.filter((file) => file.source.includes(shape))
				.map((file) => file.name),
		).toEqual([]);
	});
});

/**
 * The provider's raw text does not come to this surface. What is shown is the sentence our table
 * selected (SafeGenerationFailure.summary), a type with no `message` field. If the screen started
 * reading error.message, that rule would break, and compile and tests would still pass.
 */
describe("does not read the original failure message", () => {
	it.each([
		"error.message",
		"failure.message",
		"String(error)",
	])("%s does not appear", (shape) => {
		expect(
			files()
				.filter((file) => file.source.includes(shape))
				.map((file) => file.name),
		).toEqual([]);
	});
});
