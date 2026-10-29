import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The app side of the two-factor boundary — **it only answers the challenge.**
 *
 * The screens that turn it on, off and regenerate backup codes exist only in web's account screen.
 * If this app started calling those operations, the secrets (the TOTP URI and backup-code
 * plaintext) would pass through this app's screens and state, and this app has none of the steps
 * that screen requires yet (the "I wrote the codes down" check, the recent-login notice).
 * Conversely, without a way to answer the challenge, a person who turned it on in web could never
 * sign in with a password here. Both directions are locked together.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
			files.push(full);
	}
	return files;
}

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const product = sources(SRC).map((path) => ({
	path: path.slice(SRC.length),
	text: stripComments(readFileSync(path, "utf8")),
}));

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("two-factor auth — this app only answers the challenge", () => {
	it("doesn't call enable, disable or regenerate backup codes", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(
				/twoFactor\.(enable|disable|generateBackupCodes|getTotpUri)\b/,
			);
	});

	/** The trust-device state does not exist in this product — the server refuses it too. */
	it("doesn't request a trusted device", () => {
		for (const file of product)
			expect(file.text, file.path).not.toMatch(/trustDevice/);
	});

	/**
	 * Read the sign-in response **before the completion procedure.** If the order flipped, the
	 * challenge response would also call `/me`, and a guest answer would mark a signed-in person as
	 * signed out.
	 */
	it("email sign-in reads the challenge response before the completion procedure", () => {
		const identity = fileAt("lib/identity.tsx");
		const signIn = identity.slice(identity.indexOf("authClient.signIn.email"));
		const redirect = signIn.indexOf("isTwoFactorRedirect(data)");
		const complete = signIn.indexOf("completeAuthentication(deps)");
		expect(redirect).toBeGreaterThan(-1);
		expect(complete).toBeGreaterThan(redirect);
	});

	/** The shape is the same function as web's — this app does not rewrite the regex. */
	it("the challenge goes through the shared shape rule", () => {
		const identity = fileAt("lib/identity.tsx");
		expect(identity).toContain("normalizeTwoFactorCode");
		expect(identity).toContain("twoFactorCodeReady");
		const challenge = fileAt("features/sign-in/two-factor-prompt.tsx");
		expect(challenge).toContain("twoFactorCodeReady");
		expect(challenge).not.toMatch(/\\d\{6\}|replace\(\/\[\\s-\]/);
	});

	it("the sign-in screen stands the challenge field", () => {
		const login = fileAt("app/login.tsx");
		expect(login).toContain("identity.twoFactorPending");
		expect(login).toContain("<TwoFactorPrompt");
	});
});
