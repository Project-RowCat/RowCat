import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan for endlessly looping motion: placeholders, spinners, and the two exceptions.
 *
 * This breaks in a predictable shape. A new screen hand-writes <Loader2 className="animate-spin" />
 * or animate-pulse. It looks fine in review and on screen, but only users who turned on reduced
 * motion see those spots keep moving. The repo was in that state once (sixteen spinners and two
 * hand-written placeholders).
 *
 * The rule is documented in docs/motion/ARCHITECTURE.md under the endless-motion section. The test
 * checks that policy, not the styles a browser computes.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..", "..");

/**
 * Source with comments stripped. Comments in this repo name the rules they describe, so the scan
 * must not match against them.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return walk(full);
		return /\.tsx?$/.test(name) && !name.includes(".test.") ? [full] : [];
	});

const APP_ROOTS = ["apps/web/src", "apps/admin/src"];
const appFiles = APP_ROOTS.flatMap((root) => walk(join(REPO, root))).map(
	(full) => ({
		path: relative(REPO, full),
		code: code(readFileSync(full, "utf8")),
	}),
);

const uiWeb = (name: string) =>
	code(
		readFileSync(join(REPO, "packages/ui-web/src/components", name), "utf8"),
	);

/**
 * The two spots that keep breathing under reduced motion. Adding a name is the only way to widen
 * this list, and that path also means updating the exceptions list in the docs together. Adding a
 * line without a reason leaves that spot moving for users who turned the setting on.
 */
const BREATHING = [
	// Response-waiting bar. If it stops, it looks the same as a broken, empty gap.
	"apps/web/src/features/chat/messages/list.tsx",
	"apps/web/src/features/chat/messages/markdown.tsx",
];

describe("endless animations", () => {
	/**
	 * If the scan finds no files, every check below passes silently. So the file count is asserted
	 * first.
	 */
	it("there really is something to scan", () => {
		expect(appFiles.length).toBeGreaterThan(100);
	});

	/**
	 * The spinner is the single Spinner component. If the app writes animate-spin directly, that spot
	 * keeps spinning under reduced motion.
	 */
	it("the app does not write spins directly", () => {
		const offenders = appFiles
			.filter((file) => /\banimate-spin\b/.test(file.code))
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/** Placeholders belong to Skeleton. Only the two breathing exceptions write pulse directly. */
	it("only two exceptions write pulses directly", () => {
		const offenders = appFiles
			.filter((file) => /\banimate-pulse\b/.test(file.code))
			.map((file) => file.path)
			.filter((path) => !BREATHING.includes(path));
		expect(offenders).toEqual([]);
	});

	/**
	 * A stale exception list becomes a list that permits spots that no longer exist. The two spots
	 * still do that job.
	 */
	it.each(BREATHING)("%s still breathes", (path) => {
		const file = appFiles.find((entry) => entry.path === path);
		expect(file?.code).toMatch(/\banimate-pulse\b/);
		expect(file?.code).not.toMatch(/motion-reduce:[\w-]*animate-none/);
	});

	/**
	 * Under reduced motion the spinner blinks instead of spinning. Stopping it (animate-none) would
	 * make a frozen arc look finished. Leaving it spinning would break that setting's intent, which is
	 * that transforms stop.
	 */
	it("the spinner blinks under that setting", () => {
		const spinner = uiWeb("spinner.tsx");
		expect(spinner).toContain("animate-spin motion-reduce:animate-pulse");
		expect(spinner).toContain('aria-hidden="true"');
	});

	/**
	 * The placeholder stops under that setting. Even stopped, it still says the content is not there
	 * yet.
	 */
	it("placeholders stop under that setting", () => {
		expect(uiWeb("skeleton.tsx")).toContain("motion-reduce:animate-none");
	});

	/**
	 * Even inside the primitives there is only one spinner that writes rotation. The toast's loading
	 * indicator was a spot that hand-wrote it.
	 */
	it("inside the UI package too, only the spinner writes a spin", () => {
		const components = readdirSync(
			join(REPO, "packages/ui-web/src/components"),
		).filter((name) => name.endsWith(".tsx"));
		const offenders = components.filter(
			(name) => name !== "spinner.tsx" && /\banimate-spin\b/.test(uiWeb(name)),
		);
		expect(offenders).toEqual([]);
		expect(uiWeb("toast.tsx")).toContain("<Spinner");
	});
});

/**
 * A glyph and a spinner that alternate in the same cell swap in place. Choosing one of them
 * conditionally makes the picture in the button jump within a single frame on press. Other state
 * changes of the same button (copy, stop generating, follow) already swap this way.
 */
describe("spinners in buttons", () => {
	it.each([
		"apps/web/src/features/chat/suggestion/panel.tsx",
		"apps/web/src/features/create/publishing/publish-panel.tsx",
		"apps/web/src/features/create/editor/sections/scene-image-list.tsx",
		"apps/web/src/features/runtime-studio/assets/panel.tsx",
	])("%s swaps the glyph", (path) => {
		const file = appFiles.find((entry) => entry.path === path);
		expect(file?.code).toMatch(
			/<AnimatedIconSwap\s+stateKey=\{[^}]+\}\s*>\s*\{[^?]+\?\s*\(?\s*<Spinner/,
		);
	});
});
