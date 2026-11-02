import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	MOBILE_RUNTIME_VERSION_PATTERN,
	mobileUpdateKeyIdChannel,
} from "@rowcat/contracts";
import { apiBaseUrl } from "@rowcat/sdk";
import type { ExpoConfig } from "expo/config";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **The binary side of OTA** — runtime generation, channel, signing certificate, and when updates
 * apply.
 *
 * A misconfiguration surfaces only **after** the binary has shipped: it accepts remote code without
 * a signature, takes updates from another channel, never receives OTA, or restarts the app
 * mid-generation. So the evaluated config is checked as values.
 */

const MOBILE = fileURLToPath(new URL("../../", import.meta.url));
const ORIGINAL = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL };
	vi.resetModules();
});

async function evaluate(
	env: Record<string, string | undefined>,
): Promise<ExpoConfig | Error> {
	process.env = { ...ORIGINAL };
	for (const key of [
		"EAS_BUILD",
		"EAS_BUILD_PROFILE",
		"EXPO_PUBLIC_API_ORIGIN",
		"EXPO_PUBLIC_WEB_ORIGIN",
		"EAS_BUILD_RUNNER",
		"ROWCAT_OTA",
		"ROWCAT_OTA_CHANNEL",
	])
		delete process.env[key];
	for (const [key, value] of Object.entries(env))
		if (value !== undefined) process.env[key] = value;
	vi.resetModules();
	try {
		return (await import("../../app.config.ts")).default;
	} catch (error) {
		return error as Error;
	}
}

/**
 * Places one certificate there only for the duration of the test — **an already committed
 * certificate is left untouched.** The private key stays in the OS temp folder and never reaches
 * the repository.
 */
function withTemporaryCertificate<T>(keyId: string, run: () => Promise<T>) {
	const path = join(MOBILE, "certs", `${keyId}.pem`);
	if (existsSync(path)) return run();
	const keyPath = join(tmpdir(), `rowcat-ota-config-${process.pid}.key`);
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			keyPath,
			"-out",
			path,
			"-days",
			"1",
			"-subj",
			`/CN=${keyId}`,
		],
		{ stdio: "ignore" },
	);
	return run().finally(() => {
		rmSync(path, { force: true });
		rmSync(keyPath, { force: true });
	});
}

describe("runtime generation", () => {
	it("always stands, has the contract's format, and has a fingerprint record", async () => {
		const config = await evaluate({});
		if (config instanceof Error) throw config;
		expect(config.runtimeVersion).toMatch(MOBILE_RUNTIME_VERSION_PATTERN);
		const lock = JSON.parse(
			readFileSync(join(MOBILE, "native-runtime.lock.json"), "utf8"),
		) as { generations: Record<string, unknown> };
		expect(lock.generations[config.runtimeVersion as string]).toBeTruthy();
	});

	it("the runtime generation is the same whatever the channel — a channel isn't a native contract", async () => {
		const plain = await evaluate({});
		const off = await evaluate({
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: "https://api.rowcat.test",
			ROWCAT_OTA: "off",
		});
		expect(plain instanceof Error || off instanceof Error).toBe(false);
		expect((plain as ExpoConfig).runtimeVersion).toBe(
			(off as ExpoConfig).runtimeVersion,
		);
	});
});

describe("where OTA turns off", () => {
	it("local runs outside EAS have no OTA", async () => {
		const config = await evaluate({});
		expect((config as ExpoConfig).updates).toEqual({ enabled: false });
	});

	it("the development profile has no OTA (Metro serves the bundle)", async () => {
		const config = await evaluate({
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "development",
			EXPO_PUBLIC_API_ORIGIN: "https://dev.rowcat.test",
		});
		expect((config as ExpoConfig).updates).toEqual({ enabled: false });
	});

	/**
	 * A self-built client without the channel's signing key states `off`. It must win over everything
	 * else that would turn OTA on — an explicit channel and a certificate present on disk included —
	 * and leave no address behind, so the binary asks nobody for code.
	 */
	it("ROWCAT_OTA=off wins over an explicit channel with a certificate present", async () => {
		const config = await withTemporaryCertificate("rowcat-preview-1", () =>
			evaluate({
				ROWCAT_OTA: "off",
				ROWCAT_OTA_CHANNEL: "preview",
				EXPO_PUBLIC_API_ORIGIN: "https://home.rowcat.test",
			}),
		);
		if (config instanceof Error) throw config;
		expect(config.updates).toEqual({ enabled: false });
		expect(JSON.stringify(config)).not.toContain("/mobile/updates");
	});

	it("ROWCAT_OTA=off turns it off explicitly", async () => {
		const config = await evaluate({
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: "https://api.rowcat.test",
			ROWCAT_OTA: "off",
		});
		expect((config as ExpoConfig).updates).toEqual({ enabled: false });
	});
});

describe("doesn't turn OTA on without signing", () => {
	it("a channel's build without a certificate stops and says what to do", async () => {
		const keyId = "rowcat-production-1";
		if (existsSync(join(MOBILE, "certs", `${keyId}.pem`))) return;
		const result = await evaluate({
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: "https://api.rowcat.test",
		});
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("keys:generate production");
		expect((result as Error).message).toContain("ROWCAT_OTA=off");
	});

	it("can't hand-overlay a channel different from the EAS profile", async () => {
		const result = await evaluate({
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "testflight",
			EXPO_PUBLIC_API_ORIGIN: "https://staging-api.rowcat.test",
			ROWCAT_OTA_CHANNEL: "production",
		});
		expect(result).toBeInstanceOf(Error);
	});

	it("turning OTA on without an origin stops — there's no address to ask", async () => {
		const result = await withTemporaryCertificate("rowcat-preview-1", () =>
			evaluate({ ROWCAT_OTA_CHANNEL: "preview" }),
		);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("EXPO_PUBLIC_API_ORIGIN");
	});

	it("an unknown channel name stops", async () => {
		expect(await evaluate({ ROWCAT_OTA_CHANNEL: "staging" })).toBeInstanceOf(
			Error,
		);
	});
});

