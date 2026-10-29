import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Statically scans that BYO credentials never reach the server. This invariant defines the feature:
 * once a user's API key crosses our server, the on-screen promise that the key stays on the device
 * becomes false, and that happens through an unremarkable line such as one more contract field. So
 * the scan looks for field names:
 *
 * ```text
 * "I'd like BYO telemetry"          -> adds a provider field to the request
 * "proxying server-side eases CORS" -> adds an apiKey field to the request
 * ```
 *
 * The first blurs the privacy boundary (which model is used lands in server logs), the second
 * breaks it outright. A runtime test cannot catch either: requests still succeed, and only our
 * promise to users fails.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");

/** The generation contract and server code: every place a credential could enter. */
const SCANNED = [
	join(REPO, "packages", "contracts", "src", "chat.ts"),
	join(REPO, "apps", "api", "src", "routes", "chat.ts"),
	join(REPO, "apps", "api", "src", "services", "generation", "chat.ts"),
	join(REPO, "apps", "api", "src", "services", "generation", "models.ts"),
];

/**
 * Credential-shaped names. The server's own key (`OPENROUTER_API_KEY`) must not trip this list: it
 * is the managed path's key and belongs on the server, hence `env.ts` is not scanned and the names
 * below point at user credentials only.
 */
const CREDENTIAL_NAMES = [
	"apikey",
	"api_key",
	"providerkey",
	"provider_key",
	"anthropickey",
	"geminikey",
	"usersecret",
	"byokey",
	"byosecret",
	"x-api-key",
	"x-goog-api-key",
	"anthropic-version",
];

const stripComments = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/**
 * Masks the server's own key, which contains `API_KEY` and would trip the list. Only that exact
 * name is masked: a pattern like `.*API_KEY` would also hide a future `USER_API_KEY`.
 */
const stripServerOwnKey = (source: string): string =>
	source.replaceAll("OPENROUTER_API_KEY", "«server-own-key»");

describe("BYO credentials never come to the server", () => {
	test("the scan targets actually exist", () => {
		// Guards the worst failure mode: a moved path scanning zero files and passing.
		expect(SCANNED.length).toBeGreaterThan(3);
		for (const file of SCANNED)
			expect(readFileSync(file, "utf8").length).toBeGreaterThan(0);
	});

	test("the generation contract and server code have no credential field", () => {
		const offences: string[] = [];
		for (const file of SCANNED) {
			const source = stripServerOwnKey(
				stripComments(readFileSync(file, "utf8")),
			).toLowerCase();
			for (const name of CREDENTIAL_NAMES)
				if (source.includes(name)) offences.push(`${file}: ${name}`);
		}
		expect(offences).toEqual([]);
	});

	// The BYO target is not sent either. Direct execution bypasses our endpoint, so a provider name
	// there could only be telemetry, which is the very information this feature removes. The local
	// router picks the transport.
	test("the generation request contract has no provider or BYO vocabulary", () => {
		const contracts = stripComments(readFileSync(SCANNED[0] as string, "utf8"));
		// The file also holds the catalogue, where `GenerationProviderDto` is legitimate, so only the
		// request schema body is inspected.
		const start = contracts.indexOf("export const ChatGenerationRequest");
		expect(start).toBeGreaterThan(-1);
		const schema = contracts.slice(start, contracts.indexOf("});", start));

		for (const name of ["provider", "byo", "model", "target"])
			expect(schema.toLowerCase()).not.toContain(name);
	});

	// Also pins that the server has no BYO credential table; cheap, and the mistake starts as "store
	// it for later convenience".
	test("the server schema has no provider credentials table", () => {
		const schema = readFileSync(
			join(REPO, "apps", "api", "src", "db", "schema.ts"),
			"utf8",
		).toLowerCase();
		for (const name of [
			"provider_connection",
			"providerconnection",
			"api_key",
			"user_provider",
		])
			expect(schema).not.toContain(name);
	});
});
