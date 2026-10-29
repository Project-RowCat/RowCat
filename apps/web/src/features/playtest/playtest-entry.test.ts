import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FileRouteTypes } from "#/routeTree.gen";

/**
 * Checks that there is one entry point into the test.
 *
 * The order (flush unsaved edits, storage, read draft, assemble, ownership, navigate) lives in a
 * pure function, which is verified by value (`start-draft-playtest.test.ts`). This test checks that
 * the function is actually used. If a second entry point appeared, one of them would skip the
 * autosave flush, and that screen would start a test without the sentence just typed.
 *
 * The web tests in this repo do not render React, so what is checked is the wiring. The wiring can
 * be read from the source.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

const read = (...parts: string[]) =>
	readFileSync(join(WEB_SRC, ...parts), "utf8");

const editor = () => read("features", "create", "editor", "page.tsx");
const button = () => read("features", "playtest", "start-playtest-button.tsx");

describe("the editor's entry", () => {
	it("the editor has the `Story test` action", () => {
		expect(editor()).toContain("StartPlaytestButton");
		expect(button()).toContain('t("startPlaytestButton.storyTest")');
	});

	/**
	 * Passes the autosave handle through unchanged. If the editor flushed beforehand instead of
	 * handing it over, the rule 'do not proceed if saving fails' would scatter across call sites.
	 */
	it("takes the autosave handle and passes it to the order function", () => {
		expect(editor()).toContain("autosave={autosave}");
		expect(button()).toContain("flushAutosave: autosave.flush");
	});

	/** The component does not restate the ordering; it calls that one function. */
	it("the component does not re-write the order", () => {
		const source = button();
		expect(source).toContain("startDraftPlaytest");
		expect(source).not.toContain("loadPublicationSource");
		expect(source).not.toContain("buildPlaytestSnapshot");
	});

	/**
	 * Must not sit inside the publish section. This action sends nothing to the server, and that
	 * should be readable in place. Placed next to publish, it would invite the question `do I have to press test to
	 * publish?`.
	 */
	it("is not inside the publish section", () => {
		expect(
			read("features", "create", "publishing", "publish-panel.tsx"),
		).not.toContain("Playtest");
	});
});

describe("address", () => {
	/**
	 * The route id is tied to the real route tree at compile time. Moving the file changes the id
	 * silently. Assigning it to the generated route type makes `pnpm typecheck` reject the move
	 * immediately.
	 */
	const ID = "/(app)/create/$draftId_/test" satisfies FileRouteTypes["id"];
	const PATH = "/create/$draftId/test" satisfies FileRouteTypes["fullPaths"];

	it("the button navigates to that address", () => {
		expect(button()).toContain(`to: "${PATH}"`);
	});

	/**
	 * Not a child of the editor route (note the trailing underscore in the folder name). As a child,
	 * the editor tree would stay alive behind the test screen, along with its autosave hook and
	 * subscriptions.
	 */
	it("is not a child of the editor route", () => {
		expect(ID).toContain("$draftId_");
	});
});