describe("config of enabled channels", () => {
	const cases = [
		{
			channel: "testflight",
			env: {
				EAS_BUILD: "true",
				EAS_BUILD_PROFILE: "testflight",
				EXPO_PUBLIC_API_ORIGIN: "https://staging-api.rowcat.test",
			},
			origin: "https://staging-api.rowcat.test",
		},
		{
			channel: "production",
			env: {
				EAS_BUILD: "true",
				EAS_BUILD_PROFILE: "production",
				EXPO_PUBLIC_API_ORIGIN: "https://api.rowcat.test",
			},
			origin: "https://api.rowcat.test",
		},
		{
			channel: "preview",
			env: {
				ROWCAT_OTA_CHANNEL: "preview",
				EXPO_PUBLIC_API_ORIGIN: "http://localhost:3001",
			},
			origin: "http://localhost:3001",
		},
	] as const;

	for (const entry of cases)
		it(`${entry.channel}: signing · channel · address · apply timing`, async () => {
			const keyId = `rowcat-${entry.channel}-1`;
			await withTemporaryCertificate(keyId, async () => {
				const config = await evaluate(entry.env);
				if (config instanceof Error) throw config;
				const updates = config.updates;
				expect(updates?.enabled).toBe(true);
				/** The path belongs to the contract: it joins the prefix the SDK attaches and the route the API attaches. */
				expect(updates?.url).toBe(
					`${apiBaseUrl(entry.origin)}/mobile/updates/manifest`,
				);
				expect(updates?.codeSigningCertificate).toBe(`./certs/${keyId}.pem`);
				expect(updates?.codeSigningMetadata).toEqual({
					keyid: keyId,
					alg: "rsa-v1_5-sha256",
				});
				expect(mobileUpdateKeyIdChannel(keyId)).toBe(entry.channel);
				expect(updates?.requestHeaders).toEqual({
					"rowcat-update-channel": entry.channel,
				});
				/**
				 * Does not restart a running app: asks at a cold start, does not wait, and applies at the next
				 * cold start. No slot allows an unsigned manifest.
				 */
				expect(updates?.checkAutomatically).toBe("ON_LOAD");
				expect(updates?.fallbackToCacheTimeout).toBe(0);
				expect(updates?.enableBsdiffPatchSupport).toBe(false);
				expect(
					(updates as Record<string, unknown>)
						.codeSigningAllowUnsignedManifests,
				).toBeUndefined();
				expect(
					(updates as Record<string, unknown>).disableAntiBrickingMeasures,
				).toBeUndefined();
			});
		});
});

/**
 * The update authority belongs to whoever built the binary (`docs/ota/ARCHITECTURE.md` §업데이트 권한과
 * 인스턴스). The address is derived from the build's API origin and nothing else, so no setting that
 * might later let the app talk to another server can move where it asks for code.
 */
describe("the update address belongs to the build", () => {
	it("only the build's API origin moves it", async () => {
		const ask = (env: Record<string, string>) =>
			withTemporaryCertificate("rowcat-preview-1", () =>
				evaluate({ ROWCAT_OTA_CHANNEL: "preview", ...env }),
			);
		const home = await ask({
			EXPO_PUBLIC_API_ORIGIN: "https://home.rowcat.test",
		});
		const elsewhere = await ask({
			EXPO_PUBLIC_API_ORIGIN: "https://home.rowcat.test",
			EXPO_PUBLIC_WEB_ORIGIN: "https://elsewhere.rowcat.test",
			EXPO_PUBLIC_INSTANCE_SELECTION: "on",
		});
		if (home instanceof Error) throw home;
		if (elsewhere instanceof Error) throw elsewhere;
		expect(home.updates?.url).toBe(
			`${apiBaseUrl("https://home.rowcat.test")}/mobile/updates/manifest`,
		);
		expect(elsewhere.updates).toEqual(home.updates);
	});

	it("the config reads its origin from the build environment, never from app state", () => {
		const source = readFileSync(join(MOBILE, "app.config.ts"), "utf8");
		const block = source.slice(
			source.indexOf("function otaUpdatesConfig"),
			source.indexOf("\n}\n", source.indexOf("function otaUpdatesConfig")),
		);
		expect(block).toContain("easApiOrigin");
		expect(block).not.toMatch(
			/AsyncStorage|SecureStore|SQLite|fetch\(|runtime-config/,
		);
		expect(source).toMatch(
			/const easApiOrigin = process\.env\.EXPO_PUBLIC_API_ORIGIN/,
		);
	});
});

describe("the same address as the server", () => {
	it("the API opens that path", () => {
		const routes = readFileSync(
			join(MOBILE, "../api/src/routes/index.ts"),
			"utf8",
		);
		const route = readFileSync(
			join(MOBILE, "../api/src/routes/mobile-updates.ts"),
			"utf8",
		);
		expect(routes).toContain('.route("/mobile/updates", mobileUpdates)');
		expect(route).toContain('.get("/manifest"');
	});
});
