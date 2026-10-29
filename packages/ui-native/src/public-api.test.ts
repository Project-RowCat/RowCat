import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the shape of the public API: what feature code can call from this package, not how it is
 * built. The general Sheet is not exported, because exporting a bowl that accepts any content lets
 * the policy leak one name at a time. The policy is therefore the API's shape, with five rules:
 * - The root does not export Sheet; it exports ChoiceSheet.
 * - package.json opens no subpath; `@rowcat/ui-native/sheet` must not exist.
 * - ChoiceSheet accepts no arbitrary node (children, render, content, and so on).
 * - NavigationDrawer is public. It accepts nodes, but its geometry is fixed, not an argument.
 *   Reverting any of these is an architectural change, not a new component. If one fails, confirm
 *   the change is intended before touching the test.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (text: string): string =>
	text
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

const codeOf = (file: string): string =>
	stripComments(readFileSync(`${HERE}${file}`, "utf8"));

const index = codeOf("index.ts");
const choiceSheet = codeOf("choice-sheet.tsx");
const navigationDrawer = codeOf("navigation-drawer.tsx");
const manifest = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("../package.json", import.meta.url)),
		"utf8",
	),
) as { exports: Record<string, unknown> };

/**
 * Counts exported names as a set rather than matching the source text. Substring matching is
 * fooled: if ChoiceSheet exists, a /Sheet/ check passes, so "does not export Sheet" would block
 * nothing.
 */
const exportedNames = (source: string): Set<string> => {
	const names = new Set<string>();
	for (const [, block] of source.matchAll(/export\s*\{([^}]*)\}\s*from/g))
		for (const entry of block.split(","))
			for (const name of [
				entry
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)
					.at(-1)
					?.trim(),
			])
				if (name) names.add(name);
	for (const [, name] of source.matchAll(
		/export\s+(?:declare\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/g,
	))
		names.add(name);
	return names;
};

const PUBLIC = exportedNames(index);

