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

	/**
	 * The patterns above see only `write(`, and the sinks people read are the `out()` and `status()`
	 * wrappers and `console.*`. Their arguments are read whole (brackets balanced, so a nested call
	 * cannot end the match early) by one pass that knows the three string forms: quoted text is
	 * skipped, a template's text is skipped and its `${…}` expressions kept, so an apostrophe in
	 * "Can't" cannot swallow the expression after it. A secret name is matched inside identifiers
	 * too, so `dekBytes` and `sessionCookie` count.
	 */
	/** An optional call (`status?.(…)`, how the injected wrapper is called) is a call too. */
	const SINK =
		/\b(?:out|status|console\.\w+|process\.stderr\.write)(?:\?\.)?\(/g;
	const SECRET = /dek|recoverycode|password|cookie|keyring|content/i;

	/**
	 * The argument list's code with every string's text removed and template expressions kept.
	 * Comments and regex literals are skipped as what they are (a quote inside either would otherwise
	 * open a "string" that swallows the code after it), and a string used as a member key —
	 * `config["dek"]` — is kept as code, because there it is a name.
	 */
	const expressionsAt = (source: string, open: number): string => {
		let code = "";
		let depth = 0;
		const templates: number[] = [];
		const previous = (): string => code.trimEnd().at(-1) ?? "(";
		/** Where a `/` starts a regex: after an operator or punctuation, or after one of these words. */
		const regexAllowed = (): boolean =>
			"(,=:[!&|?{};>+-*%<^~".includes(previous()) ||
			/\b(?:return|typeof|void|case|in|of|delete|throw|new|yield|await)\s*$/.test(
				code,
			);
		for (let index = open; index < source.length; index += 1) {
			const char = source[index] as string;
			const next = source[index + 1];
			if (char === "/" && next === "/") {
				while (index < source.length && source[index] !== "\n") index += 1;
				code += " ";
				continue;
			}
			if (char === "/" && next === "*") {
				const end = source.indexOf("*/", index + 2);
				index = end === -1 ? source.length : end + 1;
				code += " ";
				continue;
			}
			if (char === "/" && regexAllowed()) {
				let inClass = false;
				for (index += 1; index < source.length; index += 1) {
					const c = source[index];
					if (c === "\\") index += 1;
					else if (c === "[") inClass = true;
					else if (c === "]") inClass = false;
					else if (c === "/" && !inClass) break;
				}
				code += " ";
				continue;
			}
			if (char === '"' || char === "'") {
				const asKey = previous() === "[";
				const start = index + 1;
				for (
					index += 1;
					index < source.length && source[index] !== char;
					index += 1
				)
					if (source[index] === "\\") index += 1;
				code += asKey ? ` ${source.slice(start, index)} ` : " ";
				continue;
			}
			if (char === "`" && previous() === "[") {
				// A template used as a member key, `config[`dek`]`: there it is a name.
				const start = index + 1;
				for (
					index += 1;
					index < source.length && source[index] !== "`";
					index += 1
				)
					if (source[index] === "\\") index += 1;
				code += ` ${source.slice(start, index)} `;
				continue;
			}
			if (char === "`" || (char === "}" && templates.at(-1) === depth)) {
				if (char === "}") templates.pop();
				// Template text up to the closing backtick or the next `${`.
				for (index += 1; index < source.length; index += 1) {
					if (source[index] === "\\") {
						index += 1;
						continue;
					}
					if (source[index] === "`") break;
					if (source[index] === "$" && source[index + 1] === "{") {
						index += 1;
						templates.push(depth);
						break;
					}
				}
				code += " ";
				continue;
			}
			if (char === "(" || char === "{" || char === "[") depth += 1;
			if (char === ")" || char === "}" || char === "]") {
				depth -= 1;
				if (depth === 0) return code;
			}
			code += char;
		}
		return code;
	};

	/**
	 * Names that carry a secret word but return none: `dekForViewer` answers *whose* key it is (its
	 * `.ok` is a boolean). A name joins this list only with that reason written beside it.
	 */
	const NOT_SECRETS = new Set(["dekForViewer"]);

	const leaks = (code: string): boolean =>
		(code.match(/[A-Za-z_$][\w$]*/g) ?? []).some(
			(name) => !NOT_SECRETS.has(name) && SECRET.test(name),
		);

	test("an optional call to the status wrapper is read too", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		const calls = [..."status?.(`${bytesToB64(dek)}`)".matchAll(SINK)];
		expect(calls).toHaveLength(1);
	});

	test.each(files)("%s: what reaches a person carries no secret", (name) => {
		const source = code(name);
		for (const call of source.matchAll(SINK)) {
			const open = (call.index ?? 0) + call[0].length - 1;
			const expressions = expressionsAt(source, open);
			expect(leaks(expressions), `${name}: ${call[0]}${expressions})`).toBe(
				false,
			);
		}
	});

	test("the scan reads past string text and nested calls", () => {
		const probe = (args: string): boolean =>
			leaks(expressionsAt(`(${args})`, 0));
		expect(probe('"Check the recovery code again."')).toBe(false);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		expect(probe("`Opened the sync key. (${configPath()}, 0600)`")).toBe(false);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		expect(probe("`key: ${config.dek}`")).toBe(true);
		expect(probe("label(fmt(viewer), config.cookie)")).toBe(true);
		expect(probe("bytesToB64(dekBytes)")).toBe(true);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		expect(probe("`${sessionCookie}`")).toBe(true);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		expect(probe("`Can't open ${config.dek}, don't share`")).toBe(true);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		expect(probe("`a ${`nested ${recoveryCode}`} b`")).toBe(true);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text the scan reads
		expect(probe("`  ${run.code}`")).toBe(false);
		expect(probe("x, // don't\n config.dek, 'y'")).toBe(true);
		expect(probe("s.replace(/'/g, ''), config.dek")).toBe(true);
		expect(probe("s.replace(/`/g, ''), config.dek")).toBe(true);
		expect(probe("config['dek']")).toBe(true);
		expect(probe('config["recoveryCode"]')).toBe(true);
		expect(probe("total / count, 'Can\\'t open'")).toBe(false);
		expect(probe("xs.map((l) => /'/.test(l)), config.dek")).toBe(true);
		expect(probe("'a' + /'/.source + config.dek")).toBe(true);
		expect(probe("xs.map((l) => { return /'/.test(l) }), config.dek")).toBe(
			true,
		);
		expect(probe("config[`dek`]")).toBe(true);
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
