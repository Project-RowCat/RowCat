import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks what reply suggestions must not do into the shape of the code; web's same-named test does
 * the same.
 *
 * Value tests cannot catch these. None of the four below raises an error, fails to compile, or
 * looks wrong on screen; instead something the user did not do lands in their conversation, or one
 * paid operation becomes two.
 *
 * ```text
 * sends the chosen sentence directly   a model-written line becomes the user's utterance unread
 * stores the result                    not being stored is this slice's premise
 * re-states the rules here             window, count and availability belong to `@rowcat/chat`
 * rebuilds the transport               the BYO privacy wiring lives only in `utility-generation.ts`
 * ```
 *
 * Comments are excluded from the scan: this folder's comments contain those words, explaining why
 * they are not done here.
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
	it("the folder isn't empty — prevents the scan from quietly seeing nothing", () => {
		expect(FILES.length).toBeGreaterThan(0);
	});

	/* Picking fills the composer; the person must press send themselves. */
	it.each(FILES)("%s doesn't create a user line", (file) => {
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

	/* The result lives only in hook state: not in the store, codec or server. */
	it.each(FILES)("%s doesn't store the result", (file) => {
		const code = codeOf(file);
		for (const forbidden of [
			"MobileDatabase",
			"SQLite",
			"AsyncStorage",
			"SecureStore",
			"syncNow",
			"registerCodec",
		])
			expect(code).not.toContain(forbidden);
	});

	/* Window, count and availability are shared rules; restating them here would let the apps diverge. */
	it.each(FILES)("%s doesn't rewrite the shared rules", (file) => {
		const code = codeOf(file);
		expect(code).not.toMatch(/\.slice\(\s*-\d/);
		expect(code).not.toContain("suggestions.length ===");
	});
});
