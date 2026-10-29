import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUNTIME_PLAYER_COPY } from "./runtime-player-copy.ts";

/**
 * Checks that the runtime player's generation settings are actually wired, and that they do not
 * pull in the chat room's vocabulary.
 *
 * This app lived for a long time without this dialog, and the absence produced no symptom: the
 * store already had `setRuntime` and the player adapter already read `getRuntime`, so only the
 * writing screen was missing. Values picked on a Mac never reached this device (device preferences
 * do not sync), so an app-only user stayed stuck on the global default with no way to know it.
 *
 * This app's tests do not render screens, so they check wiring, not render output. Source
 * inspection answers that (the web's `runtime-playtest-branch.test.ts` has the same shape).
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const code = (...parts: string[]) =>
	stripComments(readFileSync(join(HERE, ...parts), "utf8"));

describe("storage key", () => {
	// Blocks the most expensive mistake by value.
	//
	// Calling `setGlobal` would make one story's setting the default for all of that person's
	// conversations. Calling `setRoom` would put a story id where a room id belongs, leaving a row
	// that belongs to no room. Both pass the type checker (all three take the same preference shape),
	// and the screen looks like the save succeeded; the value even persists when the dialog is
	// reopened.
	it("uses only the story's override", () => {
		const dialog = code("runtime-generation-settings-dialog.tsx");
		expect(dialog).toContain("store.setRuntime(storyId,");
		expect(dialog).not.toContain("setGlobal");
		expect(dialog).not.toContain("setRoom");
		expect(dialog).not.toContain("clearRoom");
	});

	// There is one resolver for inherited values. If this hook subscribed to `getGlobal` itself,
	// precedence would be resolved in two places, and the mismatch would appear only as the value
	// inside `Use default (Standard)` differing from what is actually sent.
	it("doesn't reassemble the upper layers", () => {
		const hook = code("use-runtime-generation-state.ts");
		expect(hook).toContain("useGlobalGenerationState");
		expect(hook).toContain("store.getRuntime(storyId)");
		expect(hook).not.toContain("getGlobal");
	});
});

describe("doesn't bring in the conversation room's vocabulary", () => {
	// There is no response-length control. The runtime's output cap is set by the creator's request
	// (`maxOutputCharacters`), so the control does not appear, and no sentence describing it is kept:
	// if a sentence existed, the next person would build a control to match it. The web's same dialog
	// made the same decision.
	it("there's no response length control", () => {
		const dialog = code("runtime-generation-settings-dialog.tsx");
		expect(dialog).not.toContain("RESPONSE_LENGTH_FIELD");
		expect(dialog).not.toContain("responseLength");
		expect(dialog).not.toContain("RESPONSE_LENGTHS");
	});

	// The room's vocabulary is absent from this dialog. Memory, persona, characters, search, and
	// rename belong to `ChatRoom`; any one of them would become a button that does nothing when
	// pressed.
	it("no room operation vocabulary", () => {
		const dialog = code("runtime-generation-settings-dialog.tsx");
		for (const forbidden of [
			"ChatStore",
			"ChatRoom",
			"roomId",
			"createRoom",
			"ROOM_SETTINGS_IA",
			"RoomSettings",
		])
			expect(dialog, forbidden).not.toContain(forbidden);
	});

	// The sentence for an unavailable target also uses this screen's subject. This slice keeps the
	// fact that a runtime playthrough is not a conversation, and a single sentence must not break that
	// boundary.
	it("passes the subject of the unavailability reason", () => {
		const dialog = code("runtime-generation-settings-dialog.tsx");
		expect(dialog).toContain("unavailableSubject");
		expect(dialog).toContain('unavailableSubject: "this story"');
	});
});

describe("the header's overflow menu", () => {
	const screen = () => code("runtime-chat-screen.tsx");

	// The three actions go through one overflow menu, and the width is the reason.
	//
	// The chat room header deliberately has no overflow menu, and that decision stands (a static scan
	// locks it in `chat-screen.tsx` only). This screen differs for a reason of width: expanding the
	// three actions makes five targets, which exceeds the budget `AppBar` records as a value (320pt
	// with four targets leaves 88pt for the title), and the title is this screen's only identity.
	it("stands one overflow instead of spreading icons", () => {
		const source = screen();
		expect(source).toContain("<DropdownMenu");
		expect(source).not.toContain("<IconButton");
	});

	// Navigation comes first. The web's pill uses the same order: the action that leaves the screen, a
	// different kind of action, stands above the operations.
	it("story details is the first row and goes to the details", () => {
		const source = screen();
		const detail = source.indexOf("RUNTIME_PLAYER_COPY.storyDetail");
		const settings = source.indexOf("RUNTIME_PLAYER_COPY.generationSettings");
		expect(detail).toBeGreaterThan(-1);
		expect(detail).toBeLessThan(settings);
		expect(source).toContain('pathname: "/stories/[storyId]"');
	});

	// The condition is the capability, not the session. It must stand even while the AI notice is
	// showing: the person has to choose the model **before** agreeing, and the notice's "current AI
	// settings" is exactly that setting. Writing `running` as the condition would remove that moment.
	it("the generation settings row splits by capability", () => {
		const source = screen();
		const gate = source.indexOf("player.usesGeneration ? (");
		expect(gate).toBeGreaterThan(-1);
		expect(
			source.indexOf("RUNTIME_PLAYER_COPY.generationSettings"),
		).toBeGreaterThan(gate);
	});

	// Reset still uses the session as its condition and stands below the separator. An irreversible
	// action is not offered first on a screen that could not start a session, and when the row is
	// absent the separator folds with it (a separator alone is never left behind).
	it("reset is destructive and folds with a divider", () => {
		const source = screen();
		const gate = source.indexOf("running ? (");
		expect(gate).toBeGreaterThan(-1);
		const separator = source.indexOf("<MenuSeparator />", gate);
		const reset = source.indexOf("RUNTIME_PLAYER_COPY.resetPlaythrough", gate);
		expect(separator).toBeGreaterThan(gate);
		expect(reset).toBeGreaterThan(separator);
		expect(source).toContain("destructive");
	});

	// Opening the dialog does not interrupt playback: no line in this wiring touches the session.
	it("the dialog doesn't touch the session", () => {
		const source = screen();
		expect(source.indexOf("setSettingsOpen(true)")).toBeGreaterThan(-1);
		expect(source).not.toContain("player.stop");
		expect(source).not.toContain("dispose()");
	});
});

describe("copy", () => {
	// The trigger and the dialog title come from one value. Two values would diverge the day only one
	// of them changes, and the button pressed would not match the dialog that opens. Parity with the
	// web is checked separately (`runtime-player-copy-parity.test.ts`).
	it("the title and the trigger are one value", () => {
		expect(RUNTIME_PLAYER_COPY.generationSettings).toBe("Generation settings");
		const dialog = code("runtime-generation-settings-dialog.tsx");
		expect(dialog).toContain("RUNTIME_PLAYER_COPY.generationSettings");
	});

	// The footnote states how this differs from the session. The AI permission is fixed for this
	// playthrough, but the target is read again for every request. Without saying so, someone who
	// changes the model cannot tell whether a restart is needed.
	it("says when it takes effect", () => {
		const dialog = code("runtime-generation-settings-dialog.tsx");
		expect(dialog).toContain("from the next generation request");
		expect(dialog).toContain("only on this device");
	});
});
