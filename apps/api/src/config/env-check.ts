import {
	type ComposeFile,
	type ComposeOwnership,
	findComposeService,
	parseComposeFile,
} from "./compose-config.ts";
import {
	activeEntries,
	type DotenvExample,
	documentedKeys,
	duplicateActiveKeys,
	parseDotenvExample,
} from "./dotenv-example.ts";
import {
	ENVIRONMENT_INVENTORY,
	type EnvironmentVariableDefinition,
	type ExamplePresence,
} from "./env-inventory.ts";
import { ENV_SCHEMA_KEYS } from "./env-schema.ts";

/**
 * Checks that the repository's configuration surfaces agree with each other.
 *
 * ```text
 * env:check    is the repository self-consistent   no secrets · CI · no network
 * env:doctor   what works with this configuration  reads real values · just before deploy
 * ```
 *
 * This file is the first. It takes strings rather than reading files, so tests can run every drift
 * kind on synthetic fixtures; disk reads belong to the CLI and the regression test
 * (`env-check-files.ts`).
 *
 * The rule is not "every key in every file": that would make `HOST` missing from the root example
 * an error, though it is an intended fixed value. The one question is whether each value has
 * exactly one intended deployment path. `env-inventory.ts` declares the intent; this file only
 * finds where the declaration disagrees with the real files.
 */

/** A kind, not a severity: output is grouped in this order so the same state gives the same output. */
export const ENV_CHECK_CATEGORIES = [
	"invalid:inventory",
	"invalid:example",
	"invalid:compose",
	"missing:inventory",
	"stale:inventory",
	"missing:compose",
	"stale:compose",
	"mismatch:compose",
	"missing:root-example",
	"stale:root-example",
	"missing:api-example",
	"stale:api-example",
	"missing:web-example",
	"stale:web-example",
	"leak:client-surface",
	"leak:example-value",
	"leak:credential-literal",
] as const;

export type EnvCheckCategory = (typeof ENV_CHECK_CATEGORIES)[number];

export interface EnvCheckFinding {
	category: EnvCheckCategory;
	/** What the finding is about: a key name or a file path. */
	subject: string;
	/** Human-readable; the first line is the fact, the rest the grounds. */
	details: string[];
}

export interface EnvCheckSources {
	rootExample: string;
	apiExample: string;
	webExample: string;
	compose: string;
	/** Defaults to the real runtime schema; only tests pass a synthetic list. */
	schemaKeys?: readonly string[];
	inventory?: readonly EnvironmentVariableDefinition[];
}

export interface EnvCheckResult {
	findings: EnvCheckFinding[];
	ok: boolean;
}

const EXAMPLE_FILES = [
	{
		id: "root-example" as const,
		path: ".env.example",
		surface: "rootExample" as const,
	},
	{
		id: "api-example" as const,
		path: "apps/api/.env.example",
		surface: "apiExample" as const,
	},
	{
		id: "web-example" as const,
		path: "apps/web/.env.example",
		surface: "webExample" as const,
	},
];

/**
 * Credential-shaped strings in active values. Matches on shape, not name: the inventory's `secret`
 * classification covers only known keys, and a secret arriving under an unlisted key is the
 * incident this catches. Comments are not scanned, since placeholders like `#
 * OPENROUTER_API_KEY=sk-or-...` are legitimate documentation and flagging them gets the checker
 * ignored.
 */
