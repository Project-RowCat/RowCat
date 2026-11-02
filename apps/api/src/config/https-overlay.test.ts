import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { findComposeService, parseComposeFile } from "./compose-config.ts";
import { activeEntries, parseDotenvExample } from "./dotenv-example.ts";

/**
 * The documented TLS install is "copy `.env.example`, add the secrets, `ROWCAT_DOMAIN` and
 * `COMPOSE_FILE`" (docs/ops/HTTPS.md). The overlay derives every origin from the domain with
 * `${NAME:-derived}`, which yields to any non-empty value — so an active localhost line in the
 * example silently beat the derivation and the stack booted with origins only a browser rejects.
 * This renders the overlay's values from the example the way compose does, without Docker.
 */

const REPO_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"..",
);
const read = (relative: string) =>
	readFileSync(join(REPO_ROOT, relative), "utf8");

/**
 * Compose's `${NAME}` and `${NAME:-default}`, defaults may nest. `:-` falls back when the variable
 * is unset or empty, as compose does. Anything else fails the test rather than being guessed.
 */
function interpolate(raw: string, env: Record<string, string>): string {
	let out = "";
	let index = 0;
	while (index < raw.length) {
		if (!raw.startsWith("${", index)) {
			out += raw[index];
			index += 1;
			continue;
		}
		let depth = 1;
		let end = index + 2;
		while (end < raw.length && depth > 0) {
			if (raw.startsWith("${", end)) {
				depth += 1;
				end += 2;
				continue;
			}
			if (raw[end] === "}") depth -= 1;
			end += 1;
		}
		if (depth !== 0) throw new Error(`unclosed substitution in ${raw}`);
		const body = raw.slice(index + 2, end - 1);
		const match = /^([A-Za-z_][A-Za-z0-9_]*)(?::-([\s\S]*))?$/.exec(body);
		if (!match) throw new Error(`unsupported substitution \${${body}}`);
		const [, name, fallback] = match;
		const value = env[name] ?? "";
		out +=
			value !== "" || fallback === undefined
				? value
				: interpolate(fallback, env);
		index = end;
	}
	return out;
}

function exampleEnvironment(extra: Record<string, string>) {
	const env: Record<string, string> = {};
	for (const entry of activeEntries(parseDotenvExample(read(".env.example"))))
		env[entry.key] = entry.value;
	return { ...env, ...extra };
}

function overlayValues(env: Record<string, string>) {
	const overlay = parseComposeFile(read("deploy/caddy/compose.yml"));
	expect(overlay.problems).toEqual([]);
	const values = (service: string) => {
		const found = findComposeService(overlay, service);
		if (!found) throw new Error(`no ${service} service in the overlay`);
		return Object.fromEntries(
			found.environment.map((assignment) => [
				assignment.key,
				interpolate(assignment.raw, env),
			]),
		);
	};
	return { api: values("api"), web: values("web"), admin: values("admin") };
}

describe("HTTPS overlay over a copied .env.example", () => {
	test("every origin comes from ROWCAT_DOMAIN", () => {
		const { api, web, admin } = overlayValues(
			exampleEnvironment({ ROWCAT_DOMAIN: "rowcat.example.com" }),
		);
		expect(api.API_ORIGIN).toBe("https://api.rowcat.example.com");
		expect(api.WEB_ORIGIN).toBe(
			"https://rowcat.example.com,https://admin.rowcat.example.com",
		);
		expect(api.AUTH_COOKIE_DOMAIN).toBe("rowcat.example.com");
		expect(api.WEBAUTHN_RP_ID).toBe("rowcat.example.com");
		expect(web.VITE_API_ORIGIN).toBe("https://api.rowcat.example.com");
		expect(web.VITE_ADMIN_ORIGIN).toBe("https://admin.rowcat.example.com");
		expect(admin.VITE_API_ORIGIN).toBe("https://api.rowcat.example.com");
	});

	test("the example leaves no active value for a key the overlay derives", () => {
		const overlay = parseComposeFile(read("deploy/caddy/compose.yml"));
		const derived = new Set(
			overlay.services.flatMap((service) =>
				service.environment
					// biome-ignore lint/suspicious/noTemplateCurlyInString: compose syntax the overlay is read for
					.filter((assignment) => assignment.raw.includes("${ROWCAT_DOMAIN}"))
					.map((assignment) => assignment.substitutes ?? assignment.key),
			),
		);
		const active = activeEntries(parseDotenvExample(read(".env.example")))
			.filter((entry) => entry.value !== "" && derived.has(entry.key))
			.map((entry) => entry.key);
		expect(active).toEqual([]);
	});

	test("a value the operator writes still wins", () => {
		const { api, web } = overlayValues(
			exampleEnvironment({
				ROWCAT_DOMAIN: "rowcat.example.com",
				WEB_ORIGIN: "https://www.example.org,https://ops.example.org",
				VITE_API_ORIGIN: "https://backend.example.org",
			}),
		);
		expect(api.WEB_ORIGIN).toBe(
			"https://www.example.org,https://ops.example.org",
		);
		expect(web.VITE_API_ORIGIN).toBe("https://backend.example.org");
		expect(api.API_ORIGIN).toBe("https://api.rowcat.example.com");
	});
});
