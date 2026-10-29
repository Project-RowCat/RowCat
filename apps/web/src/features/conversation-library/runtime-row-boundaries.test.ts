import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { chatLibrary } from "#/lib/i18n/messages/en/chat-library.ts";

/**
 * Static scan: runtime library rows must not receive room actions.
 *
 * The likely mistake is two row kinds in one list starting to share a menu. If room actions
 * (rename, settings, delete, persona, model override, find) reach a runtime row, they either do
 * nothing or open a dialog for a room that does not exist. Playthrough reset stays out of the list
 * because it is a trusted action of the playtest screen.
 */
const read = (path: string): string =>
	readFileSync(new URL(path, import.meta.url), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

const files = (): { name: string; text: string }[] =>
	readdirSync(new URL(".", import.meta.url))
		.filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
		.map((name) => ({ name, text: read(`./${name}`) }));

describe("runtime library rows", () => {
	test("the files to scan exist", () => {
		expect(files().map((f) => f.name)).toContain(
			"runtime-conversation-rows.tsx",
		);
	});

	test("does not import room operations, store or management hooks", () => {
		for (const file of files())
			for (const forbidden of [
				/\buseRoomManagement\b/,
				/\bRoomActionsMenu\b/,
				/\bRoomContextActionsContent\b/,
				/\bROOM_ACTIONS\b/,
				/\bManagedRoom\b/,
				/\bChatStore\b/,
				/\bcreateRoom\b/,
				/\brenameRoom\b/,
				/\bdeleteRoom\b/,
				/\bsetRoomPersona\b/,
				/\bRename\b/,
				/Conversation settings/,
				/Delete conversation/,
				/[Pp]ersona/,
				/Find in conversation/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
	});

	test("does not open play reset or long-progress reset from the list", () => {
		for (const file of files())
			for (const forbidden of [
				/resetPlaythrough/,
				/resetPersistent/,
				/Reset play/,
				/\bputPlaythrough\b/,
				/\bputPersistent\b/,
				/\buseRuntimeSaveScope\b/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
	});

	test("the removal wording does not say progress is erased", () => {
		const copy = chatLibrary.runtime.remove;
		expect(copy).toMatch(/Remove from list/);
		expect(copy).not.toMatch(/delet/i);
	});

	test("a runtime row goes to the runtime playback address", () => {
		const rows = read("./runtime-conversation-rows.tsx");
		expect(rows).toMatch(/"\/chat\/runtime\/\$storyId"/);
		expect(rows).not.toMatch(/"\/chat\/\$roomId"/);
	});
});
