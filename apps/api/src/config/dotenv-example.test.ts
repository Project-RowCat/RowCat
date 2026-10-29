import { describe, expect, test } from "vitest";
import {
	activeEntries,
	documentedKeys,
	duplicateActiveKeys,
	parseDotenvExample,
} from "./dotenv-example.ts";

/**
 * The example-file parser reads only syntax the committed example actually uses and guesses nothing
 * beyond it; the other half is the rule separating settings from prose.
 */

describe("tells assignments from comments", () => {
	test("an empty value is still a setting slot", () => {
		const parsed = parseDotenvExample("BETTER_AUTH_SECRET=\n");
		expect(parsed.entries).toEqual([
			{ key: "BETTER_AUTH_SECRET", value: "", kind: "active", line: 1 },
		]);
	});

	test("a commented-out assignment is a documented key too", () => {
		const parsed = parseDotenvExample("# AUTH_COOKIE_DOMAIN=.example.com\n");
		expect([...documentedKeys(parsed)]).toEqual(["AUTH_COOKIE_DOMAIN"]);
		expect(activeEntries(parsed)).toEqual([]);
	});

	/**
	 * Prose containing `=` really exists (`# SMTP. HOST is required for `smtp`. PORT empty = 587 (STARTTLS); for 465, also`);
	 * counting it as a setting would invent keys.
	 */
	test("a prose comment containing = is not a setting slot", () => {
		const parsed = parseDotenvExample(
			"# Local default: http://localhost:3002 · production differs\n# the value = goes here\n",
		);
		expect(parsed.entries).toEqual([]);
		expect(parsed.invalid).toEqual([]);
	});

	test("blank lines and prose produce nothing", () => {
		const parsed = parseDotenvExample("\n\n# just a note\n\n");
		expect(parsed.entries).toEqual([]);
		expect(parsed.invalid).toEqual([]);
	});
});

describe("reading values", () => {
	test("splits at the first = even when the value contains =", () => {
		const parsed = parseDotenvExample("OTA_CI_CHANNELS=a:1,b=2\n");
		expect(parsed.entries[0]?.value).toBe("a:1,b=2");
	});

	test("strips quotes", () => {
		const parsed = parseDotenvExample(`MAIL_FROM="RowCat <a@b.c>"\nX='y'\n`);
		expect(parsed.entries.map((entry) => entry.value)).toEqual([
			"RowCat <a@b.c>",
			"y",
		]);
	});

	test("trims whitespace", () => {
		const parsed = parseDotenvExample("  PORT = 3001  \n");
		expect(parsed.entries[0]).toMatchObject({ key: "PORT", value: "3001" });
	});
});

describe("does not guess at ambiguous syntax", () => {
	test("an unclosed quote is an error", () => {
		const parsed = parseDotenvExample(`A="open only\n`);
		expect(parsed.entries).toEqual([]);
		expect(parsed.invalid[0]?.reason).toContain("quote");
	});

	test("says the export prefix is not supported", () => {
		const parsed = parseDotenvExample("export A=1\n");
		expect(parsed.invalid[0]?.reason).toContain("export");
	});

	test("a line that is neither an assignment nor a comment is reported", () => {
		const parsed = parseDotenvExample("just text\n");
		expect(parsed.invalid).toHaveLength(1);
		expect(parsed.invalid[0]?.line).toBe(1);
	});
});

describe("two active assignments of the same key", () => {
	test("reports it because nobody can tell which one wins", () => {
		const parsed = parseDotenvExample("A=1\nB=2\nA=3\n");
		expect(duplicateActiveKeys(parsed)).toEqual(["A"]);
	});

	/** A commented example beside the active value is this repository's normal convention. */
	test("a mix of comment and active is not a duplicate", () => {
		const parsed = parseDotenvExample("# A=1\nA=2\n");
		expect(duplicateActiveKeys(parsed)).toEqual([]);
	});
});
