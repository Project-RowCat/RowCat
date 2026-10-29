import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks in, by code shape, what reply suggestions must NOT do. Value tests cannot catch these: none
 * raises an error, each compiles, and the screen looks fine, yet the user's conversation gains
 * something they did not do, or one paid action becomes two.
 *
 * - Sending a picked sentence directly: the model's text would become the user's utterance before
 *   they read it.
 * - Saving results: nothing is persisted, which is this slice's premise. Saving would make
 *   suggestions a fifth kind of child record on the room, with sync, tombstones and merging, for
 *   values nobody re-reads.
 * - Restating shared rules: window length, count and availability belong to @rowcat/chat, which
 *   mobile calls too. A local copy would diverge on one side only.
 *
 * Comments are excluded from the scan: this folder's comments contain those words while explaining
 * why they are not done.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const FILES = readdirSync(HERE).filter(
	(file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
);

const codeOf = (file: string): string =>
	readFileSync(join(HERE, file), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

describe("reply suggestion boundaries", () => {
	it("the folder is not empty, so the scan cannot silently look at nothing", () => {
		expect(FILES.length).toBeGreaterThan(0);
	});

	/**
	 * Between picking and sending there must be a point where a person presses again. The only
	 * operation this folder knows is onPick, which fills the input.
	 */
	it.each(FILES)("%s makes no utterance", (file) => {
		const code = codeOf(file);
		for (const forbidden of [
			"appendMessage",
			"appendUserMessage",
			"generation.send",
			"commitUserTurn",
			"createRoom",
		])
			expect(code).not.toContain(forbidden);
	});

	/**
	 * Results live only in the hook's state. Neither the store, a codec, nor the server touches them.
	 */
	it.each(FILES)("%s stores no result", (file) => {
		const code = codeOf(file);
		for (const forbidden of [
			"dexie",
			"Dexie",
			"localStorage",
			"sessionStorage",
			"syncNow",
			"registerCodec",
		])
			expect(code).not.toContain(forbidden);
	});

	/**
	 * Window length, count, caps and availability are shared rules. Re-typing the numbers here would
	 * let the two apps read different conversations and show the button under different conditions.
	 */
	it.each(FILES)("%s does not re-write the shared rule", (file) => {
		const code = codeOf(file);
		expect(code).not.toMatch(/\.slice\(\s*-\d/);
		expect(code).not.toContain("suggestions.length ===");
	});
});