const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
	{ name: "Toss key", pattern: /(live|test)_(sk|ck)_[A-Za-z0-9]{8,}/ },
	{ name: "OpenAI/OpenRouter-style key", pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
	{ name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ name: "long base64 blob", pattern: /[A-Za-z0-9+/]{40,}={0,2}/ },
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const isLoopbackHost = (host: string): boolean =>
	LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");

function ownershipLabel(ownership: ComposeOwnership): string {
	if (ownership === "operator")
		return "set by the operator (substitutes a single variable as is)";
	if (ownership === "fixed") return "fixed by the container (a literal)";
	return "assembled by compose (variables mixed into the value)";
}

function checkInventory(
	inventory: readonly EnvironmentVariableDefinition[],
	findings: EnvCheckFinding[],
): void {
	const seen = new Set<string>();
	for (const entry of inventory) {
		if (seen.has(entry.key))
			findings.push({
				category: "invalid:inventory",
				subject: entry.key,
				details: [
					"the same key appears twice in the inventory.",
					"with two ownerships, nobody can answer which declaration is true.",
				],
			});
		seen.add(entry.key);

		const clientSurface =
			entry.surfaces.webExample ||
			entry.surfaces.webBuild ||
			entry.surfaces.adminBuild ||
			entry.surfaces.mobileBuild;

		if (entry.sensitivity === "secret" && clientSurface)
			findings.push({
				category: "leak:client-surface",
				subject: entry.key,
				details: [
					"a value classified as secret is declared on a client surface.",
					"browser bundles, mobile bundles and the web example are public deployments.",
				],
			});

		const clientPrefix =
			entry.key.startsWith("VITE_") || entry.key.startsWith("EXPO_PUBLIC_");
		if (clientPrefix && entry.sensitivity === "secret")
			findings.push({
				category: "leak:client-surface",
				subject: entry.key,
				details: [
					"the VITE_ and EXPO_PUBLIC_ prefixes are baked into bundles as is — they cannot be secrets.",
				],
			});

		if (entry.allowsLocalExampleValue && entry.sensitivity !== "secret")
			findings.push({
				category: "invalid:inventory",
				subject: entry.key,
				details: [
					"allowsLocalExampleValue is an exception used only for secrets.",
					"for a non-secret value that exception relaxes nothing.",
				],
			});

		/**
		 * A value the operator must fill but the root example does not mention leaves the deployment with
		 * no way to learn the variable exists; Compose accepting `${VAR:-}` alone does not reveal it.
		 */
		if (
			entry.surfaces.compose?.ownership === "operator" &&
			entry.surfaces.rootExample !== "documented"
		)
			findings.push({
				category: "invalid:inventory",
				subject: entry.key,
				details: [
					"compose takes it as operator input, but it was declared as undocumented in the root example.",
					"a value whose slot nobody knows is the same as a missing value.",
				],
			});
	}
}

function checkSchema(
	inventory: readonly EnvironmentVariableDefinition[],
	schemaKeys: readonly string[],
	findings: EnvCheckFinding[],
): void {
	const runtime = new Set(
		inventory.filter((e) => e.surfaces.apiRuntime).map((e) => e.key),
	);
	for (const key of schemaKeys)
		if (!runtime.has(key))
			findings.push({
				category: "missing:inventory",
				subject: key,
				details: [
					"the API runtime schema knows this variable, but the inventory does not have it.",
					"nothing says which deployment surface owns this value.",
					"add an entry to env-inventory.ts.",
				],
			});

	const declared = new Set(schemaKeys);
	for (const key of runtime)
		if (!declared.has(key))
			findings.push({
				category: "stale:inventory",
				subject: key,
				details: [
					"the inventory says it is an API runtime variable, but the schema does not have it.",
					"if it left env-schema.ts, the inventory entry must leave with it.",
				],
			});
}

function checkCompose(
	inventory: readonly EnvironmentVariableDefinition[],
	compose: ComposeFile,
	findings: EnvCheckFinding[],
): void {
	for (const problem of compose.problems)
		findings.push({
			category: "invalid:compose",
			subject: "docker-compose.yml",
			details: [problem],
		});

	const declaredServices = new Set<string>();
	for (const entry of inventory)
		for (const service of entry.surfaces.compose?.services ?? [])
			declaredServices.add(service);
	for (const service of compose.services) declaredServices.add(service.name);

	for (const serviceName of [...declaredServices].sort()) {
		const service = findComposeService(compose, serviceName);

		for (const where of ["environment", "build-args"] as const) {
			const actual =
				where === "environment"
					? (service?.environment ?? [])
					: (service?.buildArgs ?? []);
			const expected = inventory.filter(
				(entry) =>
					entry.surfaces.compose?.in === where &&
					entry.surfaces.compose.services.includes(serviceName),
			);
			const actualKeys = new Set(actual.map((a) => a.key));
			const label = where === "environment" ? "environment" : "build.args";

			for (const entry of expected)
				if (!actualKeys.has(entry.key))
					findings.push({
						category: "missing:compose",
						subject: entry.key,
						details: [
							`the inventory says compose's ${serviceName} service passes this value.`,
							`that key is not in docker-compose.yml's ${serviceName}.${label}.`,
						],
					});

			const expectedKeys = new Map(expected.map((e) => [e.key, e]));
			for (const assignment of actual) {
				const entry = expectedKeys.get(assignment.key);
				if (!entry) {
					findings.push({
						category: "stale:compose",
						subject: assignment.key,
						details: [
							`compose's ${serviceName}.${label} passes this value, but the inventory does not know it.`,
							"if the API no longer knows this variable, it must leave compose too.",
							`docker-compose.yml:${assignment.line}`,
						],
					});
					continue;
				}
				const declaredOwnership = entry.surfaces.compose?.ownership;
				if (declaredOwnership && declaredOwnership !== assignment.ownership)
					findings.push({
						category: "mismatch:compose",
						subject: assignment.key,
						details: [
							`the inventory says it is ${ownershipLabel(declaredOwnership)}.`,
							`compose's actual value is ${ownershipLabel(assignment.ownership)}.`,
							`docker-compose.yml:${assignment.line}`,
						],
					});
				if (
					assignment.ownership === "operator" &&
					assignment.substitutes &&
					assignment.substitutes !== assignment.key
				)
					findings.push({
						category: "mismatch:compose",
						subject: assignment.key,
						details: [
							`compose substitutes this key with ${assignment.substitutes} — under a different name, the value the operator filled in never arrives.`,
							`docker-compose.yml:${assignment.line}`,
						],
					});
			}
		}
	}
}

function checkExample(
	inventory: readonly EnvironmentVariableDefinition[],
	file: { id: string; path: string; surface: keyof ExampleSurfaces },
	parsed: DotenvExample,
	findings: EnvCheckFinding[],
): void {
	for (const invalid of parsed.invalid)
		findings.push({
			category: "invalid:example",
			subject: file.path,
			details: [`line ${invalid.line}: ${invalid.reason}`, invalid.text],
		});

	for (const key of duplicateActiveKeys(parsed))
		findings.push({
			category: "invalid:example",
			subject: file.path,
			details: [
				`${key} has two active assignments — nobody can tell which one wins.`,
			],
		});

	const present = documentedKeys(parsed);
	const expected = new Map(
		inventory
			.filter((entry) => surfaceOf(entry, file.surface) === "documented")
			.map((entry) => [entry.key, entry]),
	);

	for (const key of [...expected.keys()].sort())
		if (!present.has(key))
			findings.push({
				category: `missing:${file.id}` as EnvCheckCategory,
				subject: key,
				details: [
					`the inventory says ${file.path} documents this value.`,
					"that key is in that file neither as active nor as a comment.",
				],
			});

	for (const key of [...present].sort()) {
		if (expected.has(key)) continue;
		const known = inventory.find((entry) => entry.key === key);
		findings.push({
			category: `stale:${file.id}` as EnvCheckCategory,
			subject: key,
			details: known
				? [
						`${file.path} documents this value, but the inventory says it doesn't belong to this file.`,
						"each value has one intended deployment path — fix the surface or delete the line.",
					]
				: [
						`${file.path} documents a value not in the inventory.`,
						"add an entry to env-inventory.ts or delete that line.",
					],
		});
	}
}

interface ExampleSurfaces {
	rootExample?: ExamplePresence;
	apiExample?: ExamplePresence;
	webExample?: ExamplePresence;
}

const surfaceOf = (
	entry: EnvironmentVariableDefinition,
	surface: keyof ExampleSurfaces,
): ExamplePresence | undefined => entry.surfaces[surface];

function checkSecretValues(
	inventory: readonly EnvironmentVariableDefinition[],
	files: { path: string; parsed: DotenvExample }[],
	composeDefaults: Map<string, string>,
	findings: EnvCheckFinding[],
): void {
	for (const file of files)
		for (const entry of activeEntries(file.parsed)) {
			if (entry.value.length === 0) continue;

			const known = inventory.find((item) => item.key === entry.key);
			if (known?.sensitivity === "secret") {
				if (!known.allowsLocalExampleValue)
					findings.push({
						category: "leak:example-value",
						subject: entry.key,
						details: [
							`${file.path}:${entry.line} holds a secret value.`,
							"in a committed example, a secret must be an empty slot or a comment.",
						],
					});
				else if (
					!alreadyInRepository(entry.value, composeDefaults.get(entry.key))
				)
					/**
					 * The exception polices itself: a remote address in a slot allowed as a local default is a
					 * credential, not a placeholder.
					 */
					findings.push({
						category: "leak:example-value",
						subject: entry.key,
						details: [
							`the value at ${file.path}:${entry.line} is a new credential.`,
							"example values for this key are allowed in only two cases — a loopback connection string, or exactly the value compose already uses as its default.",
						],
					});
			}

			for (const { name, pattern } of CREDENTIAL_PATTERNS)
				if (pattern.test(entry.value)) {
					findings.push({
						category: "leak:credential-literal",
						subject: entry.key,
						details: [
							`the value at ${file.path}:${entry.line} looks like ${name}.`,
							"examples committed to the repository carry no real credentials.",
						],
					});
					break;
				}
		}
}

/**
 * Whether the value is already in the repository, so writing it in an example leaks nothing new.
 * True for either:
 *
 * ```text
 * loopback connection string      opens nothing outside this machine
 * equals Compose's :- default     already committed in docker-compose.yml
 * ```
 *
 * The exception is narrowed structurally; "this key may carry a value" would eventually let a real
 * secret sit there and pass green.
 */
function alreadyInRepository(
	value: string,
	composeDefault: string | undefined,
): boolean {
	if (composeDefault !== undefined && composeDefault === value) return true;
	try {
		return isLoopbackHost(new URL(value).hostname);
	} catch {
		return false;
	}
}

export function checkEnvironmentSurfaces(
	sources: EnvCheckSources,
): EnvCheckResult {
	const inventory = sources.inventory ?? ENVIRONMENT_INVENTORY;
	const schemaKeys = sources.schemaKeys ?? ENV_SCHEMA_KEYS;
	const findings: EnvCheckFinding[] = [];

	const compose = parseComposeFile(sources.compose);

	checkInventory(inventory, findings);
	checkSchema(inventory, schemaKeys, findings);
	checkCompose(inventory, compose, findings);

	const parsedFiles = EXAMPLE_FILES.map((file) => ({
		file,
		parsed: parseDotenvExample(
			file.id === "root-example"
				? sources.rootExample
				: file.id === "api-example"
					? sources.apiExample
					: sources.webExample,
		),
	}));

	for (const { file, parsed } of parsedFiles)
		checkExample(inventory, file, parsed, findings);

	const composeDefaults = new Map<string, string>();
	for (const service of compose.services)
		for (const assignment of [...service.environment, ...service.buildArgs])
			if (assignment.substitutes === assignment.key && assignment.fallback)
				composeDefaults.set(assignment.key, assignment.fallback);

	checkSecretValues(
		inventory,
		parsedFiles.map(({ file, parsed }) => ({ path: file.path, parsed })),
		composeDefaults,
		findings,
	);

	// Same repository state must give the same output, or diffs become unreadable and get ignored.
	findings.sort((a, b) => {
		const byCategory =
			ENV_CHECK_CATEGORIES.indexOf(a.category) -
			ENV_CHECK_CATEGORIES.indexOf(b.category);
		if (byCategory !== 0) return byCategory;
		return a.subject.localeCompare(b.subject, "en");
	});

	return { findings, ok: findings.length === 0 };
}

export function renderEnvCheck(result: EnvCheckResult): string {
	if (result.ok)
		return "the config surfaces agree with each other — schema · inventory · compose · the three example files.";

	const lines: string[] = ["found environment config drift", ""];
	let category: string | null = null;
	for (const finding of result.findings) {
		if (finding.category !== category) {
			category = finding.category;
			lines.push(`[${category}]`);
		}
		lines.push(finding.subject);
		for (const detail of finding.details) lines.push(`  ${detail}`);
		lines.push("");
	}
	lines.push(
		`${result.findings.length} errors — docs/ops/CONFIGURATION.md explains each kind`,
	);
	return lines.join("\n");
}
