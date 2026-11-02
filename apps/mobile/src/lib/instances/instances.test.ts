import {
	INSTANCE_PROTOCOL_VERSION,
	type RuntimeConfigDto,
	RuntimeConfigDto as RuntimeConfigSchema,
} from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { HOME_INSTANCE } from "../local-scope.ts";
import { checkInstance } from "./instance-check.ts";
import { isLocalHost, normalizeInstanceOrigin } from "./instance-origin.ts";
import {
	createInstanceRegistry,
	InstanceRegistryError,
	type InstanceRegistryStorage,
} from "./instance-registry.ts";

/**
 * The three rules a server picker stands on, before any screen exists: what counts as one server, how
 * the app asks a server what it is, and what this device remembers. Each one fails quietly — two
 * spellings become two instances, a web page passes as an API, a value left by another build points this
 * one at a server it never chose.
 */

const prod = { allowInsecure: false };
const dev = { allowInsecure: true };

describe("normalizeInstanceOrigin", () => {
	it("folds spellings of one server to one origin", () => {
		for (const input of [
			"rowcat.example.org",
			"https://rowcat.example.org",
			"https://RowCat.Example.org:443/",
			"  https://rowcat.example.org/  ",
		])
			expect(normalizeInstanceOrigin(input, prod)).toEqual({
				ok: true,
				origin: "https://rowcat.example.org",
			});
	});

	it("keeps a non-default port — it is a different server", () => {
		expect(
			normalizeInstanceOrigin("https://rowcat.example.org:8443", prod),
		).toEqual({ ok: true, origin: "https://rowcat.example.org:8443" });
	});

	it("refuses what is not an origin", () => {
		for (const input of [
			"https://rowcat.example.org/v2",
			"https://rowcat.example.org/?a=1",
			"https://rowcat.example.org/#x",
			"https://user:pass@rowcat.example.org",
		])
			expect(normalizeInstanceOrigin(input, prod)).toEqual({
				ok: false,
				issue: "not_origin",
			});
		expect(normalizeInstanceOrigin("", prod)).toEqual({
			ok: false,
			issue: "invalid",
		});
		expect(normalizeInstanceOrigin("ftp://x.test", prod)).toEqual({
			ok: false,
			issue: "invalid",
		});
	});

	it("a release build refuses http and local hosts; a development build accepts them", () => {
		for (const input of [
			"http://rowcat.example.org",
			"https://localhost:3001",
			"https://192.168.0.10:3001",
			"https://10.0.0.2",
			"https://[::1]:3001",
		]) {
			expect(normalizeInstanceOrigin(input, prod)).toEqual({
				ok: false,
				issue: "insecure",
			});
			expect(normalizeInstanceOrigin(input, dev).ok).toBe(true);
		}
	});

	it("isLocalHost covers loopback, private and link-local, not public hosts", () => {
		for (const host of [
			"127.0.0.1",
			"172.16.4.1",
			"172.31.255.255",
			"169.254.1.1",
			"fe80::1",
			"fd12::1",
			"printer.local",
		])
			expect(isLocalHost(host), host).toBe(true);
		for (const host of [
			"8.8.8.8",
			"172.32.0.1",
			"rowcat.example.org",
			"2001:db8::1",
		])
			expect(isLocalHost(host), host).toBe(false);
	});
});

const config = (extra: Partial<RuntimeConfigDto> = {}): RuntimeConfigDto =>
	RuntimeConfigSchema.parse({
		disabledFeatures: [],
		minAppVersion: { ios: null, android: null },
		updateMessage: "",
		...extra,
	});

