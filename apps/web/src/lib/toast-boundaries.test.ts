import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks where failures are rendered. The rule: a failure is shown where its cause still
 * has context.
 * - An interaction surface that remains: inline.
 * - An action that disappeared: error toast.
 * - Content lookup on screen: page error state.
 * - Work the user did not start: nothing, unless a dedicated display slot exists.
 *
 * Comments and review do not keep this rule. The code that breaks it is always the shortest at that
 * spot (`catch {}`). It breaks neither compilation nor tests, and it surfaces only when a user
 * presses a button and nothing happens.
 *
 * Four things are guarded:
 * 1. One toast entry point. A screen calling `toast.add(...)` directly re-decides lifetime and
 *    priority there, so errors could vanish after seconds on one screen only.
 * 2. Toast copy is not built here. Passing a caught exception through would expose request URLs,
 *    stacks, or provider internals.
 * 3. No global error handler. Folding failures into a MutationCache onError would duplicate
 *    inline failures as toasts and push background maintenance failures to the user. That layer
 *    cannot tell which is which.
 * 4. The toast must have a place to render. Without a Toaster, showErrorToast renders nothing
 *    and warns nothing.
 *
 * The admin console has the same rule (apps/admin/src/lib/boundaries.test.ts). Each app keeps its
 * own check, because a shared location would require one app to know the other's source paths.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "..");

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

/**
 * Strips comments before scanning. Comments in this repo state each rule by name, so a sentence
 * saying 'toasts are not shown' contains `toast.add` and would flag itself. Rewriting the docs to
 * satisfy the check would reverse cause and effect.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const files = sources(SRC).map((path) => ({
	path: path.slice(SRC.length + 1),
	text: code(readFileSync(path, "utf8")),
}));

/** The only file allowed to touch the toast manager directly. */
const TOAST_ADAPTER = "lib/toast.ts";

describe("failure display boundaries", () => {
	it("there really are files to scan", () => {
		expect(files.length).toBeGreaterThan(100);
	});

	/**
	 * Primitives may be handed to the app in only two places: the adapter, and the root that mounts it
	 * onto the app. If any other screen holds the manager, lifetime and priority diverge per call
	 * site.
	 */
	it("only the adapter and the root import the toast primitive", () => {
		const offenders = files
			.filter((file) => /components\/toast/.test(file.text))
			.map((file) => file.path)
			.filter((path) => path !== TOAST_ADAPTER && path !== "routes/__root.tsx");
		expect(offenders).toEqual([]);
	});

	it("feature code does not add toasts directly", () => {
		const offenders = files
			.filter((file) => /\btoast\.add\s*\(/.test(file.text))
			.map((file) => file.path)
			.filter((path) => path !== TOAST_ADAPTER);
		expect(offenders).toEqual([]);
	});

	/**
	 * Do not pass a caught value as the message. Passing String(error), a template literal, or
	 * error.message leaks internal details and tells the user nothing they can act on. The copy
	 * belongs to each feature's pure module, and unknown failures fall back to that module's default
	 * sentence.
	 */
	it("a caught exception is not put in a toast as is", () => {
		const RAW = /showErrorToast\(\s*(?:String\(|`|.*\.message\b)/;
		const offenders = files
			.filter((file) => RAW.test(file.text))
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * Do not create a global mutation error handler. That layer cannot know whether a dialog already
	 * shows the failure, whether the operation is background maintenance, or whether the caller
	 * swallowed the error on purpose. It would inevitably duplicate or add noise. Where a failure is
	 * shown is a product decision for each feature boundary.
	 */
	it("no global mutation error handler", () => {
		const offenders = files
			.filter((file) => /new MutationCache\s*\(/.test(file.text))
			.map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/** Without it, `showErrorToast` silently renders nothing. */
	it("the root really mounts the Toaster", () => {
		const root = files.find((file) => file.path === "routes/__root.tsx");
		expect(root?.text).toMatch(/<Toaster\s*\/>/);
	});

	/**
	 * Places that were silent for a while, listed explicitly. Each file's comment explains why it uses
	 * its container. The list is pinned because reverting is easy and silent. Removing a single
	 * `showErrorToast` line turns that action back into a button that does nothing, and compilation
	 * and the other tests still pass.
	 */
	it.each([
		["features/social/block-menu.tsx", "unblock (the menu closes immediately)"],
		[
			"features/chat/messages/use-actions.tsx",
			"regenerate the last response (no confirmation)",
		],
		[
			"features/create/editor/use-actions.ts",
			"draft structure changes (single-icon actions)",
		],
		[
			"features/create/create-home-page.tsx",
			"new draft (success leaves the screen)",
		],
		[
			"features/story/use-story-start.tsx",
			"the room was created but navigation failed",
		],
		[
			"features/sync/sync-section.tsx",
			"reissue, untrust and the auto-sync toggle",
		],
		["features/notifications/use-notifications.ts", "mark all read"],
	])("%s fails as a toast — %s", (path) => {
		const file = files.find((entry) => entry.path === path);
		expect(file?.text).toMatch(/showErrorToast\(/);
	});

	/**
	 * The opposite side: places that must show inline do not call a toast. One failure gets one
	 * display. If an open window already renders the message and a toast also appears, the same fact
	 * is shown twice, and assistive technology reads it twice (`role="alert"` plus a high-priority
	 * toast).
	 */
	it.each([
		["features/create/drafts/list.tsx", "the confirmation row stays open"],
		["features/sync/recovery-code-dialog.tsx", "the code stays in the dialog"],
		["features/onboarding/guardian-panel.tsx", "the address stays on screen"],
		["features/chat/room/rename-dialog.tsx", "fails with the dialog open"],
		["features/chat/room/delete-dialog.tsx", "〃"],
		["features/chat/messages/confirm-rewrite-dialog.tsx", "〃"],
		["features/chat/memory/dialog.tsx", "〃"],
		["features/social/block-confirm-dialog.tsx", "〃"],
		[
			"features/create/publishing/lifecycle-controls.tsx",
			"the card stays in place",
		],
		[
			"features/create/publishing/publish-panel.tsx",
			"the section stays in place",
		],
		["features/account/passkeys-section.tsx", "the row and dialog stay"],
		["features/account/sessions-section.tsx", "〃"],
		["features/account/login-methods-section.tsx", "〃"],
		/**
		 * All three persona surfaces stay open after a failure. The form keeps the text that was written,
		 * so the user can retry in place. The delete confirmation stays open. The room settings picker
		 * keeps its list. A toast would appear away from where the user has work to do, and if it
		 * overlapped the inline message, the same fact would be read twice.
		 */
		[
			"features/persona/persona-editor.tsx",
			"the text being written stays in the form",
		],
		["features/persona/persona-dialogs.tsx", "fails with the dialog open"],
		[
			"features/chat/room-settings/persona.tsx",
			"the selection list stays in place",
		],
	])("%s fails inline — %s", (path) => {
		const file = files.find((entry) => entry.path === path);
		expect(file).toBeDefined();
		expect(file?.text).not.toMatch(/showErrorToast\(/);
	});
});
