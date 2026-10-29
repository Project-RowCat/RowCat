import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoginMethodProvider } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import { account } from "#/lib/i18n/messages/en/account.ts";

/**
 * Statically scans the **boundaries** of the account security screen.
 *
 * The rules here share one trait: violating them still passes the types, and the screen still
 * renders. The symptom is invisible in review and appears only in a user's account.
 *
 * The web tests in this repository have no React rendering (`apps/web/vitest.config.ts`), so what
 * is checked is not the render result but **what is and is not present in the source**. The rules
 * were chosen knowing that limit, and each takes the form "if this string appears, the boundary was
 * crossed".
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Every source file in this folder, excluding tests. */
function sources(): { name: string; text: string }[] {
	return readdirSync(HERE)
		.filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
		.sort()
		.map((name) => ({ name, text: readFileSync(join(HERE, name), "utf8") }));
}

/** Comments are not inspected: the comments in these files describe exactly the forbidden things. */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

describe("account security screen boundaries", () => {
	const files = sources();

	test("there really are files to scan", () => {
		// The most dangerous failure mode of this test is passing while scanning zero files after a path
		// change.
		expect(files.length).toBeGreaterThan(10);
	});

	/**
	 * **Connecting is not signing in.**
	 *
	 * `signInWithGoogle` and `signInWithApple` look up the owner of a provider identity and **create a
	 * new account if there is none**. Calling them from the account screen would turn an identity that
	 * belongs to no account yet into **a second RowCat member** with no works and no local data, which
	 * the user would read as their own account being empty. Linking goes only through
	 * `connectLoginMethod`, which passes `/link-social`.
	 *
	 * The names are **enumerated**. A prefix match (`signInWith`) would also block names that are
	 * allowed in this folder, such as passkey registration, and the next person would then disable the
	 * rule or drop the file from the list. Instead, this list must grow whenever a social method is
	 * added.
	 */
	test("the account screen does not link providers through sign-in", () => {
		const offences: string[] = [];
		for (const { name, text } of files) {
			const body = stripComments(text);
			for (const needle of ["signInWithGoogle", "signInWithApple"])
				if (body.includes(needle)) offences.push(`${name}: ${needle}`);
		}
		expect(offences).toEqual([]);
	});

	/**
	 * **The list of connect functions does not diverge from the sign-in method vocabulary.**
	 *
	 * This list (`PROVIDERS`) decides how many rows the screen has. A method left out here does not
	 * even get a "not connected" row. For someone already signed in with that method, **their sign-in
	 * method appears to have vanished from the screen**, and trying to unlink the remaining one in
	 * that state is blocked only by the server. The types cannot catch this: compilation passes even
	 * if the array is a subset of the vocabulary.
	 */
	test("the sign-in method list draws the whole contract vocabulary", () => {
		const body = stripComments(
			readFileSync(join(HERE, "login-methods-section.tsx"), "utf8"),
		);
		const listed =
			/const PROVIDERS: LoginMethodProvider\[\] = \[([^\]]*)\]/.exec(body)?.[1];
		expect(listed, "PROVIDERS array not found").toBeTruthy();
		for (const provider of LoginMethodProvider.options)
			expect(listed, provider).toContain(`"${provider}"`);
	});

	/**
	 * **Destructive operations go through our own dialogs.**
	 *
	 * `window.confirm()` has no place to state the outcome ("Are you sure you want to delete?"). The
	 * operations on this screen must say what remains, so the user can judge.
	 */
	test("does not use window.confirm", () => {
		const offences = files
			.filter(({ text }) =>
				/\b(window\.)?confirm\s*\(/.test(stripComments(text)),
			)
			.map(({ name }) => name);
		expect(offences).toEqual([]);
	});

	/**
	 * **Auth credentials do not appear by name in screen code.**
	 *
	 * Session tokens and the auth account row id are not in the contract, so they are not values this
	 * code can reference. If the name appears, someone widened the contract or punched a response
	 * through with `any`; this slice exists to prevent both.
	 */
	test("does not reference session tokens or auth account ids", () => {
		const forbidden = [
			"sessionToken",
			"session_token",
			"accessToken",
			"idToken",
		];
		const offences: string[] = [];
		for (const { name, text } of files) {
			const body = stripComments(text);
			for (const needle of forbidden)
				if (body.includes(needle)) offences.push(`${name}: ${needle}`);
		}
		expect(offences).toEqual([]);
	});

	/**
	 * **Passwords do not flow into the query cache.**
	 *
	 * If a password rides in a query key or `setQueryData`, the value sits in the query devtools and
	 * browser memory as is, until the tab closes. Code in this folder must touch the cache (account
	 * details, session list), but its arguments must not contain a password.
	 */
	test("passwords do not flow into the query cache", () => {
		const offences: string[] = [];
		for (const { name, text } of files) {
			const body = stripComments(text);
			for (const match of body.matchAll(
				/(setQueryData|queryKey)\s*[(:]([^\n;]*)/g,
			))
				if (/[Pp]assword/.test(match[2] ?? ""))
					offences.push(`${name}: ${match[1]}(… password …)`);
		}
		expect(offences).toEqual([]);
	});

	/**
	 * **Do not get in the way of autofill.**
	 *
	 * Blocking password managers creates no security; it leads users to pick shorter,
	 * easier-to-remember passwords. The values are checked for exactness too: `autoComplete="off"` or
	 * a mistyped value means "do not fill" to the password manager.
	 */
	test("password fields have the right autocomplete attributes", () => {
		const dialog = stripComments(
			readFileSync(join(HERE, "password-dialog.tsx"), "utf8"),
		);
		expect(dialog).toContain('autoComplete="current-password"');
		expect(dialog.match(/autoComplete="new-password"/g)).toHaveLength(2);
		expect(dialog).not.toContain('autoComplete="off"');
	});

	/**
	 * **The screen does not count, by itself, whether a method can be unlinked.**
	 *
	 * A condition such as `methods.length > 1` on the screen would diverge from the server's verdict
	 * and, above all, would harden the wrong assumption that "the number of methods" and "the number
	 * of usable methods" are the same value. The verdict is made by a single pure function.
	 */
	test("the screen does not re-write the last-method rule", () => {
		const offences: string[] = [];
		for (const { name, text } of files) {
			const body = stripComments(text);
			if (/methods\.length\s*[><=]/.test(body)) offences.push(name);
		}
		expect(offences).toEqual([]);
		expect(
			stripComments(
				readFileSync(join(HERE, "login-methods-section.tsx"), "utf8"),
			),
		).toContain("canDisconnectLoginMethod");
	});

	/**
	 * **The security section actually draws its five subsections.**
	 *
	 * If one subsection drops out, the types still pass and the screen still renders; the feature
	 * simply stops existing.
	 */
	test("the security section has six cells", () => {
		const section = readFileSync(join(HERE, "security-section.tsx"), "utf8");
		for (const tag of [
			"EmailSection",
			"PasswordSection",
			"TwoFactorSection",
			"LoginMethodsSection",
			"PasskeysSection",
			"SessionsSection",
		])
			expect(section.match(new RegExp(`<${tag}\\b`, "g")), tag).toHaveLength(1);
	});

	/**
	 * **Passkeys do not mix into the sign-in method vocabulary.**
	 *
	 * `LoginMethodProvider` points at one provider **record** (one per provider per member), while
	 * passkeys are a list. Adding `"passkey"` to that vocabulary would make one list row stand for
	 * several credentials, and neither that row's `linkedAt` nor its unlink button could say what it
	 * means.
	 *
	 * The types cannot catch this: widening the vocabulary is one line in `@rowcat/domain`, and
	 * everything after it passes.
	 */
	test("passkeys are not drawn in the sign-in method list", () => {
		const body = stripComments(
			readFileSync(join(HERE, "login-methods-section.tsx"), "utf8"),
		);
		expect(body).not.toContain("passkey");
		expect(body).not.toContain("Passkey");
		expect(JSON.stringify(account.loginMethodsSection)).not.toMatch(/passkey/i);
	});

	/**
	 * **Do not hand-write the WebAuthn ceremony.**
	 *
	 * Calling `navigator.credentials` from this folder would mean this code has started re-writing the
	 * challenge, origin and signature verification rules. The ceremony is performed by the auth client
	 * (`registerPasskey` in `lib/auth.ts`), and this screen sees only its result.
	 *
	 * `PublicKeyCredential` is used only for **feature detection**, and that decision also belongs to
	 * the single `lib/auth.ts`. If it appears here, a copy has been made.
	 */
	test("the screen does not call the WebAuthn API directly", () => {
		const offences: string[] = [];
		for (const { name, text } of files) {
			const body = stripComments(text);
			for (const needle of [
				"navigator.credentials",
				"PublicKeyCredential",
				"startRegistration",
				"startAuthentication",
			])
				if (body.includes(needle)) offences.push(`${name}: ${needle}`);
		}
		expect(offences).toEqual([]);
	});

	/**
	 * **Passkey cryptographic material does not appear by name in screen code.**
	 *
	 * The contract does not carry these fields, so they are not values this code can reference. If the
	 * names appear, someone widened the contract or called the plugin's list directly; this slice
	 * exists to prevent both (same axis as session tokens).
	 */
	test("does not reference passkey public keys or credential ids", () => {
		const forbidden = ["publicKey", "credentialID", "aaguid", "deviceType"];
		const offences: string[] = [];
		for (const { name, text } of files) {
			const body = stripComments(text);
			for (const needle of forbidden)
				if (body.includes(needle)) offences.push(`${name}: ${needle}`);
		}
		expect(offences).toEqual([]);
	});

	/**
	 * **Email change does not pass through our contract.**
	 *
	 * Better Auth already exposes that operation over HTTP (`/v2/auth/change-email`). Wrapping it in
	 * our routes would add code to this repository that creates the confirmation token. If SDK calls
	 * appear in this file, the boundary has been crossed.
	 */
	test("email change goes through the auth client", () => {
		const body = stripComments(
			readFileSync(join(HERE, "change-email.ts"), "utf8"),
		);
		/**
		 * Calls can wrap across lines (the formatter decides), so this checks only that both names are
		 * present **together**. Searching for a single-line string would break this test the day the
		 * formatter changes.
		 */
		expect(body).toContain("authClient");
		expect(body).toContain(".changeEmail(");
		expect(body).not.toContain("getRowCatClient");
	});

	/**
	 * **Do not create a place for a feature that was deferred.**
	 *
	 * Email change, passkeys, Apple, **Kakao** and **two-step verification** are absent from this list
	 * **because they are actually implemented**, and the `"six cells"` and `"contract vocabulary"` tests confirm that by
	 * value. The evidence for dropping two-step verification: `twoFactorPlugin` in
	 * `apps/api/src/auth/index.ts` (server), `apps/api/src/auth/two-factor.test.ts` (the integration
	 * test for enable, challenge, backup codes and disable), `features/auth/two-factor-challenge.tsx`
	 * (the sign-in challenge), and `two-factor-section.tsx` in this folder.
	 *
	 * `recovery code` remains on the list: that word is the sync recovery key, while the
	 * one-time codes of two-step verification are `backup code`. If `recovery code` appears in this folder, the two
	 * keys have started to share one name, and someone who lost one goes looking for the other.
	 *
	 * A name is removed from the list **only in the commit where that feature actually lands**.
	 * Removing it to get a screen through would leave this check protecting nothing. The evidence for
	 * dropping Kakao: `socialProviders.kakao` in `apps/api/src/auth/index.ts` (provider registration),
	 * `LoginMethodProvider` in `packages/contracts/src/me.ts` (vocabulary), `SOCIAL_PROVIDERS` in
	 * `features/auth/social-sign-in.ts` (sign-in buttons), and `login-method-label.ts` and
	 * `login-methods-section.tsx` in this folder (connect and unlink).
	 */
	test("does not make room for deferred features", () => {
		const offences: string[] = [];
		const surfaces = [
			...files.map(({ name, text }) => ({ name, body: stripComments(text) })),
			{ name: "account dictionary", body: JSON.stringify(account) },
		];
		for (const { name, body } of surfaces)
			if (body.toLowerCase().includes("recovery code"))
				offences.push(`${name}: recovery code`);
		expect(offences).toEqual([]);
	});
});