describe("checkInstance", () => {
	it("a current RowCat server passes", async () => {
		const result = await checkInstance(async () =>
			config({ instanceProtocol: INSTANCE_PROTOCOL_VERSION }),
		);
		expect(result.status).toBe("ok");
	});

	/** The contract gives the field no default, so a right-shaped answer is not enough. */
	it("a server that does not state its protocol is unsupported, not ok", async () => {
		expect(await checkInstance(async () => config())).toEqual({
			status: "unsupported",
			protocol: null,
		});
	});

	it("a protocol outside the range is unsupported", async () => {
		expect(
			await checkInstance(async () =>
				config({ instanceProtocol: INSTANCE_PROTOCOL_VERSION + 1 }),
			),
		).toEqual({
			status: "unsupported",
			protocol: INSTANCE_PROTOCOL_VERSION + 1,
		});
	});

	it("a wrong answer is not_rowcat; no answer or a 5xx is unreachable", async () => {
		const fail = (error: unknown) => async () => {
			throw error;
		};
		expect(
			await checkInstance(
				fail(
					new RowCatApiError({ status: 404, code: "http_error", message: "" }),
				),
			),
		).toEqual({ status: "not_rowcat" });
		expect(
			await checkInstance(
				fail(
					new RowCatApiError({
						status: 200,
						code: "invalid_response",
						message: "",
					}),
				),
			),
		).toEqual({ status: "not_rowcat" });
		expect(
			await checkInstance(
				fail(
					new RowCatApiError({ status: 503, code: "http_error", message: "" }),
				),
			),
		).toEqual({ status: "unreachable" });
		expect(
			await checkInstance(fail(new TypeError("Network request failed"))),
		).toEqual({ status: "unreachable" });
	});
});

function memoryStorage(initial: string | null = null) {
	let value = initial;
	const storage: InstanceRegistryStorage = {
		read: () => value,
		write: async (next) => {
			value = next;
		},
	};
	return { storage, raw: () => value };
}

const registryWith = (
	storage: InstanceRegistryStorage,
	enabled = true,
	allowInsecure = false,
) =>
	createInstanceRegistry({
		storage,
		enabled,
		allowInsecure,
		homeOrigin: "https://home.rowcat.test",
		now: () => new Date("2026-11-02T00:00:00.000Z"),
	});

describe("instance registry", () => {
	it("starts at home with nothing else", () => {
		const registry = registryWith(memoryStorage().storage);
		expect(registry.active()).toEqual(HOME_INSTANCE);
		expect(registry.list()).toEqual([]);
	});

	it("adds an origin once, by its normalized spelling, and activates it", async () => {
		const registry = registryWith(memoryStorage().storage);
		await registry.add("elsewhere.test");
		await registry.add("https://Elsewhere.test/");
		expect(registry.list()).toEqual([
			{ origin: "https://elsewhere.test", addedAt: "2026-11-02T00:00:00.000Z" },
		]);
		await registry.activate({
			kind: "other",
			origin: "https://elsewhere.test",
		});
		expect(registry.active()).toEqual({
			kind: "other",
			origin: "https://elsewhere.test",
		});
	});

	/** A second scope for the same server would open an empty app on it. */
	it("the home origin cannot be added as another instance", async () => {
		const registry = registryWith(memoryStorage().storage);
		await expect(
			registry.add("https://home.rowcat.test/"),
		).rejects.toMatchObject({
			reason: "home",
		});
	});

	it("only a registered origin can be activated; removing the active one returns home", async () => {
		const registry = registryWith(memoryStorage().storage);
		await expect(
			registry.activate({ kind: "other", origin: "https://stranger.test" }),
		).rejects.toBeInstanceOf(InstanceRegistryError);
		await registry.add("https://elsewhere.test");
		await registry.activate({
			kind: "other",
			origin: "https://elsewhere.test",
		});
		await registry.remove("https://elsewhere.test");
		expect(registry.active()).toEqual(HOME_INSTANCE);
		expect(registry.list()).toEqual([]);
	});

	it("refuses a local address in a release build", async () => {
		const registry = registryWith(memoryStorage().storage);
		await expect(
			registry.add("http://192.168.0.10:3001"),
		).rejects.toMatchObject({
			reason: "not_origin",
		});
	});

	/** A value left by a build with the flag on must not point this build anywhere. */
	it("with selection off, a stored registry is ignored and writes refuse", async () => {
		const left = JSON.stringify({
			version: 1,
			instances: [{ origin: "https://elsewhere.test", addedAt: "x" }],
			active: "https://elsewhere.test",
		});
		const registry = registryWith(memoryStorage(left).storage, false);
		expect(registry.active()).toEqual(HOME_INSTANCE);
		expect(registry.list()).toEqual([]);
		await expect(registry.add("https://other.test")).rejects.toMatchObject({
			reason: "disabled",
		});
	});

	it("a stored value that does not read is home, never a throw", () => {
		for (const raw of [
			"not json",
			JSON.stringify({ version: 2, instances: [] }),
			JSON.stringify({
				version: 1,
				instances: [{}],
				active: "https://ghost.test",
			}),
		]) {
			const registry = registryWith(memoryStorage(raw).storage);
			expect(registry.active()).toEqual(HOME_INSTANCE);
		}
	});
});
