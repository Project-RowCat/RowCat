import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks that the app has one motion engine. The app once ran two transition systems:
 * product motion through Motion, and primitive open/close through tw-animate-css utility classes
 * (data-open:animate-in). This file exists because they were merged. It guards three things:
 * 1. Old utilities do not come back. shadcn-generated components carry them, and a pasted line
 *    looks like an ordinary diff. The package is gone, so those classes now do nothing, which looks
 *    the same as a missing animation.
 * 2. LazyMotion strict is not bypassed. If a screen imports motion values, the bundle decision
 *    made at the root (domMax) stops meaning anything, and strict only notices when that screen
 *    renders.
 * 3. The provider really wraps the app. Primitives in @rowcat/ui-web render with m.*, so a
 *    dialog rendered outside MotionProvider appears frozen, with no error or warning. The admin
 *    console has the same rule (apps/admin/src/lib/boundaries.test.ts). Each app keeps its own
 *    check so neither has to know the other's source paths.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "..", "..");

function sources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "generated") continue;
			sources(full, out);
			continue;
		}
		if (!/\.tsx?$/.test(entry.name)) continue;
		if (/\.test\.tsx?$/.test(entry.name)) continue;
		if (entry.name === "routeTree.gen.ts") continue;
		out.push(full);
	}
	return out;
}

const files = sources(SRC).map((path) => ({
	path: path.slice(SRC.length + 1),
	text: readFileSync(path, "utf8"),
}));

/**
 * Scans source with comments removed. Comments here name the rules they describe, so a sentence
 * that mentions an old class name would flag itself. The docs are not reworded to satisfy the
 * check.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Picks only the utilities the old system actually provided. animate-none and animate-spin are
 * Tailwind core and are excluded.
 */
const TW_ANIMATE_UTILITIES =
	/\b(?:animate-(?:in|out)|(?:fade|zoom|spin)-(?:in|out)-|slide-(?:in-from|out-to)-)/;

describe("there is one motion engine", () => {
	it("there really are files to scan", () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it("does not depend on tw-animate-css", () => {
		const manifest = readFileSync(join(SRC, "..", "package.json"), "utf8");
		expect(manifest).not.toMatch(/tw-animate/);
	});

	it("no old animation utilities remain", () => {
		const offenders = files
			.filter((file) => TW_ANIMATE_UTILITIES.test(code(file.text)))
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * Animated elements come only from motion/react-m. The check blocks the `motion` export, not the
	 * whole motion/react module, because that module also exports AnimatePresence, LayoutGroup, and
	 * LazyMotion. Those are wrappers around animated elements, not elements themselves, and m cannot
	 * replace them. About twenty places in the app use AnimatePresence this way. A motion.div would
	 * make the domMax bundle decision meaningless, and strict only catches it when that screen
	 * renders.
	 */
	it("animated elements come only from motion/react-m", () => {
		const offenders = files
			.filter((file) => {
				const source = code(file.text);
				const importsMotionExport = [
					...source.matchAll(/^import\s+([\s\S]*?)from\s+"motion\/react"/gm),
				].some(([, clause = ""]) => {
					if (clause.includes("type")) return false;
					/** `import * as motion` · `import motion from` · `{ motion }` · `{ motion as x }` */
					if (/^\s*\*\s+as\s/.test(clause)) return true;
					if (/^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.trim())) return true;
					return /\{[^}]*\bmotion\b[^}]*\}/.test(clause);
				});
				return importsMotionExport || /<motion\./.test(source);
			})
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * Checks that the root actually wraps the app. The name appearing in the file is not enough, so it
	 * looks for an opening <MotionProvider> tag.
	 */
	it("the root wraps the app in MotionProvider", () => {
		const root = files.find((file) => file.path === "routes/__root.tsx");
		expect(root).toBeDefined();
		expect(code(root?.text ?? "")).toMatch(/<MotionProvider>/);
	});
});
