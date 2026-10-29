import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Boundaries of the visual QA lab: blocks the three ways the lab loses its proving power.
 *
 * The values on this screen come from one fact: what stands here is the very component the product
 * draws. That fact breaks in three ways, and all three compile:
 *
 * ```text
 * a lab-only copy is made        the screenshot proves that copy, not the product
 * a way in from product UI       the dev tool ends up in the release navigation IA
 * the release guard disappears   anyone who knows the address can open the screen
 * ```
 *
 * The first is the most tempting mistake in this slice. When something in the lab looks off, the
 * quickest answer is "change the values only in the lab", and a lab fixed that way always passes.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const LAB = join(SRC, "features/visual-lab");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

const labFiles = sources(LAB)
	.filter((path) => !path.endsWith(".test.ts"))
	.map((path) => ({
		path: path.slice(LAB.length + 1),
		text: stripComments(readFileSync(path, "utf8")),
	}));

const appFiles = sources(SRC)
	.filter((path) => !/\.test\.tsx?$/.test(path))
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}));

describe("the lab draws product primitives", () => {
	it("the files to scan actually exist", () => {
		expect(labFiles.length).toBeGreaterThan(2);
	});

	/**
	 * The source of drawn components is one: `@rowcat/ui-native`. Laying out with `View` and `Text`
	 * from `react-native` is fine (that is the lab's frame), but hand-drawing the things being
	 * compared (buttons, inputs, badges) means this screen proves nothing.
	 */
	it("doesn't create lab-only control copies", () => {
		for (const file of labFiles) {
			/** Mounting `TextInput` directly makes a lab copy, not `Input`. */
			expect(file.text, file.path).not.toMatch(/<TextInput\b/);
			expect(file.text, file.path).not.toMatch(/<Pressable\b/);
			expect(file.text, file.path).not.toMatch(/<TouchableOpacity\b/);
			/** A color literal anywhere means that spot did not pass through a token. */
			expect(file.text, file.path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
			expect(file.text, file.path).not.toMatch(/\brgba?\(/);
		}
	});

	/** Imported from the primitive package. The check above looks only for absence, so it needs a counterpart. */
	it("actually imports the primitives", () => {
		const screen = labFiles.find(
			(file) => file.path === "visual-lab-screen.tsx",
		);
		expect(screen?.text).toMatch(/from\s+["']@rowcat\/ui-native["']/);
		for (const primitive of ["Button", "Input", "Badge", "Card", "Panel"])
			expect(screen?.text, primitive).toContain(primitive);
	});

	/**
	 * The source of fixed values is one shared module. If the lab wrote its own strings, the two apps
	 * would draw different copy, and side-by-side screenshots would prove nothing: a difference in
	 * line breaks or density could not be attributed to text or to the renderer.
	 */
	it("takes fixed values from the shared module", () => {
		const screen = labFiles.find(
			(file) => file.path === "visual-lab-screen.tsx",
		);
		expect(screen?.text).toMatch(/from\s+["']@rowcat\/design\/visual-lab["']/);
	});
});

describe("the lab doesn't enter the product UI", () => {
	/**
	 * No product screen leads to this address. The development build opens it by typing the address
	 * directly, the same rule as `/dev-tools`.
	 */
	it("product code doesn't move to the lab", () => {
		const linkers = appFiles
			.filter(
				(file) =>
					!file.path.startsWith("features/visual-lab/") &&
					file.path !== "app/visual-lab.tsx",
			)
			.filter((file) => /["'`]\/visual-lab/.test(file.text))
			.map((file) => file.path);
		expect(linkers).toEqual([]);
	});

	/**
	 * The route returns to the first screen in release builds. expo-router reads all of `src/app/` as
	 * routes, so the file stays in the bundle; without this line it would open via deep link.
	 */
	it("doesn't open in release builds", () => {
		const route = appFiles.find((file) => file.path === "app/visual-lab.tsx");
		expect(route).toBeDefined();
		expect(route?.text).toMatch(/if\s*\(!__DEV__\)\s*return\s*<Redirect/);
	});
});
