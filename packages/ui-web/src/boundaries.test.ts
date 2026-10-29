import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFamilyName } from "@rowcat/design";
import { describe, expect, it } from "vitest";

/**
 * Static scan. The first rule is one-directional: this package must not import @rowcat/ui-native.
 *
 * That package sits on React Native. If it entered the browser bundle, it would pull in all of
 * react-native, and the failure would appear as a whole-build failure rather than a single import
 * error.
 *
 * The reverse direction is checked by the same-named file in ui-native. Each check lives in its own
 * package because a central check would need to know the other package's source paths, which would
 * cross the boundary it guards.
 *
 * Sharing happens in @rowcat/design. The two UI packages share decisions (color meaning, radius,
 * hierarchy, spacing), not render code.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: readFileSync(path, "utf8"),
	}))
	/**
	 * The scanner and its neighboring tests hold the forbidden words as patterns, so test files are
	 * excluded from the scan.
	 */
	.filter((file) => !/\.test\.tsx?$/.test(file.path));

/**
 * Source with comments stripped.
 *
 * This repo's comments name each rule by its name. If a sentence explaining why a rule exists, such
 * as why the old class `zoom-in-95` was removed, were scanned, it would flag itself as a violation.
 * Docs would then be edited to satisfy the scanner. Stripping comments first avoids that.
 */
const codeOf = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const manifest = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

