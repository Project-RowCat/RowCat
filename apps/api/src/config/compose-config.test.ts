import { describe, expect, test } from "vitest";
import { findComposeService, parseComposeFile } from "./compose-config.ts";

/**
 * Compose parsing answers ownership — who decides each value — so the checker does not mistake
 * `HOST` missing from the root example for drift.
 */

const SAMPLE = `name: sample

services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-rowcat}

  api:
    build:
      context: .
      args:
        SOME_ARG: \${SOME_ARG:-}
    environment:
      # comments are skipped
      NODE_ENV: production
      PORT: 3001
      WEB_ORIGIN: \${WEB_ORIGIN:-http://localhost:3000}
      DATABASE_URL: postgres://\${POSTGRES_USER:-rowcat}@db:5432/rowcat
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET:?required}
      RENAMED: \${OTHER_NAME:-}
    healthcheck:
      test: ["CMD", "true"]

volumes:
  db-data:
`;

describe("ownership decision", () => {
	const parsed = parseComposeFile(SAMPLE);
	const api = findComposeService(parsed, "api");
	const byKey = (key: string) =>
		api?.environment.find((entry) => entry.key === key);

	test("a literal is a value the container fixes", () => {
		expect(byKey("NODE_ENV")).toMatchObject({
			ownership: "fixed",
			substitutes: null,
		});
		expect(byKey("PORT")?.ownership).toBe("fixed");
	});

	test("referencing a single variable is operator input", () => {
		expect(byKey("WEB_ORIGIN")).toMatchObject({
			ownership: "operator",
			substitutes: "WEB_ORIGIN",
			fallback: "http://localhost:3000",
		});
	});

	test("a variable mixed into a value is a value compose assembles", () => {
		expect(byKey("DATABASE_URL")?.ownership).toBe("derived");
	});

	/** `:?` declares a required variable; its message must not be read as a default value. */
	test("a required declaration has no default", () => {
		expect(byKey("BETTER_AUTH_SECRET")).toMatchObject({
			ownership: "operator",
			substitutes: "BETTER_AUTH_SECRET",
			fallback: null,
		});
	});

	test("a substitution under a different name carries that fact out", () => {
		expect(byKey("RENAMED")?.substitutes).toBe("OTHER_NAME");
	});
});

describe("structure", () => {
	const parsed = parseComposeFile(SAMPLE);

	test("each service has its own environment", () => {
		expect(parsed.services.map((service) => service.name)).toEqual([
			"db",
			"api",
		]);
		expect(
			findComposeService(parsed, "db")?.environment.map((e) => e.key),
		).toEqual(["POSTGRES_USER"]);
	});

	test("build args are a different cell from environment", () => {
		expect(
			findComposeService(parsed, "api")?.buildArgs.map((e) => e.key),
		).toEqual(["SOME_ARG"]);
	});

	/** Paths we do not descend into (the healthcheck's flow sequence) are not problems. */
	test("paths it does not read pass quietly", () => {
		expect(parsed.problems).toEqual([]);
	});

	test("says so when there is no services block", () => {
		expect(parseComposeFile("name: x\n").problems).toEqual([
			"there is no services: block",
		]);
	});
});
