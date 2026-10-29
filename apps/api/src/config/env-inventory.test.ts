import { describe, expect, test } from "vitest";
import { ENVIRONMENT_INVENTORY } from "./env-inventory.ts";
import { ENV_SCHEMA_KEYS } from "./env-schema.ts";

const findEnvironmentVariable = (key: string) =>
	ENVIRONMENT_INVENTORY.find((entry) => entry.key === key);

/**
 * Inventory ↔ schema pairing. `env-check` does the same comparison, but a failure here reads
 * directly as "an inventory entry is missing" instead of being mixed with example-file and compose
 * findings.
 */

describe("schema and inventory", () => {
	test("every runtime key has exactly one inventory entry", () => {
		for (const key of ENV_SCHEMA_KEYS) {
			const entry = findEnvironmentVariable(key);
			expect(entry, `${key} is not in the inventory`).toBeDefined();
			expect(entry?.surfaces.apiRuntime, `${key}`).toBe(true);
		}
	});

	test("every entry declared as runtime is in the schema", () => {
		const declared = new Set(ENV_SCHEMA_KEYS);
		for (const entry of ENVIRONMENT_INVENTORY)
			if (entry.surfaces.apiRuntime)
				expect(declared.has(entry.key), `${entry.key}`).toBe(true);
	});

	test("no key is declared twice", () => {
		const keys = ENVIRONMENT_INVENTORY.map((entry) => entry.key);
		expect(keys).toEqual([...new Set(keys)]);
	});
});

describe("sensitivity classification", () => {
	/** Sensitivity is not guessed from the prefix: PortOne has two public values and one secret. */
	test("the three PortOne values are classified differently", () => {
		expect(findEnvironmentVariable("PORTONE_STORE_ID")?.sensitivity).toBe(
			"public",
		);
		expect(
			findEnvironmentVariable("PORTONE_IDENTITY_CHANNEL_KEY")?.sensitivity,
		).toBe("public");
		expect(findEnvironmentVariable("PORTONE_V2_API_SECRET")?.sensitivity).toBe(
			"secret",
		);
	});

	test("no secret stands on any client surface", () => {
		for (const entry of ENVIRONMENT_INVENTORY) {
			if (entry.sensitivity !== "secret") continue;
			expect(entry.surfaces.webExample, entry.key).toBeUndefined();
			expect(entry.surfaces.webBuild, entry.key).toBeUndefined();
			expect(entry.surfaces.adminBuild, entry.key).toBeUndefined();
			expect(entry.surfaces.mobileBuild, entry.key).toBeUndefined();
		}
	});

	test("a prefix baked into bundles cannot be a secret", () => {
		for (const entry of ENVIRONMENT_INVENTORY)
			if (entry.key.startsWith("VITE_") || entry.key.startsWith("EXPO_PUBLIC_"))
				expect(entry.sensitivity, entry.key).not.toBe("secret");
	});

	/**
	 * Secrets committed with a value in an example file must be named exceptions; a commit growing
	 * this list is itself a review subject.
	 */
	test("there are only two example-value exceptions", () => {
		expect(
			ENVIRONMENT_INVENTORY.filter(
				(entry) => entry.allowsLocalExampleValue,
			).map((entry) => entry.key),
		).toEqual(["DATABASE_URL", "POSTGRES_PASSWORD"]);
	});
});

describe("client surfaces", () => {
	/**
	 * Counted by name: these values are baked into the browser bundle, so growing the list must be
	 * reviewed, and counting alone would pass a swap of one key for another. `VITE_API_ORIGIN`
	 * defaults to the local API (Dockerfile) and production images override it; `VITE_ADMIN_ORIGIN`
	 * has no default — empty means no console link.
	 */
	test("the web example documents two values", () => {
		expect(
			ENVIRONMENT_INVENTORY.filter(
				(entry) => entry.surfaces.webExample === "documented",
			).map((entry) => entry.key),
		).toEqual(["VITE_API_ORIGIN", "VITE_ADMIN_ORIGIN"]);
	});

	/** Mobile has no example file by rule (the README documents it); the inventory must express that. */
	test("no example file documents the mobile values", () => {
		const mobile = findEnvironmentVariable("EXPO_PUBLIC_API_ORIGIN");
		expect(mobile?.surfaces.mobileBuild).toBe(true);
		expect(mobile?.surfaces.rootExample).toBeUndefined();
		expect(mobile?.surfaces.apiExample).toBeUndefined();
		expect(mobile?.surfaces.webExample).toBeUndefined();
	});
});
