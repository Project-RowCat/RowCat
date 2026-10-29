import { describe, expect, test } from "vitest";
import {
	checkEnvironmentSurfaces,
	ENV_CHECK_CATEGORIES,
	type EnvCheckCategory,
	type EnvCheckSources,
} from "./env-check.ts";
import { checkRepositoryEnvironment } from "./env-check-files.ts";
import type { EnvironmentVariableDefinition } from "./env-inventory.ts";

/**
 * Drift check. Every drift kind runs on synthetic fixtures; the real repository files get a single
 * "currently consistent" assertion, which is what replaces human memory here.
 */

/**
 * Builds Compose substitution syntax from pieces: writing it as a literal would trigger the
 * linter's "meant to be a template string?" warning each time.
 */
const sub = (name: string, fallback = ""): string =>
	["$", "{", name, ":-", fallback, "}"].join("");

const COMPOSE = [
	"name: fixture",
	"",
	"services:",
	"  api:",
	"    environment:",
	"      NODE_ENV: production",
	`      WEB_ORIGIN: ${sub("WEB_ORIGIN", "http://localhost:3000")}`,
	`      SECRET_THING: ${sub("SECRET_THING")}`,
	"",
].join("\n");

const ROOT_EXAMPLE = "WEB_ORIGIN=http://localhost:3000\nSECRET_THING=\n";
const API_EXAMPLE = "WEB_ORIGIN=http://localhost:3000\n";
const WEB_EXAMPLE = "# VITE_API_ORIGIN=http://localhost:3001\n";

const INVENTORY: EnvironmentVariableDefinition[] = [
	{
		key: "NODE_ENV",
		group: "core",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: { in: "environment", services: ["api"], ownership: "fixed" },
		},
	},
	{
		key: "WEB_ORIGIN",
		group: "core",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: { in: "environment", services: ["api"], ownership: "operator" },
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "SECRET_THING",
		group: "auth",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: { in: "environment", services: ["api"], ownership: "operator" },
			rootExample: "documented",
		},
	},
	{
		key: "VITE_API_ORIGIN",
		group: "client",
		sensitivity: "public",
		surfaces: { webExample: "documented", webBuild: true },
	},
];

const SCHEMA = ["NODE_ENV", "SECRET_THING", "WEB_ORIGIN"];

function run(overrides: Partial<EnvCheckSources> = {}) {
	return checkEnvironmentSurfaces({
		rootExample: ROOT_EXAMPLE,
		apiExample: API_EXAMPLE,
		webExample: WEB_EXAMPLE,
		compose: COMPOSE,
		schemaKeys: SCHEMA,
		inventory: INVENTORY,
		...overrides,
	});
}

const categories = (result: ReturnType<typeof run>): EnvCheckCategory[] =>
	result.findings.map((finding) => finding.category);

const subjects = (result: ReturnType<typeof run>, category: string): string[] =>
	result.findings
		.filter((finding) => finding.category === category)
		.map((finding) => finding.subject);

describe("a matching baseline", () => {
	test("the fixture has no drift", () => {
		const result = run();
		expect(result.findings).toEqual([]);
		expect(result.ok).toBe(true);
	});
});

describe("schema and inventory", () => {
	test("a key only in the schema is missing from the inventory", () => {
		const result = run({ schemaKeys: [...SCHEMA, "BRAND_NEW"] });
		expect(subjects(result, "missing:inventory")).toEqual(["BRAND_NEW"]);
	});

	test("a runtime key gone from the schema must be gone from the inventory too", () => {
		const result = run({ schemaKeys: ["NODE_ENV", "WEB_ORIGIN"] });
		expect(subjects(result, "stale:inventory")).toEqual(["SECRET_THING"]);
	});

	test("declaring the same key twice is an error", () => {
		const duplicated = INVENTORY[0] as EnvironmentVariableDefinition;
		const result = run({ inventory: [...INVENTORY, duplicated] });
		expect(subjects(result, "invalid:inventory")).toContain("NODE_ENV");
	});

	/** A value the operator must fill but cannot locate is as good as absent. */
	test("declaring operator input as absent from the root example is an error", () => {
		const inventory = INVENTORY.map((entry) =>
			entry.key === "SECRET_THING"
				? {
						...entry,
						surfaces: { ...entry.surfaces, rootExample: undefined },
					}
				: entry,
		);
		const result = run({
			inventory,
			rootExample: "WEB_ORIGIN=http://localhost:3000\n",
		});
		expect(subjects(result, "invalid:inventory")).toContain("SECRET_THING");
	});
});

describe("compose", () => {
	test("the inventory says it passes it, but compose does not have it", () => {
		const result = run({
			compose: COMPOSE.replace(
				`      SECRET_THING: ${sub("SECRET_THING")}\n`,
				"",
			),
		});
		expect(subjects(result, "missing:compose")).toEqual(["SECRET_THING"]);
	});

	test("compose passes it, but the inventory does not know it", () => {
		const result = run({
			compose: `${COMPOSE}      GONE_FROM_SCHEMA: ${sub("GONE_FROM_SCHEMA")}\n`,
		});
		expect(subjects(result, "stale:compose")).toEqual(["GONE_FROM_SCHEMA"]);
	});

	test("a declared ownership that differs from the actual value's shape is an error", () => {
		const result = run({
			compose: COMPOSE.replace(
				"NODE_ENV: production",
				`NODE_ENV: ${sub("NODE_ENV", "production")}`,
			),
		});
		expect(subjects(result, "mismatch:compose")).toEqual(["NODE_ENV"]);
	});

	/** A differently named substitution means the operator's value never arrives. */
	test("substituting under a different name is an error", () => {
		const result = run({
			compose: COMPOSE.replace(
				`WEB_ORIGIN: ${sub("WEB_ORIGIN", "http://localhost:3000")}`,
				`WEB_ORIGIN: ${sub("WEBORIGIN", "http://localhost:3000")}`,
			),
		});
		expect(subjects(result, "mismatch:compose")).toEqual(["WEB_ORIGIN"]);
	});

	/** Fixed and assembled values are not drift; the typical false positive this checker must avoid. */
	test("a fixed value absent from the root example is normal", () => {
		const result = run();
		expect(categories(result)).not.toContain("missing:root-example");
	});
});

