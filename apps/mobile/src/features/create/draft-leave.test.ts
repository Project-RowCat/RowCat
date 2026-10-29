import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldBlockLeave } from "./draft-leave.ts";
import type { AutosaveStatus } from "./use-draft-autosave.ts";

/**
 * Whether leaving is allowed. Both mistakes are silent: blocking too often shows a confirmation
 * after every edit (which soon goes unread), and blocking too rarely loses edits the screen already
 * reported as unsaved.
 */

const STATUSES: AutosaveStatus[] = [
	"idle",
	"pending",
	"saving",
	"saved",
	"error",
];

describe("navigation blocking", () => {
	/** Blocks only when both hold: the save failed and edits are still pending. */
	it("blocks only when edits are pending behind a confirmed failure", () => {
		expect(shouldBlockLeave({ status: "error", pending: true })).toBe(true);
	});

	/** Ordinary saving does not block: nothing has failed, and the final flush usually succeeds. */
	it.each(
		STATUSES.filter((status) => status !== "error"),
	)("%s doesn't block even with pending edits", (status) => {
		expect(shouldBlockLeave({ status, pending: true })).toBe(false);
	});

	/**
	 * A failure with no pending edit leaves nothing to lose (the change was discarded or already
	 * written), so blocking would force a choice over nothing.
	 */
	it("without pending edits it doesn't block even on failure", () => {
		expect(shouldBlockLeave({ status: "error", pending: false })).toBe(false);
	});
});

/**
 * A rule existing does not mean it is applied, so this block statically checks which navigations
 * the guard covers (the judgment itself is checked by value elsewhere in this file). The
 * regressions it guards are all silent:
 * - The interception disappears: a hardware back press drops a failed edit at once.
 * - Feature code writes its own handler: BackHandler is blind to the iOS swipe and router
 *   navigation.
 * - The latch disappears: `Leave without saving` becomes a dead button.
 * - The editor body subscribes: every save re-renders the whole tree.
 */
describe("the interception's wiring", () => {
	const SRC = fileURLToPath(new URL("../..", import.meta.url));
	const stripComments = (text: string): string =>
		text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	const read = (path: string): string =>
		stripComments(readFileSync(join(SRC, path), "utf8"));

	const guard = read("lib/navigation/leave-guard.tsx");
	const editor = read("features/create/draft-editor-screen.tsx");

	/**
	 * The router treats three paths as one event: hardware back, the iOS edge swipe, and navigation
	 * the app starts. One blocking point means they cannot diverge.
	 */
	it("the navigation layer intercepts the router's removal", () => {
		expect(guard).toContain("usePreventRemove");
		expect(guard).toContain('from "expo-router/react-navigation"');
	});

	/**
	 * Does not use BackHandler: it only sees Android back, so protection built on it would apply
	 * differently per platform. The presentation policy already bans the name in feature code; this
	 * also checks the navigation layer.
	 */
	it("not written with BackHandler", () => {
		expect(guard).not.toContain("BackHandler");
		expect(editor).not.toContain("BackHandler");
	});

	/** The editor actually installs the guard; a rule with no wiring blocks nothing. */
	it("the editor sets up the guard", () => {
		expect(editor).toContain("<EditorLeaveGuard");
		expect(editor).toContain("shouldBlockLeave(snapshot)");
	});

	/**
	 * The latch: right after clearing the queue, the router still holds the previous render's
	 * decision. A navigation issued now would be blocked again and reopen the dialog just closed, so
	 * `Leave without saving` would look dead.
	 */
	it("doesn't block after deciding to leave", () => {
		expect(editor).toContain("!leaving && shouldBlockLeave(snapshot)");
		expect(editor).toContain("if (leaving) leaveRef.current();");
	});

	/**
	 * Navigation runs in an effect: calling it from the handler would run before the latch above is
	 * committed. The effect depends on the latch alone; a caller's function in its deps would re-send
	 * the navigation on every render while the latch is up.
	 */
	it("discard and retry only raise the latch", () => {
		const discard =
			/const discard = useCallback\(\(\) => \{([\s\S]*?)\}, \[/.exec(
				editor,
			)?.[1];
		expect(discard).toBeDefined();
		expect(discard).toContain("autosave.discard();");
		expect(discard).toContain("setLeaving(true);");
		expect(discard).not.toContain("leave()");
		expect(editor).toMatch(/\}, \[leaving\]\);/);
	});

	/**
	 * Does not trap. An escape hatch such as "ignore and leave" would eventually become the dialog's
	 * default action, and then this layer protects nothing. The only exit is making `blocked` false.
	 */
	it("the navigation layer has no escape hatch", () => {
		expect(guard).not.toMatch(/dispatch|navigation\.|router\./);
		expect(guard).toContain("usePreventRemove(blocked, onBlocked);");
	});

	/**
	 * The leaf subscribes alone. If the editor body subscribed to save status, the `pending → saving →
	 * saved` cycle every 500ms would re-render the whole tree three times, and that render's only
	 * result is this one boolean.
	 */
	it("the editor body doesn't subscribe to the save state", () => {
		const body = editor.slice(
			editor.indexOf("function EditorBody"),
			editor.indexOf("function EditorLeaveGuard"),
		);
		expect(body).not.toContain("useAutosaveState");
	});

	/**
	 * One owner for this wiring. If each screen began intercepting removal, one of them would forget
	 * the latch and trap the user.
	 */
	it("one file defines the interception", () => {
		const sources = (dir: string, files: string[] = []): string[] => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) sources(full, files);
				else if (/\.tsx?$/.test(entry.name)) files.push(full);
			}
			return files;
		};
		const callers = sources(SRC)
			.map((path) => ({
				path: path.slice(SRC.length),
				text: stripComments(readFileSync(path, "utf8")),
			}))
			.filter((file) => !/\.test\.tsx?$/.test(file.path))
			.filter((file) => /\busePreventRemove\(/.test(file.text))
			.map((file) => file.path);
		expect(callers).toEqual(["lib/navigation/leave-guard.tsx"]);
	});
});
