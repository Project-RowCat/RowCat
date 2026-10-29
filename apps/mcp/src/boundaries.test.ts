import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The executable's boundaries, pinned as absences by value.
 *
 * - stdout belongs to the protocol: one stray character breaks JSON-RPC
 * - secrets stay out of logs: DEK, recovery code, password, cookie
 * - manuscripts stay out of logs: creator source is not this process's diagnostic subject
 * - no new doors: shell, arbitrary file writes, DB
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const sources = (dir: string): string[] => {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...sources(full));
			continue;
		}
		if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
		out.push(full);
	}
	return out;
};

const codeOf = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");

const files = sources(HERE).map((file) =>
	relative(HERE, file).replace(/\\/g, "/"),
);

const code = (name: string): string =>
	codeOf(readFileSync(join(HERE, name), "utf8"));

describe("standard output belongs to the protocol", () => {
	// While `serve` runs, stdout carries only JSON-RPC frames. A stray diagnostic line breaks the
	// client's parser and shows up as "server not responding". Human-facing text goes to stderr (`out`
	// in `index.ts`).
	test.each(files)("%s", (name) => {
		const source = code(name);
		expect(source, `${name}: console.log`).not.toMatch(/\bconsole\.log\b/);
		expect(source, `${name}: stdout`).not.toMatch(/process\.stdout/);
	});
});

describe("secrets and manuscripts do not go to logs", () => {
	/** These names appearing with string interpolation would leak a secret on that line. */
	const LEAKS = [
		/write\([^)]*\bdek\b/i,
		/write\([^)]*recoveryCode/i,
		/write\([^)]*password/i,
		/write\([^)]*\bcookie\b/i,
		/write\([^)]*\.content\b/,
		/write\([^)]*keyring/i,
	];

	test.each(files)("%s", (name) => {
		const source = code(name);
		for (const leak of LEAKS)
			expect(source, `${name}: ${leak}`).not.toMatch(leak);
	});
});

describe("no doors are added", () => {
	const DOORS: readonly [RegExp, string, ReadonlySet<string>][] = [
		[/\bnode:child_process\b/, "shell execution", new Set()],
		[/\bdrizzle-orm\b/, "database", new Set()],
		[/\bfrom "pg"/, "database", new Set()],
		[/\bnew Function\b/, "dynamic code", new Set()],
		[/\beval\(/, "dynamic code", new Set()],
		// The only file write is the config; this process does not touch the creator's disk.
		[
			/writeFileSync|createWriteStream|node:fs\/promises/,
			"file writes",
			new Set(["config.ts"]),
		],
	];

	test.each(files)("%s", (name) => {
		const source = code(name);
		for (const [door, why, except] of DOORS) {
			if (except.has(name)) continue;
			expect(source, `${name}: ${why}`).not.toMatch(door);
		}
	});
});

describe("serve does not talk to people", () => {
	// This command stands up the transport, whose peer is a parser, not a person. A prompt (email,
	// pairing code) in the middle of stdio looks like a "server not responding" with no visible cause,
	// so `serve` may only say what to do next and exit.
	const serveBody = (): string => {
		const source = code("index.ts");
		const start = source.indexOf("async function serve(): Promise<number> {");
		expect(start).toBeGreaterThan(-1);
		const end = source.indexOf("\nconst COMMANDS", start);
		return source.slice(start, end === -1 ? undefined : end);
	};

	test.each([
		["ask(", /\bask\(/],
		["askSecret(", /\baskSecret\(/],
		["pairDevice(", /\bpairDevice\(/],
		["signInInteractive(", /\bsignInInteractive\(/],
		["createInterface(", /\bcreateInterface\(/],
	])("does not call %s", (_name, door) => {
		expect(serveBody()).not.toMatch(door);
	});

	test("says what to do next when not connected", () => {
		expect(serveBody()).toContain("rowcat-mcp setup");
	});
});

describe("the recovery code did not disappear", () => {
	// Pairing became the normal path; the recovery code did not go away. For someone with no trusted
	// device it is the only way in, and closing it cuts them off from their drafts.
	test("the unlock command is in the command table", () => {
		const source = code("index.ts");
		expect(source).toMatch(/const COMMANDS[\s\S]*?\bunlock,/);
	});

	test("guides to that path when pairing is blocked", () => {
		expect(code("index.ts")).toContain("rowcat-mcp unlock");
	});

	// The normal pairing path does not ask for the recovery code.
	test("the pairing procedure has no recovery code input", () => {
		expect(code("pairing.ts")).not.toMatch(/askSecret|Enter the recovery code/);
	});
});

describe("config file", () => {
	test("is 0600 from creation", () => {
		const source = code("config.ts");
		expect(source).toContain("mode: 0o600");
		expect(source).toContain("chmodSync");
	});

	// The password never stays in this process; it goes out in one request.
	test("does not store the password", () => {
		expect(code("config.ts")).not.toMatch(/password/i);
	});
});
