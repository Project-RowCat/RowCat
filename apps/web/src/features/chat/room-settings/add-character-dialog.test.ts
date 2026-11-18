import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CHAT_CHARACTER_MAX_PER_ROOM,
	ChatCharacterLimitError,
} from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import { characterSaveFailureMessage } from "./character-copy.ts";

/**
 * The composer's quick add for the cast: **a second door to the same record.**
 *
 * What must hold is that it is only a door — the settings pane's form, the store's one write and
 * the same failure sentence. A second copy of any of them shows no symptom on its own screen; it
 * shows up later as two doors that disagree (a limit one door forgot, a sentence only one door
 * says). Web tests here do not render React, so the wiring is checked by the shape of the source.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Source with comments removed, so a sentence recording a rationale cannot satisfy a check. */
const codeOf = (file: string): string =>
	readFileSync(join(HERE, file), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1")
		.replaceAll(/\s+/g, " ");

describe("a failed write says one thing from either door", () => {
	/** The cap is the one failure the person can act on, so it names the number. */
	it("the cap names the limit", () => {
		expect(
			characterSaveFailureMessage(new ChatCharacterLimitError()),
		).toContain(String(CHAT_CHARACTER_MAX_PER_ROOM));
	});

	it("anything else asks to try again, not the cap's sentence", () => {
		const other = characterSaveFailureMessage(new Error("quota"));
		expect(other).not.toBe(
			characterSaveFailureMessage(new ChatCharacterLimitError()),
		);
		expect(other).not.toContain(String(CHAT_CHARACTER_MAX_PER_ROOM));
	});

	it("the settings pane folds its failures through the same function", () => {
		const pane = codeOf("characters.tsx");
		expect(pane).toContain("characterSaveFailureMessage(failure)");
		expect(pane).not.toContain('t("characters.couldnTSaveTheCharacter")');
	});
});

describe("the quick add is only a door", () => {
	const dialog = codeOf("add-character-dialog.tsx");

	it("draws the settings pane's form, not a copy", () => {
		expect(dialog).toContain(
			'import { CharacterForm } from "./characters.tsx"',
		);
		expect(dialog).not.toContain("<Input");
		expect(dialog).not.toContain("<Textarea");
	});

	/** The same write as the pane, so the record that lands is the one settings would have made. */
	it("writes through the store's one create, into this room", () => {
		expect(dialog).toContain("store.createCharacter({ roomId, ...values })");
		expect(dialog).toContain("characterSaveFailureMessage(failure)");
	});

	/**
	 * Closing returns focus to the sentence being written only if the window recorded it. The form's
	 * own autofocus would move focus before that record, and the symptom is quiet: focus lands on the
	 * page and the person has to click back into the input.
	 */
	it("leaves focus to the window, so closing returns it", () => {
		expect(dialog).toContain("autoFocus={false}");
		expect(codeOf("characters.tsx")).toContain("autoFocus={autoFocus}");
	});

	/**
	 * Whether the room is full is known on the first frame and not followed afterwards. A late answer
	 * swaps the form out after the window chose what to focus; a live one can swap out a card being
	 * typed when sync brings characters in.
	 */
	it("decides the cap once, as it opens", () => {
		expect(dialog).toMatch(
			/useState\(\s*\(\) => characterCount >= CHAT_CHARACTER_MAX_PER_ROOM,?\s*\)/,
		);
		expect(dialog).not.toContain("useLocalCharacters");
		expect(codeOf("../chat-page.tsx")).toContain(
			"characterCount={characters.length}",
		);
	});

	/** A write started under one account must not land in the next one's database. */
	it("checks ownership just before the write", () => {
		expect(dialog).toContain("!ownsStore(store)");
	});

	/** Typed text is lost on close, so an outside press does not close it and a running save holds it. */
	it("closes only by an explicit choice", () => {
		expect(dialog).toContain("shouldCloseDialog(details.reason, pending)");
		expect(dialog).toContain("closeButtonDisabled={pending}");
	});

	/**
	 * The window lives only while its room does. If the room leaves this device's database, a window
	 * still open would write a character for a room that is gone.
	 */
	it("the conversation screen draws it only while the room exists", () => {
		expect(codeOf("../chat-page.tsx")).toContain(
			"{room && addingCharacter && (",
		);
	});
});
