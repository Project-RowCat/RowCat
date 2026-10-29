import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");
const read = (...segments: string[]): string =>
	readFileSync(join(...segments), "utf8");

/**
 * **A form submitted before hydration must not carry its values in the address.**
 *
 * Forms on server-rendered screens are clickable from the moment the document arrives. At that
 * point `onSubmit` is not attached yet, and a form without `method` defaults to **GET**, so the
 * browser puts every named field into the query string and navigates to the same address:
 *
 * ```text
 * /login?email=...%40example.com&password=<plaintext>&rememberMe=on
 * ```
 *
 * That line lands in the address bar, browser history, SSR access logs and proxy logs, and in the
 * `Referer` of every subrequest the page makes.
 *
 * **This is a reproduced path.** When `e2e/journeys/15-login-return-path` first ran, the browser
 * really navigated to that address. No person types that fast, but **password managers do**: they
 * fill the fields as the page loads and press Enter straight after.
 *
 * ## Why the markup is checked rather than the values
 *
 * The defect appears only **before JavaScript exists**. Render tests and hook tests cannot express
 * that state, because both assume the handlers are already attached. A journey stumbled on it by
 * chance, but that net depends on timing: when hydration gets a little faster, it passes silently.
 * So the markup is pinned.
 *
 * ## Forms not on the list
 *
 * Forms inside dialogs (password change, email change, passkeys) are not listed. Those dialogs
 * cannot be opened without JavaScript, so they are never reachable before hydration. No defence is
 * built against a risk that cannot occur.
 */
const SSR_FORMS = {
	"sign-in/sign-up": ["features", "auth", "credentials-form.tsx"],
	/**
	 * Both forms on the reset screen are listed. The request form holds an email, and the new-password
	 * form holds a password. The second arrives through a mail link, so it is exactly where a password
	 * manager can fill and submit before hydration.
	 */
	"password reset": ["features", "auth", "reset-password-page.tsx"],
	profile: ["features", "account", "profile-section.tsx"],
	comment: ["features", "story", "comments", "comment-composer.tsx"],
} as const;

describe("submit safety of server-rendered forms", () => {
	it.each(
		Object.entries(SSR_FORMS),
	)("the %s form is never submitted as GET", (_label, segments) => {
		const source = read(WEB_SRC, ...segments);
		/**
		 * Match **the characters that follow** so `<form.Field` (TanStack Form's composed component) is
		 * not counted. A bare `\\b` would also break before the dot, inflating the count by the number of
		 * fields, and then this assertion would fail forever. Only real `<form` tags are counted.
		 */
		const forms = source.match(/<form[\s>]/g) ?? [];
		const methods = source.match(/method="post"/g) ?? [];
		expect(
			forms.length,
			"no form — check whether the file moved",
		).toBeGreaterThan(0);
		expect(methods.length, 'every <form> needs method="post"').toBe(
			forms.length,
		);
	});

	/**
	 * No `action` is written. Left empty, the form posts to the current address so `?redirect=`
	 * survives, and writing a value would add one more place where the string could drift from the
	 * route.
	 */
	it("does not hard-code the destination as a string", () => {
		for (const [label, segments] of Object.entries(SSR_FORMS))
			expect(read(WEB_SRC, ...segments), `${label} form`).not.toMatch(
				/<form[^>]*\saction=/,
			);
	});
});
