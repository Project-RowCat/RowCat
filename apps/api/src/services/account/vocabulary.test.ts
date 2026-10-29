import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LoginMethodProvider } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";

/**
 * Checks that every login method vocabulary entry reaches the projection.
 *
 * `LOGIN_METHOD_BY_PROVIDER_ID` in `services/account/index.ts` maps Better Auth's `providerId` to
 * the contract vocabulary and silently drops values missing from the table (rightly: one deployment
 * drift must not 500 the whole account screen). That tolerance becomes dangerous here: add a
 * provider to the contract and forget the table, and the list loses that method (the screen draws a
 * falsehood) while `canDisconnectLoginMethod` cannot count it, so the last remaining method gets
 * unlinked. That function counts only what the list holds (`packages/domain/src/account.ts`), safe
 * only if the projection holds every usable method; when the premise breaks it locks accounts.
 *
 * The type cannot catch it: `Record<string, LoginMethodDto["provider"]>` passes for any key count
 * or subset of the vocabulary. The test reads the source instead of importing the module, since
 * importing goes through `auth/index.ts` and builds a Better Auth instance, and the question is the
 * table's contents, not runtime behavior.
 */

const SOURCE = readFileSync(
	fileURLToPath(new URL("./index.ts", import.meta.url)),
	"utf8",
);

/** Slice out the table block only; a name appearing elsewhere in the file must not pass. */
const table = /LOGIN_METHOD_BY_PROVIDER_ID[^=]*=\s*{([\s\S]*?)\n\t};/.exec(
	SOURCE,
)?.[1];

describe("sign-in method projection", () => {
	test("finds the table", () => {
		// A renamed table matching zero characters and passing is this check's most dangerous failure
		// mode.
		expect(table, "couldn't find LOGIN_METHOD_BY_PROVIDER_ID").toBeTruthy();
	});

	test.each(LoginMethodProvider.options)("projects %s", (provider) => {
		expect(table).toContain(`${provider}: "${provider}"`);
	});
});
