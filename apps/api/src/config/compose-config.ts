/**
 * Reads only what each service receives from `docker-compose.yml`. It walks indentation instead of
 * regex-matching the file because the drift check asks ownership — "is it in the api service's
 * environment, and who decides the value" — not "does the key appear somewhere".
 *
 * ```text
 * NODE_ENV: production                          the container fixes it      fixed
 * WEB_ORIGIN: ${WEB_ORIGIN:-...}                the operator sets it (.env)  operator
 * DATABASE_URL: postgres://${POSTGRES_USER...}  compose assembles it        derived
 * ```
 *
 * Without that split the checker would report `HOST` missing from the root example as drift, though
 * it is an intended fixed value.
 *
 * Only a YAML subset: block mappings and scalars. Other syntax inside the two paths we descend
 * (`services.*.environment`, `services.*.build.args`) is reported, not guessed; everything outside
 * them (healthcheck flow sequences, etc.) is ignored.
 */

/** Who decides the value; this decides whether it belongs in operator docs. */
export type ComposeOwnership = "operator" | "fixed" | "derived";

export interface ComposeAssignment {
	key: string;
	raw: string;
	ownership: ComposeOwnership;
	/** For `operator`, the referenced variable name; usually equals the key. */
	substitutes: string | null;
	/**
	 * The `${VAR:-default}` default, i.e. what the container gets when the operator leaves it empty.
	 * The checker uses it to tell whether a secret written in the example file is just compose's
	 * existing local default rather than a new credential.
	 */
	fallback: string | null;
	line: number;
}

export interface ComposeService {
	name: string;
	environment: ComposeAssignment[];
	buildArgs: ComposeAssignment[];
}

export interface ComposeFile {
	services: ComposeService[];
	problems: string[];
}

/** `${NAME}`, `${NAME:-default}`, `${NAME:?message}` — a value referencing exactly one name. */
const SOLE_SUBSTITUTION =
	/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([\s\S]*))?\}$/;
const ANY_SUBSTITUTION = /\$\{[A-Za-z_][A-Za-z0-9_]*/;
const MAPPING_KEY = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:\s+([\s\S]*))?$/;

function classify(raw: string): {
	ownership: ComposeOwnership;
	substitutes: string | null;
	fallback: string | null;
} {
	const sole = SOLE_SUBSTITUTION.exec(raw);
	if (sole)
		return {
			ownership: "operator",
			substitutes: sole[1] as string,
			// `:?` declares the variable required; its message is not a default value.
			fallback: sole[2] === "-" ? (sole[3] ?? "") : null,
		};
	if (ANY_SUBSTITUTION.test(raw))
		return { ownership: "derived", substitutes: null, fallback: null };
	return { ownership: "fixed", substitutes: null, fallback: null };
}

const indentOf = (line: string): number =>
	line.length - line.trimStart().length;

/** Non-comment, non-blank lines, carrying indentation and the original line number. */
function significantLines(
	source: string,
): { indent: number; text: string; line: number }[] {
	const out: { indent: number; text: string; line: number }[] = [];
	const lines = source.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const raw = lines[index] ?? "";
		if (raw.trim().length === 0) continue;
		if (raw.trimStart().startsWith("#")) continue;
		out.push({ indent: indentOf(raw), text: raw.trim(), line: index + 1 });
	}
	return out;
}

/**
 * Reads scalar entries of one mapping block, which ends where indentation drops below
 * `blockIndent`. Nested mappings or sequences are reported as problems: silently skipping them
 * would drop those keys from the check entirely.
 */
function readScalarMapping(
	lines: { indent: number; text: string; line: number }[],
	start: number,
	blockIndent: number,
	path: string,
	problems: string[],
): { assignments: ComposeAssignment[]; next: number } {
	const assignments: ComposeAssignment[] = [];
	let index = start;

	while (index < lines.length) {
		const entry = lines[index] as (typeof lines)[number];
		if (entry.indent < blockIndent) break;
		if (entry.indent > blockIndent) {
			problems.push(
				`${path}: line ${entry.line} is not a scalar mapping — this checker reads only the KEY: value form`,
			);
			index += 1;
			continue;
		}
		if (entry.text.startsWith("- ")) {
			problems.push(
				`${path}: line ${entry.line} is a sequence — write environment as a mapping`,
			);
			index += 1;
			continue;
		}

		const match = MAPPING_KEY.exec(entry.text);
		if (!match) {
			problems.push(`${path}: can't read line ${entry.line}`);
			index += 1;
			continue;
		}
		const key = match[1] as string;
		const raw = (match[2] ?? "").trim();
		if (raw.length === 0) {
			problems.push(
				`${path}.${key}: no value — this checker does not read nested structures`,
			);
			index += 1;
			continue;
		}
		assignments.push({ key, raw, line: entry.line, ...classify(raw) });
		index += 1;
	}

	return { assignments, next: index };
}

export function parseComposeFile(source: string): ComposeFile {
	const lines = significantLines(source);
	const services: ComposeService[] = [];
	const problems: string[] = [];

	const servicesAt = lines.findIndex(
		(entry) => entry.indent === 0 && entry.text === "services:",
	);
	if (servicesAt < 0)
		return { services, problems: ["there is no services: block"] };

	let index = servicesAt + 1;
	const serviceIndent = lines[index]?.indent ?? 2;

	while (index < lines.length) {
		const entry = lines[index] as (typeof lines)[number];
		if (entry.indent === 0) break; // another top-level key (volumes: etc.)
		if (entry.indent !== serviceIndent) {
			index += 1;
			continue;
		}
		const nameMatch = MAPPING_KEY.exec(entry.text);
		if (!nameMatch) {
			index += 1;
			continue;
		}
		const service: ComposeService = {
			name: nameMatch[1] as string,
			environment: [],
			buildArgs: [],
		};
		services.push(service);
		index += 1;

		while (index < lines.length) {
			const child = lines[index] as (typeof lines)[number];
			if (child.indent <= serviceIndent) break;

			if (child.text === "environment:") {
				const blockIndent = lines[index + 1]?.indent ?? child.indent + 2;
				if (blockIndent <= child.indent) {
					index += 1;
					continue;
				}
				const read = readScalarMapping(
					lines,
					index + 1,
					blockIndent,
					`services.${service.name}.environment`,
					problems,
				);
				service.environment = read.assignments;
				index = read.next;
				continue;
			}

			if (child.text === "args:") {
				const blockIndent = lines[index + 1]?.indent ?? child.indent + 2;
				if (blockIndent <= child.indent) {
					index += 1;
					continue;
				}
				const read = readScalarMapping(
					lines,
					index + 1,
					blockIndent,
					`services.${service.name}.build.args`,
					problems,
				);
				service.buildArgs = read.assignments;
				index = read.next;
				continue;
			}

			index += 1;
		}
	}

	return { services, problems };
}

export const findComposeService = (
	file: ComposeFile,
	name: string,
): ComposeService | undefined =>
	file.services.find((service) => service.name === name);
