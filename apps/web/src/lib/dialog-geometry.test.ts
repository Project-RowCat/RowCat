import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every dialog stays inside the screen height.
 *
 * The reason for this check is the shape of the failure. A `DialogContent` with no vertical bound
 * shows no symptom when its content is short, and raises no error when content overflows. It simply
 * stands there cut off at top and bottom. Because it is `position: fixed`, page scrolling cannot
 * reach the clipped part, and the clipped part is usually the bottom row, so the user can no longer
 * act in that dialog.
 *
 * The check blocks a commit that adds a horizontal bound (`sm:max-w-*`) and forgets the vertical
 * one. Two ways pass:
 * - Centered box: DIALOG_VIEWPORT_BOUND (max-h plus overflow-y-auto).
 * - Bottom sheet: its own max-h-[...dvh], with a scroll region inside.
 *
 * The check targets the source, not the value. A box that hand-writes `max-h-[calc(100dvh-2rem)]`
 * is rejected too, because that copy would keep an old policy alive when the policy changes.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** All `.tsx` files in the app, so the check does not assume where dialogs will live. */
const sources = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sources(path);
		return path.endsWith(".tsx") ? [path] : [];
	});

/** Strips comments, so a sentence recording a rationale cannot make the check pass by accident. */
const codeOf = (path: string): string =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

/**
 * Cuts out only the opening tag of `<DialogContent ...>`. Its children are not part of this check.
 */
const openTags = (code: string): string[] => {
	const found: string[] = [];
	let at = code.indexOf("<DialogContent");
	while (at !== -1) {
		const end = code.indexOf(">", at);
		found.push(code.slice(at, end === -1 ? code.length : end + 1));
		at = code.indexOf("<DialogContent", at + 1);
	}
	return found;
};

describe("dialog vertical bounds", () => {
	it("every centered dialog goes through the shared constant", () => {
		const offenders: string[] = [];
		for (const path of sources(SRC)) {
			for (const tag of openTags(codeOf(path))) {
				/*
				 * A bottom-anchored sheet and a left drawer already bound their height through their own
				 * geometry (`max-h-[85dvh]`, `h-dvh`). An outer scroll container on top would create two scroll
				 * containers.
				 */
				if (/max-h-\[[^\]]*dvh\]|h-dvh/.test(tag)) continue;
				if (tag.includes("DIALOG_VIEWPORT_BOUND")) continue;
				offenders.push(
					`${path.slice(SRC.length)}: ${tag.replace(/\s+/g, " ")}`,
				);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("the constant holds containment and scrolling **together**", async () => {
		/*
		 * Each half fails differently on its own. `max-h` alone clips the overflow with no way to reach
		 * it. `overflow-y-auto` alone does not stop the box from growing past the screen, so no scrolling
		 * appears either.
		 */
		const { DIALOG_VIEWPORT_BOUND } = await import("./dialog-geometry.ts");
		expect(DIALOG_VIEWPORT_BOUND).toContain("max-h-[calc(100dvh-2rem)]");
		expect(DIALOG_VIEWPORT_BOUND).toContain("overflow-y-auto");
	});
});
