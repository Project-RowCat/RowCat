import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static boundary of the browser sign-in: one file opens the auth session, and no flow lets the
 * library open it instead.
 *
 * Without `disableRedirect: true`, `@better-auth/expo`'s client opens the sheet itself and looks for
 * `?cookie=` on the way back. The server no longer sends one, so that path signs nobody in — and the
 * symptom is only "sign-in didn't complete", with nothing pointing at the call site that forgot.
 */

const MOBILE = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(MOBILE, "src");

function files(dir: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) result.push(...files(path));
		else if (/\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path))
			result.push(path);
	}
	return result;
}

const sources = files(SRC).map((path) => ({
	path: relative(MOBILE, path),
	text: readFileSync(path, "utf8"),
}));

/** The calls that start a browser round trip: a social flow with a callback URL. */
function redirectingCalls(text: string): string[] {
	const calls: string[] = [];
	for (const match of text.matchAll(/(signIn\.social|linkSocial)\(\{/g)) {
		const start = match.index ?? 0;
		let depth = 0;
		let end = start;
		for (let i = text.indexOf("{", start); i < text.length; i++) {
			if (text[i] === "{") depth++;
			else if (text[i] === "}" && --depth === 0) {
				end = i;
				break;
			}
		}
		const body = text.slice(start, end + 1);
		if (body.includes("callbackURL")) calls.push(body);
	}
	return calls;
}

describe("the browser round trip has one door", () => {
	it("only auth-browser.ts opens an auth session", () => {
		expect(
			sources
				.filter(({ text }) => /openAuthSessionAsync\(/.test(text))
				.map(({ path }) => path),
		).toEqual(["src/lib/auth-browser.ts"]);
	});

	it("every redirecting social call goes through it with disableRedirect", () => {
		const offenders = sources.flatMap(({ path, text }) =>
			redirectingCalls(text)
				.filter((body) => !/disableRedirect:\s*true/.test(body))
				.map(() => path),
		);
		expect(offenders).toEqual([]);
		expect(
			sources
				.filter(({ text }) => redirectingCalls(text).length > 0)
				.map(({ path }) => path)
				.sort(),
		).toEqual(["src/lib/account-security-auth.ts", "src/lib/identity.tsx"]);
	});

	it("nothing reads a session cookie off a URL", () => {
		expect(
			sources
				.filter(({ text }) =>
					/searchParams\.get\(\s*["']cookie["']\s*\)/.test(text),
				)
				.map(({ path }) => path),
		).toEqual([]);
	});
});
