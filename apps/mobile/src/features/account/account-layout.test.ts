import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the section order of the account screen by value; pair of web `account-layout.test.ts`.
 *
 * Order is policy: it follows the questions (profile, what happened to me, content, how I get in,
 * what is stored, remove everything), and the last two drift easily. Once deletion moves up beside
 * security, reversible and irreversible operations look equally weighty, and that drift breaks
 * neither compilation nor other tests.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const screen = readFileSync(
	`${SRC}features/account/account-screen.tsx`,
	"utf8",
);

describe("account section order", () => {
	it("seven sections stand in a fixed order", () => {
		const tags = [
			"<ProfileSection",
			"<AccountModerationSection",
			"<MyReportsSection",
			"<ContentSection",
			"<SecuritySection",
			"<DataSection",
			"<DeleteAccountSection",
		];
		const positions = tags.map((tag) => screen.indexOf(tag));
		for (const [index, at] of positions.entries())
			expect(at, tags[index]).toBeGreaterThan(-1);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("data after security, deletion after data — deletion is the last section", () => {
		expect(screen.indexOf("<DataSection")).toBeGreaterThan(
			screen.indexOf("<SecuritySection"),
		);
		expect(screen.indexOf("<DeleteAccountSection")).toBeGreaterThan(
			screen.indexOf("<DataSection"),
		);
		/** No section follows the delete section; the destructive section ends the screen. */
		const afterDelete = screen.slice(screen.indexOf("<DeleteAccountSection"));
		expect(afterDelete).not.toMatch(/<(?!DeleteAccountSection)\w+Section\b/);
	});

	/**
	 * The terminal panel replaces the normal screen. Returning to the normal branch after the account
	 * is gone would hit a wall of 401s from private queries against the erased session; the fork is
	 * `terminal` alone.
	 */
	it("once deletion is confirmed, only the exit panel is drawn", () => {
		expect(screen).toMatch(
			/deletion\.terminal \? \(\s*(\/\*[\s\S]*?\*\/\s*)?<DeletionTerminal/,
		);
		/** Deletion state lives outside the member branch, so it survives a cache reset unmounting that branch. */
		expect(screen.indexOf("useAccountDeletion()")).toBeLessThan(
			screen.indexOf("<AccountContent"),
		);
	});
});
