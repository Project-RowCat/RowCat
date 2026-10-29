import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	ensurePromptPack,
	hasPromptPack,
	PROMPT_PACK_KEYS,
	PROMPT_PACKS_AVAILABLE,
	promptPackBody,
} from "./index.ts";

const packsDir = fileURLToPath(new URL("./packs", import.meta.url));
/** The public release has no `packs/` folder at all (git keeps no empty folders), and that is a complete state. */
const packFiles = existsSync(packsDir)
	? readdirSync(packsDir).filter((name) => name.endsWith(".ts"))
	: [];

/**
 * This file pins one fact: the table and the files are paired.
 *
 * A commit that forgets to update the table passes types and tests. Adding a file without a table line
 * leaves its key uncalled; removing a file leaves the loader pointing at a missing module. The second is
 * worse: only users who chose that combination get a conversation with no pack on every turn, and no
 * error appears on screen.
 */
describe("pack key table", () => {
	it("the loader table and the pack files pair exactly", () => {
		const fromLoaders = [...PROMPT_PACK_KEYS]
			.map((key) => `${key.replaceAll(":", "-")}.ts`)
			.sort();
		expect(fromLoaders).toEqual([...packFiles].sort());
	});

	it("availability is the table having any key", () => {
		expect(PROMPT_PACKS_AVAILABLE).toBe(PROMPT_PACK_KEYS.length > 0);
	});

	it("unknown keys answer absent rather than throwing", async () => {
		expect(hasPromptPack("hedge:basic")).toBe(false);
		expect(hasPromptPack("nope:basic:sim")).toBe(false);
		await expect(ensurePromptPack("nope:basic:sim")).resolves.toBe("");
		expect(promptPackBody("nope:basic:sim")).toBe("");
	});
});

/**
 * The public release ships no bodies (`docs/chat/NARRATION.md` §공개본), so everything below stands only
 * in a build that carries them. They are kept rather than deleted because each one breaks a silence that
 * comes back the day bodies return: a partial set, a body that never fills, a renamed fold block.
 */
describe.skipIf(!PROMPT_PACKS_AVAILABLE)("pack bodies", () => {
	/**
	 * The count is pinned as a value: 3 families x 4 ranges x 2 character DB settings = 24. A build that
	 * carries only some of them makes some combinations silently pack-less.
	 */
	it("3 lineages · 4 scopes · 2 character DB options = twenty-four", () => {
		expect(PROMPT_PACK_KEYS).toHaveLength(24);
		for (const family of ["hedge", "thumbs", "deepseek"])
			for (const mode of ["basic", "anti", "imp", "auto"])
				for (const cast of ["compact", "sim"])
					expect(hasPromptPack(`${family}:${mode}:${cast}`)).toBe(true);
	});

	/**
	 * Empty until filled. This must be pinned as a value so that a caller that skipped passing the
	 * body to the assembler, creating a 'pack missing only on the first turn' defect, is caught as a
	 * rule violation.
	 */
	it("the synchronous lookup is empty before loading", async () => {
		const key = PROMPT_PACK_KEYS[0] as string;
		expect(promptPackBody(key)).toBe("");
		const body = await ensurePromptPack(key);
		expect(body.length).toBeGreaterThan(1_000);
		expect(promptPackBody(key)).toBe(body);
	});

	it("requesting the same key concurrently loads it once", async () => {
		const key = PROMPT_PACK_KEYS[1] as string;
		const [a, b] = await Promise.all([
			ensurePromptPack(key),
			ensurePromptPack(key),
		]);
		expect(a).toBe(b);
	});

	/**
	 * The body's fidelity to the original cannot be checked by value; no original is in this repo to
	 * compare against. Instead the test pins only that the port is intact: the substitution
	 * placeholders survive, and each key is genuinely different text.
	 */
	it("bodies are intact: placeholders survive and differ per key", async () => {
		const bodies = await Promise.all(
			[...PROMPT_PACK_KEYS].map((key) => ensurePromptPack(key)),
		);
		for (const body of bodies) {
			expect(body).toContain("{{user}}");
			expect(body).toContain("{{char}}");
			expect(body.length).toBeGreaterThan(15_000);
		}
		expect(new Set(bodies).size).toBe(PROMPT_PACK_KEYS.length);
	});

	/**
	 * Parser trigger. `@rowcat/chat`'s tracking-block.ts strips blocks only by these two names. If a
	 * body update renames them, that parser silently removes nothing, and every response in a
	 * conversation with the pack enabled shows the tags and internal state as text, with no error or
	 * warning. This test breaks that silence.
	 */
	it("bodies use exactly two fold block names", () => {
		const labels = new Set<string>();
		for (const name of packFiles) {
			const source = readFileSync(`${packsDir}/${name}`, "utf8");
			for (const match of source.matchAll(/<summary>([^<]*)<\/summary>/g))
				labels.add(match[1] as string);
		}
		expect([...labels].sort()).toEqual(["Character Database", "Logic"]);
	});

	/**
	 * Pins the identity of the character DB axis as a value: `sim` is the variant with one extra
	 * character panel. This fact is the basis of the screen copy (one more character card appears), and
	 * only this test can confirm that the copy is true.
	 */
	it("only sim instructs the character card block", () => {
		for (const name of packFiles) {
			const source = readFileSync(`${packsDir}/${name}`, "utf8");
			expect(source.includes("<summary>Character Database</summary>")).toBe(
				name.endsWith("-sim.ts"),
			);
		}
	});
});