describe("root public API", () => {
	it("really read the names", () => {
		expect(PUBLIC.size).toBeGreaterThan(20);
	});

	/**
	 * This line has been reverted more often than any other decision in the repo. If `export { Sheet }
	 * from "./sheet.tsx"` returns, feature code can again put arbitrary content in the bottom panel,
	 * and the presentation scan in apps/mobile can only hold through its exception list.
	 */
	it("does not export a generic Sheet", () => {
		expect(PUBLIC.has("Sheet")).toBe(false);
		expect(index).not.toMatch(/from\s+["']\.\/sheet\.tsx["']/);
	});

	/** The sheet surface is a single capability, and its name says which one. */
	it("exports ChoiceSheet and its types", () => {
		expect(PUBLIC.has("ChoiceSheet")).toBe(true);
		expect(PUBLIC.has("ChoiceSheetOption")).toBe(true);
		expect(PUBLIC.has("ChoiceSheetProps")).toBe(true);
	});

	/**
	 * Not a rename. `export { Sheet as ChoiceSheet }` would pass every check in this file but narrow
	 * nothing: callers could still pass `children`. So ChoiceSheet must be a function defined in its
	 * own file.
	 */
	it("ChoiceSheet is not another name for Sheet", () => {
		expect(index).not.toMatch(/Sheet\s+as\s+ChoiceSheet/);
		expect(choiceSheet).toMatch(/export\s+function\s+ChoiceSheet\b/);
	});

	/** Only the sheet is narrowed. The other containers remain public as before. */
	it("other containers stay exported", () => {
		for (const name of [
			"AlertDialog",
			"ChoiceGroup",
			"ChoiceOption",
			"Dialog",
			"DropdownMenu",
			"MenuItem",
			"Select",
			"SelectOption",
		])
			expect(PUBLIC.has(name), name).toBe(true);
	});
});

describe("package subpaths", () => {
	/**
	 * A wildcard export such as `"./*": "./src/*.tsx"` would undo every check above. Feature code
	 * could then import `@rowcat/ui-native/sheet` directly. That import compiles and bundles, and it
	 * reads as an ordinary import line in review.
	 */
	it("exports has only the root", () => {
		expect(Object.keys(manifest.exports)).toEqual(["."]);
	});

	it("no wildcard of any form", () => {
		for (const key of Object.keys(manifest.exports))
			expect(key, key).not.toContain("*");
		expect(JSON.stringify(manifest.exports)).not.toContain("*");
	});

	/** Naming a specific subpath is the same hole, so no alias is added for it. */
	it("no subpath points at the sheet", () => {
		for (const [key, value] of Object.entries(manifest.exports)) {
			expect(key, key).not.toMatch(/sheet/i);
			expect(JSON.stringify(value), key).not.toMatch(/sheet/i);
		}
	});
});

describe("ChoiceSheet cannot hold arbitrary content", () => {
	const bodyOf = (declaration: string): string => {
		const start = choiceSheet.indexOf(declaration);
		expect(start, declaration).toBeGreaterThan(-1);
		const end = choiceSheet.indexOf("\n}", start);
		expect(end, declaration).toBeGreaterThan(start);
		return choiceSheet.slice(start, end);
	};

	/**
	 * This is the core check of this slice. Narrowing the capability means that anything beyond a
	 * short single choice is not expressible in the API. A `children` prop would make this a narrower
	 * Sheet under another name, and then chat settings, memory management, and report forms could land
	 * in this bowl again. Escape hatches come in under other names too, so they are blocked together:
	 * `content`, `renderContent`, `body`, `footer`, `header`, `render`.
	 */
	const ESCAPE_HATCHES = [
		"children",
		"content",
		"renderContent",
		"renderItem",
		"render",
		"body",
		"footer",
		"header",
		"component",
		"element",
		"slot",
	];

	it("props have no argument taking arbitrary nodes", () => {
		const props = bodyOf("export interface ChoiceSheetProps");
		for (const hatch of ESCAPE_HATCHES)
			expect(props.toLowerCase(), hatch).not.toContain(hatch.toLowerCase());
	});

	it("choice rows are values, not nodes", () => {
		const option = bodyOf("export interface ChoiceSheetOption");
		for (const hatch of ESCAPE_HATCHES)
			expect(option.toLowerCase(), hatch).not.toContain(hatch.toLowerCase());
		expect(option).toMatch(/value:\s*T;/);
		expect(option).toMatch(/label:\s*string;/);
	});

	/**
	 * The React node type must not enter this file at all. Banning prop names alone leaves a bypass
	 * such as `items: ReactNode[]`, which takes an arbitrary tree without using any banned name.
	 */
	it("brings in no ReactNode", () => {
		expect(choiceSheet).not.toMatch(/\bReactNode\b/);
		expect(choiceSheet).not.toMatch(/\bReactElement\b/);
		expect(choiceSheet).not.toMatch(/\bJSX\.Element\b/);
		expect(choiceSheet).not.toMatch(/\bPropsWithChildren\b/);
	});

	/**
	 * The sheet's internal axis (scrolling, for example) must not leak out to callers. Once a caller
	 * can set it, the next request is always `children`, and a caller that knows the bowl's internals
	 * is already using it.
	 */
	it("does not re-export the sheet's internal props", () => {
		const props = bodyOf("export interface ChoiceSheetProps");
		expect(props).not.toContain("scroll");
	});

	/**
	 * Built internally from Sheet and ChoiceGroup, so the accessibility wiring is reused, not written
	 * by hand.
	 */
	it("composes Sheet and ChoiceGroup internally", () => {
		expect(choiceSheet).toMatch(/from\s+["']\.\/sheet\.tsx["']/);
		expect(choiceSheet).toMatch(/from\s+["']\.\/choice\.tsx["']/);
		expect(choiceSheet).toContain("<Sheet");
		expect(choiceSheet).toContain("<ChoiceGroup");
		expect(choiceSheet).toContain("<ChoiceOption");
	});
});

/**
 * NavigationDrawer is a public capability, but not a general bowl. Unlike ChoiceSheet, it accepts
 * arbitrary nodes. The test therefore locks what cannot be chosen, not what is contained:
 * placement, size, and snap points are not parameters.
 */
describe("NavigationDrawer", () => {
	it("the root exports it", () => {
		expect(PUBLIC.has("NavigationDrawer")).toBe(true);
	});

	/**
	 * Not a rename. `export { Sheet as NavigationDrawer }` would pass the checks above while narrowing
	 * nothing, and callers could put arbitrary content in a panel that rises from the bottom. Like
	 * ChoiceSheet, it must be a function in its own file.
	 */
	it("not another name for Sheet", () => {
		expect(index).not.toMatch(/Sheet\s+as\s+NavigationDrawer/);
		expect(index).toMatch(/from\s+["']\.\/navigation-drawer\.tsx["']/);
		expect(navigationDrawer).toMatch(/export\s+function\s+NavigationDrawer\b/);
		expect(navigationDrawer).not.toMatch(/from\s+["']\.\/sheet\.tsx["']/);
	});

	/**
	 * Geometry is not an argument, and this check is the substance of the boundary. If placement
	 * (`placement`), size (`size`), or snap points (`snapPoints`) were opened, the drawer would become
	 * a surface that can stand anywhere, and then settings dialogs and report forms could be put in
	 * it. It carries only navigation because those parameters are not expressible.
	 */
	it("placement, size and snap cannot be chosen", () => {
		const props = navigationDrawer.slice(
			navigationDrawer.indexOf("export function NavigationDrawer"),
			navigationDrawer.indexOf("const drawer = StyleSheet.create"),
		);
		for (const hatch of [
			"placement",
			"size?",
			"snapPoints",
			"detents",
			"side",
			"anchor",
			"position?",
		])
			expect(props, hatch).not.toContain(hatch);
	});

	/**
	 * The trigger is exported with the drawer. If the screen drew its own button and the component
	 * took only `open`, the focus-restore wiring would disappear, because that hook attaches only when
	 * the trigger is inside Root (see the navigation-drawer.tsx header).
	 */
	it("the trigger is in the same tree and has a name", () => {
		expect(navigationDrawer).toMatch(/DialogPrimitive\.Trigger/);
		expect(navigationDrawer).toContain("triggerLabel: string;");
		expect(navigationDrawer).toContain("accessibilityLabel={triggerLabel}");
	});
});
