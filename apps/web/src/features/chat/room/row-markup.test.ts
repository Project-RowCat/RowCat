import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans the markup of screens where one row holds both a link and actions. The usual
 * mistake is putting the menu button inside the link when a full-row link needs a menu button at
 * its right edge. Types pass and it renders, but a button inside an <a> is invalid HTML: the
 * browser repairs the tree (hydration mismatch), screen readers treat it differently per
 * implementation, and what Enter triggers varies.
 *
 * The rule is one thing: actions are siblings of the link. Only that policy is checked, not
 * rendered output, because the web tests here have no React rendering. The scan detects whether
 * nesting was written back in.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..", "..");

/** Screens where a row holds both a link and actions. Add new such screens here. */
const ROW_FILES = [
	join(WEB_SRC, "features", "chat", "room", "recent-chats.tsx"),
	join(WEB_SRC, "features", "chat-library", "chat-library-page.tsx"),
	/** Runtime library rows: the same rule applies (link and actions are siblings). */
	join(
		WEB_SRC,
		"features",
		"conversation-library",
		"runtime-conversation-rows.tsx",
	),
];

/** Elements that must not appear inside a link. Each one is an interactive element by itself. */
const INTERACTIVE = [
	"<button",
	"<Button",
	"<a ",
	"<Link",
	"DropdownMenuTrigger",
	"ContextMenuTrigger",
];

/**
 * Collects the source between each opening <Link ...> and its matching </Link>. Self-closing <Link
 * ... /> is skipped, as it has no content. The first </Link> is the match, because links in these
 * files do not nest (nesting itself is what this test blocks).
 */
function linkBodies(source: string): string[] {
	const bodies: string[] = [];
	let cursor = 0;
	while (true) {
		const open = source.indexOf("<Link", cursor);
		if (open === -1) break;
		const openEnd = source.indexOf(">", open);
		if (openEnd === -1) break;
		cursor = openEnd + 1;
		if (source[openEnd - 1] === "/") continue;
		const close = source.indexOf("</Link>", cursor);
		if (close === -1) break;
		bodies.push(source.slice(cursor, close));
		cursor = close;
	}
	return bodies;
}

describe("there are no actions inside the row link", () => {
	for (const file of ROW_FILES) {
		it(`${file.slice(WEB_SRC.length + 1)}`, () => {
			const source = readFileSync(file, "utf8");
			const bodies = linkBodies(source);
			// If no link was found, the scan is idling, so that is a failure rather than a pass.
			expect(bodies.length).toBeGreaterThan(0);
			for (const body of bodies) {
				for (const token of INTERACTIVE) {
					expect(body).not.toContain(token);
				}
			}
		});
	}
});

/**
 * The other side is checked too: that the path to the actions has not disappeared. The easiest way
 * to satisfy the nesting rule is to delete the buttons outright, which would make these actions
 * non-existent for people who cannot right-click (keyboard, touch). Long-press is only a bonus of
 * the primitive and cannot be the sole path.
 */
describe("a sidebar row opens the same menu two ways", () => {
	const source = readFileSync(ROW_FILES[0] as string, "utf8");

	it("right click (context menu)", () => {
		expect(source).toContain("ContextMenuTrigger");
		expect(source).toContain("ContextMenuContent");
	});

	it("the visible overflow trigger", () => {
		expect(source).toContain("DropdownMenuTrigger");
		expect(source).toContain("roomActionsLabel");
	});

	/**
	 * Touch has no hover. If the trigger is not always visible on coarse pointers, these actions are
	 * usable on mobile only by people who know to long-press.
	 */
	it("always visible on coarse pointers", () => {
		expect(source).toContain("pointer-coarse:opacity-100");
	});

	/**
	 * The menu items are one component used by both shells; the test asserts exactly two uses.
	 * Per-shell copies would drift apart.
	 */
	it("both containers use the same item component", () => {
		const uses = source.split("<RoomContextActionsContent").length - 1;
		expect(uses).toBe(2);
	});
});
