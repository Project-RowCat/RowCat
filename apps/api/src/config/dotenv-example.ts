/**
 * Reads the committed `.env.example` structurally, not with `text.includes("KEY=")`, which cannot
 * tell these four apart:
 *
 * ```text
 * BETTER_AUTH_SECRET=                      a setting slot (operator fills the value)
 * # AUTH_COOKIE_DOMAIN=.example.com        a setting slot (commented because it has a default)
 * # SMTP. HOST is required for smtp           prose
 * OTA_CI_CHANNELS=preview,testflight       a value actually written
 * ```
 *
 * The drift check ("is this key documented here") and the leak check ("does a secret key carry a
 * value") each need that split.
 *
 * Not a full dotenv implementation: it accepts only the syntax the committed example uses and
 * returns anything else as `invalid` rather than guessing. A wrong guess would read as "no drift"
 * and nobody would recheck it.
 */

export type DotenvEntryKind = "active" | "commented";

export interface DotenvEntry {
	key: string;
	/** Unquoted value; commented lines carry one too. */
	value: string;
	kind: DotenvEntryKind;
	/** 1-based, so error messages can point into the file. */
	line: number;
}

export interface DotenvInvalidLine {
	line: number;
	text: string;
	reason: string;
}

export interface DotenvExample {
	entries: DotenvEntry[];
	invalid: DotenvInvalidLine[];
}

/**
 * `KEY=value`, tolerating spaces around `=`: `env:doctor --file` also reads operators' real `.env`
 * files, where `KEY = value` is common. The syntax is unambiguous, so this is not a guess.
 */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Strips quotes only when they pair up. An opened-but-unclosed quote starts a multi-line value,
 * which this parser does not support; reading it as one line would misread the rest of the file.
 */
function unquote(raw: string): { value: string } | { error: string } {
	const value = raw.trim();
	if (value.length === 0) return { value };
	const first = value[0];
	if (first !== '"' && first !== "'") {
		if (value.includes('"') || value.includes("'"))
			// The example files have no quotes inside values; if one appears a person decides.
			return { error: "quotes inside a value are not supported" };
		return { value };
	}
	if (value.length < 2 || !value.endsWith(first))
		return {
			error: "the quote is not closed (multi-line values are not supported)",
		};
	return { value: value.slice(1, -1) };
}

export function parseDotenvExample(source: string): DotenvExample {
	const entries: DotenvEntry[] = [];
	const invalid: DotenvInvalidLine[] = [];

	const lines = source.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = index + 1;
		const raw = (lines[index] ?? "").trim();
		if (raw.length === 0) continue;

		if (raw.startsWith("#")) {
			/**
			 * Only an exact assignment inside a comment counts as a setting slot; prose such as `# SMTP. HOST is
			 * required ...` also contains `=`.
			 */
			const commented = raw.replace(/^#+\s*/, "");
			const match = ASSIGNMENT.exec(commented);
			if (!match) continue;
			const unquoted = unquote(match[2] ?? "");
			if ("error" in unquoted) continue; // A malformed line inside a comment is prose.
			entries.push({
				key: match[1] as string,
				value: unquoted.value,
				kind: "commented",
				line,
			});
			continue;
		}

		const match = ASSIGNMENT.exec(raw);
		if (!match) {
			invalid.push({
				line,
				text: raw,
				reason: raw.startsWith("export ")
					? "the `export` prefix is not supported — the example files use only KEY=value"
					: "neither an assignment (KEY=value) nor a comment",
			});
			continue;
		}

		const unquoted = unquote(match[2] ?? "");
		if ("error" in unquoted) {
			invalid.push({ line, text: raw, reason: unquoted.error });
			continue;
		}

		entries.push({
			key: match[1] as string,
			value: unquoted.value,
			kind: "active",
			line,
		});
	}

	return { entries, invalid };
}

/** Whether the file documents the key, commented or not. */
export const documentedKeys = (file: DotenvExample): Set<string> =>
	new Set(file.entries.map((entry) => entry.key));

/** Assignments that carry a value; the leak check reads these. */
export const activeEntries = (file: DotenvExample): DotenvEntry[] =>
	file.entries.filter((entry) => entry.kind === "active");

/** Two active assignments of one key leave it unclear which wins. */
export function duplicateActiveKeys(file: DotenvExample): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const entry of activeEntries(file)) {
		if (seen.has(entry.key)) duplicates.add(entry.key);
		seen.add(entry.key);
	}
	return [...duplicates].sort();
}