describe("example files", () => {
	test("catches deployment input missing from the root example", () => {
		const result = run({ rootExample: "WEB_ORIGIN=http://localhost:3000\n" });
		expect(subjects(result, "missing:root-example")).toEqual(["SECRET_THING"]);
	});

	test("catches a runtime value missing from the direct-run example", () => {
		const result = run({ apiExample: "" });
		expect(subjects(result, "missing:api-example")).toEqual(["WEB_ORIGIN"]);
	});

	test("catches a key gone from the schema that remains in an example", () => {
		const result = run({ apiExample: `${API_EXAMPLE}OLD_PROVIDER_KEY=\n` });
		expect(subjects(result, "stale:api-example")).toEqual(["OLD_PROVIDER_KEY"]);
	});

	/** Wrong surface: this is exactly how a server setting ends up in the web example. */
	test("catches a server value in the web example", () => {
		const result = run({ webExample: `${WEB_EXAMPLE}SECRET_THING=\n` });
		expect(subjects(result, "stale:web-example")).toEqual(["SECRET_THING"]);
	});

	test("counts a commented-out optional value as documented", () => {
		const result = run({
			rootExample: "WEB_ORIGIN=http://localhost:3000\n# SECRET_THING=\n",
		});
		expect(categories(result)).not.toContain("missing:root-example");
	});

	test("two active assignments of the same key are an error", () => {
		const result = run({
			apiExample: "WEB_ORIGIN=a\nWEB_ORIGIN=b\n",
		});
		expect(categories(result)).toContain("invalid:example");
	});
});

describe("secret surface", () => {
	test("catches a secret declared on a client surface", () => {
		const inventory = INVENTORY.map((entry) =>
			entry.key === "SECRET_THING"
				? {
						...entry,
						surfaces: { ...entry.surfaces, webBuild: true as const },
					}
				: entry,
		);
		const result = run({ inventory });
		expect(subjects(result, "leak:client-surface")).toContain("SECRET_THING");
	});

	test("a VITE_ prefix cannot be a secret", () => {
		const inventory = INVENTORY.map((entry) =>
			entry.key === "VITE_API_ORIGIN"
				? { ...entry, sensitivity: "secret" as const }
				: entry,
		);
		const result = run({ inventory });
		expect(subjects(result, "leak:client-surface")).toContain(
			"VITE_API_ORIGIN",
		);
	});

	test("catches a secret committed with a value", () => {
		const result = run({
			rootExample: "WEB_ORIGIN=http://localhost:3000\nSECRET_THING=hunter2\n",
		});
		expect(subjects(result, "leak:example-value")).toEqual(["SECRET_THING"]);
	});

	/** Matches on shape, not name: a secret arriving under a key the inventory does not know is the real incident. */
	test("catches a credential-shaped value even without knowing the key", () => {
		const inventory = [
			...INVENTORY,
			{
				key: "SOME_TOKEN",
				group: "tooling" as const,
				sensitivity: "non-secret" as const,
				surfaces: { rootExample: "documented" as const },
			},
		];
		const result = run({
			inventory,
			rootExample: `${ROOT_EXAMPLE}SOME_TOKEN=live_sk_abcdefgh12345678\n`,
		});
		expect(subjects(result, "leak:credential-literal")).toEqual(["SOME_TOKEN"]);
	});

	/** Placeholders inside comments are legitimate documentation; flagging them gets the checker ignored. */
	test("does not catch a placeholder inside a comment", () => {
		const result = run({
			rootExample: `${ROOT_EXAMPLE}# SECRET_THING=test_sk_...\n`,
		});
		expect(categories(result)).not.toContain("leak:credential-literal");
		expect(categories(result)).not.toContain("leak:example-value");
	});
});

describe("output", () => {
	/** Same repository state must give the same output, or diffs become unreadable and get ignored. */
	test("the same input gives the same result", () => {
		const once = run({ apiExample: "", rootExample: "" });
		const twice = run({ apiExample: "", rootExample: "" });
		expect(once.findings).toEqual(twice.findings);
	});

	test("grouped by kind first, then by key name within it", () => {
		const result = run({ apiExample: "", rootExample: "" });
		const order = categories(result).map((category) =>
			ENV_CHECK_CATEGORIES.indexOf(category),
		);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(subjects(result, "missing:root-example")).toEqual(
			[...subjects(result, "missing:root-example")].sort(),
		);
	});
});

describe("the repository itself", () => {
	/** Replaces human memory: add a schema key and miss Compose or an example file, and this breaks in CI rather than at deploy. */
	test("the repository's current config surfaces agree with each other", () => {
		const result = checkRepositoryEnvironment();
		expect(
			result.findings.map(
				(finding) => `${finding.category} ${finding.subject}`,
			),
		).toEqual([]);
	});
});