describe("brings in no native presentation", () => {
	it("there are files to check", () => {
		expect(all.length).toBeGreaterThan(10);
	});

	it("imports neither @rowcat/ui-native nor react-native", () => {
		for (const file of all) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/ui-native/);
			expect(file.text, file.path).not.toMatch(/from\s+["']react-native/);
			expect(file.text, file.path).not.toMatch(/from\s+["']expo/);
		}
	});
});

/**
 * One animation system: Motion.
 *
 * This package once opened popups with tw-animate-css utilities, and that system is easy to
 * reintroduce. shadcn-generated components arrive carrying those classes, and one added line looks
 * like an ordinary diff in review.
 *
 * Nothing visibly breaks when it returns. Two transition systems simply run on the same UI, which
 * shows up only visually. Hence this check.
 */
describe("there is one animation system", () => {
	/**
	 * Matches only the utilities the old system provided. `animate-none` and `animate-spin` are
	 * Tailwind core and are excluded.
	 */
	const TW_ANIMATE_UTILITIES =
		/\b(?:animate-(?:in|out)|(?:fade|zoom|spin)-(?:in|out)-|slide-(?:in-from|out-to)-)/;

	it("does not depend on tw-animate-css", () => {
		const all_deps = {
			...manifest.dependencies,
			...manifest.devDependencies,
			...manifest.peerDependencies,
		};
		expect(Object.keys(all_deps)).not.toContain("tw-animate-css");
	});

	it("no stylesheet brings in tw-animate-css", () => {
		const styles = fileURLToPath(new URL("./styles/", import.meta.url));
		for (const entry of readdirSync(styles)) {
			const text = readFileSync(join(styles, entry), "utf8");
			expect(text, entry).not.toMatch(/tw-animate/);
		}
	});

	it("no old animation utilities remain", () => {
		const offenders = all
			.filter((file) => TW_ANIMATE_UTILITIES.test(codeOf(file.text)))
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * motion is a peer dependency. It must be the same instance as the consuming app, because
	 * LazyMotion and MotionConfig pass through React context.
	 *
	 * If this package bundled its own copy, the context would split and primitives would silently stop
	 * animating, with no error.
	 */
	it("does not hold motion as its own dependency", () => {
		expect(manifest.peerDependencies ?? {}).toHaveProperty("motion");
		expect(manifest.dependencies ?? {}).not.toHaveProperty("motion");
		expect(manifest.devDependencies ?? {}).not.toHaveProperty("motion");
	});

	/**
	 * Does not bypass LazyMotion strict.
	 *
	 * If a component imports values from motion/react, the app's bundle decision (domMax only) becomes
	 * meaningless at that spot. Strict mode catches this only when that component actually renders.
	 * Type-only imports are exempt because they are not runtime values.
	 */
	it("moving elements come only from motion/react-m", () => {
		const offenders = all
			.filter((file) =>
				[
					...codeOf(file.text).matchAll(
						/^import\s+([\s\S]*?)from\s+"motion\/react"/gm,
					),
				].some(([, clause]) => !(clause ?? "").includes("type")),
			)
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * Motion values come only from lib/primitive-motion.ts.
	 *
	 * If a component assembles initial={{ opacity: 0, scale: 0.95 }} inline, the direction table
	 * multiplies into five copies, and one inevitably drifts. The evidence: in the old class strings,
	 * only the submenu lacked two directions.
	 */
	it("components write no motion values of their own", () => {
		const offenders = all
			.filter((file) => file.path.startsWith("components/"))
			.filter((file) =>
				/\b(?:initial|animate|exit)=\{\{/.test(codeOf(file.text)),
			)
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * CSS transitions follow the same rule. Milliseconds and easing curves written as classes do not
	 * follow token changes. The toast was actually in that state: 500ms, 1.8x the scale's upper bound,
	 * and a bezier matching no token.
	 *
	 * Rhythm comes via style from the values in lib/primitive-motion.ts. Infinite decorative
	 * animations such as animate-spin and animate-pulse are excluded. For those, existence rather than
	 * timing is the decision, and each component's comment explains it.
	 */
	it("components write no CSS durations or curves in classes", () => {
		const offenders = all
			.filter((file) => file.path.startsWith("components/"))
			.filter((file) => {
				const code = codeOf(file.text);
				return (
					/\bduration-\[?\d/.test(code) ||
					/\bease-\[/.test(code) ||
					/_\d+ms/.test(code) ||
					/cubic-bezier\(/.test(code)
				);
			})
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * The limitation of the check above: deleting a value is silent. If `style={toastRhythm}` is
	 * removed, no literal remains in the classes, so the check passes and transitions fall back to
	 * Tailwind defaults.
	 *
	 * To cover that, this test also locks the presence of the rhythm for each CSS-animated surface.
	 * Checkboxes, switches, and selection are covered by selection-state.test.ts.
	 */
	it("the toast takes its rhythm from tokens", () => {
		const toastSource = all.find(
			(file) => file.path === "components/toast.tsx",
		);
		expect(toastSource).toBeDefined();
		const code = codeOf(toastSource?.text ?? "");
		expect(code).toContain("style={toastRhythm}");
		expect(code).toContain("style={toastContentRhythm}");
		expect(code).toContain("motion-reduce:transition-opacity");
	});
});

/**
 * Checks that the font identity is the same value in both apps.
 *
 * This package is the source of the font stack (--font-sans in styles/globals.css), and native
 * registers one file per weight (apps/mobile/src/lib/fonts.ts). If each place spelled its own name,
 * one could drift. The failure is not an error but two apps drawing different letters.
 *
 * Hence the single source: fontFamilyName in @rowcat/design. The CSS is read as a string because it
 * is not code and cannot be imported to check its value.
 */
describe("the body font identity matches the shared token", () => {
	const globals = readFileSync(join(SRC, "styles/globals.css"), "utf8");

	it("the first family of `--font-sans` is the shared name", () => {
		const declaration = /--font-sans:\s*([^;]+);/.exec(globals)?.[1] ?? "";
		expect(declaration).not.toBe("");
		/** The variable face is listed first (used by web only), followed by the static family name. */
		expect(declaration).toContain(`'${fontFamilyName} Variable'`);
		expect(declaration).toContain(fontFamilyName);
	});

	/**
	 * Loading must also use the same family. Fixing only the stack leaves the name connected to
	 * nothing.
	 */
	it("actually loads that family", () => {
		expect(globals.toLowerCase()).toContain(fontFamilyName.toLowerCase());
		expect(globals).toMatch(/@import url\(['"]https:\/\/[^'"]+['"]\)/);
	});
});
