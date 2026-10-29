import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MobileUpdateManifest } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { isPlaceholderOrigin } from "../../src/lib/build-profile.ts";
import {
	type EasJson,
	exportProcessEnv,
	readEasJson,
	resolveChannelEnvironment,
} from "./environment.ts";
import {
	buildManifest,
	buildRepublishedManifest,
	buildRollbackDirective,
	checkAssetBaseUrl,
	readPlatformExport,
} from "./manifest.ts";
import { assertNoSecretsInBundle, checkEvaluatedConfig } from "./publish.ts";
import { judgeRuntime } from "./runtime.ts";
import { loadSigningKey, signForKeyId, verifyWithCertificate } from "./signing.ts";
import {
	ArtifactConflictError,
	FileArtifactStore,
	S3ArtifactStore,
	artifactStoreFromEnv,
} from "./storage.ts";

/**
 * Pure layer of the publish tool: bundle environment, manifest, signing, storage and runtime
 * decisions.
 *
 * `expo export`, the DB and a real bucket stay out. The path through those is covered by the local
 * verification procedure (`docs/ota/OPERATIONS.md`, "end to end locally"); here we only check that the
 * decisions that path relies on are right.
 */

const MOBILE_ROOT = join(import.meta.dirname, "../..");
const STAGING = "https://staging-api.rowcat.test";
const PRODUCTION = "https://api.rowcat.test";
const WEB = "https://rowcat.test";

/**
 * A filled-in `eas.json`. The committed file holds only example.com placeholders (a fork fills
 * them), so decision behavior is tested with this fixture, and the committed file is checked only
 * for not being published as placeholders.
 */
const FILLED: EasJson = {
	build: {
		development: {},
		preview: { env: { EXPO_PUBLIC_WEB_ORIGIN: WEB } },
		testflight: {
			env: { EXPO_PUBLIC_API_ORIGIN: STAGING, EXPO_PUBLIC_WEB_ORIGIN: WEB },
		},
		production: {
			env: { EXPO_PUBLIC_API_ORIGIN: PRODUCTION, EXPO_PUBLIC_WEB_ORIGIN: WEB },
		},
	},
};

describe("channel environment — binary and bundle name the same backend", () => {
	const easJson = FILLED;

	it("testflight uses eas.json's staging origin as is", () => {
		const result = resolveChannelEnvironment({
			channel: "testflight",
			easJson,
			shellEnv: {},
		});
		expect(result).toMatchObject({
			ok: true,
			environment: { apiOrigin: STAGING },
		});
	});

	it("a testflight bundle can't point at the production API", () => {
		const result = resolveChannelEnvironment({
			channel: "testflight",
			easJson: {
				build: {
					...FILLED.build,
					testflight: { env: { EXPO_PUBLIC_API_ORIGIN: PRODUCTION } },
				},
			},
			shellEnv: {},
		});
		expect(result.ok).toBe(false);
	});

	it("a production bundle can't point at the staging API", () => {
		for (const shellEnv of [
			{ EXPO_PUBLIC_API_ORIGIN: STAGING },
			{} as Record<string, string>,
		]) {
			const result = resolveChannelEnvironment({
				channel: "production",
				easJson,
				shellEnv,
				apiOriginFlag: shellEnv.EXPO_PUBLIC_API_ORIGIN ? undefined : STAGING,
			});
			expect(result.ok).toBe(false);
		}
	});

	it("production carries eas.json's production origin as is", () => {
		const result = resolveChannelEnvironment({
			channel: "production",
			easJson,
			shellEnv: {},
		});
		expect(result.ok && result.environment.apiOrigin).toBe(PRODUCTION);
		expect(result.ok && result.environment.publicEnv.EXPO_PUBLIC_API_ORIGIN).toBe(
			PRODUCTION,
		);
	});

	it("doesn't publish when production states no origin — there is no default origin", () => {
		const result = resolveChannelEnvironment({
			channel: "production",
			easJson: { build: { ...FILLED.build, production: {} } },
			shellEnv: {},
			apiOriginFlag: PRODUCTION,
		});
		expect(result.ok).toBe(false);
	});

	it("doesn't publish with an eas.json holding placeholders", () => {
		const committed = readEasJson(MOBILE_ROOT);
		const placeholders = Object.values(committed.build).some((profile) =>
			Object.values(profile.env ?? {}).some(isPlaceholderOrigin),
		);
		if (!placeholders) return;
		for (const channel of ["testflight", "production"] as const)
			expect({
				channel,
				ok: resolveChannelEnvironment({
					channel,
					easJson: committed,
					shellEnv: {},
				}).ok,
			}).toEqual({ channel, ok: false });
	});

	it("preview must state an origin — there is no default origin", () => {
		expect(
			resolveChannelEnvironment({ channel: "preview", easJson, shellEnv: {} }).ok,
		).toBe(false);
		expect(
			resolveChannelEnvironment({
				channel: "preview",
				easJson,
				shellEnv: {},
				apiOriginFlag: STAGING,
			}).ok,
		).toBe(true);
	});

	it("stops when a public value in the shell differs from eas.json", () => {
		const result = resolveChannelEnvironment({
			channel: "production",
			easJson,
			shellEnv: { EXPO_PUBLIC_WEB_ORIGIN: "https://evil.example" },
		});
		expect(result.ok).toBe(false);
	});

	it("neither the shell's public values nor secrets pass into the export environment", () => {
		const resolved = resolveChannelEnvironment({
			channel: "testflight",
			easJson,
			shellEnv: {},
		});
		if (!resolved.ok) throw new Error(resolved.problems.join());
		const env = exportProcessEnv(
			{
				PATH: "/bin",
				EXPO_PUBLIC_SOMETHING: "leak",
				ROWCAT_OTA_SIGNING_KEY: "-----BEGIN PRIVATE KEY-----",
				ROWCAT_OTA_S3_SECRET_ACCESS_KEY: "secret",
				AWS_SECRET_ACCESS_KEY: "secret",
				EAS_BUILD: "true",
			},
			resolved.environment,
		);
		expect(env.PATH).toBe("/bin");
		expect(env.EXPO_PUBLIC_SOMETHING).toBeUndefined();
		expect(env.ROWCAT_OTA_SIGNING_KEY).toBeUndefined();
		expect(env.ROWCAT_OTA_S3_SECRET_ACCESS_KEY).toBeUndefined();
		expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
		expect(env.EAS_BUILD).toBeUndefined();
		expect(env.EXPO_PUBLIC_API_ORIGIN).toBe(STAGING);
		expect(env.ROWCAT_OTA_CHANNEL).toBe("testflight");
	});
});

describe("the evaluated config says the same thing as the binary", () => {
	const environment = {
		channel: "testflight" as const,
		publicEnv: {},
		apiOrigin: STAGING,
	};
	const config = {
		runtimeVersion: "rowcat-native-1",
		updates: {
			enabled: true,
			url: `${STAGING}/v2/mobile/updates/manifest`,
			codeSigningMetadata: { keyid: "rowcat-testflight-1" },
			requestHeaders: { "rowcat-update-channel": "testflight" },
		},
	};

	it("gives the key id when it matches", () => {
		expect(checkEvaluatedConfig(config, environment, "rowcat-native-1")).toEqual({
			keyId: "rowcat-testflight-1",
		});
	});

	it("stops when the update address's origin differs from the bundle", () => {
		expect(() =>
			checkEvaluatedConfig(
				{
					...config,
					updates: {
						...config.updates,
						url: `${PRODUCTION}/v2/mobile/updates/manifest`,
					},
				},
				environment,
				"rowcat-native-1",
			),
		).toThrow(/disagree/);
	});

	it("stops when the runtime differs", () => {
		expect(() =>
			checkEvaluatedConfig(config, environment, "rowcat-native-2"),
		).toThrow();
	});

	it("doesn't publish with a config that has OTA off", () => {
		expect(() =>
			checkEvaluatedConfig(
				{ ...config, updates: { enabled: false } },
				environment,
				"rowcat-native-1",
			),
		).toThrow(/OTA is off/);
	});
});

function fakeExport(): string {
	const dir = mkdtempSync(join(tmpdir(), "rowcat-ota-export-"));
	mkdirSync(join(dir, "_expo/static/js/ios"), { recursive: true });
	mkdirSync(join(dir, "assets"), { recursive: true });
	writeFileSync(join(dir, "_expo/static/js/ios/entry-abc.hbc"), "BUNDLE");
	writeFileSync(join(dir, "assets/a"), "PNG-A");
	writeFileSync(join(dir, "assets/b"), "PNG-A");
	writeFileSync(join(dir, "assets/c"), "TTF");
	writeFileSync(
		join(dir, "metadata.json"),
		JSON.stringify({
			version: 0,
			bundler: "metro",
			fileMetadata: {
				ios: {
					bundle: "_expo/static/js/ios/entry-abc.hbc",
					assets: [
						{ path: "assets/a", ext: "png" },
						{ path: "assets/b", ext: "png" },
						{ path: "assets/c", ext: "ttf" },
					],
				},
			},
		}),
	);
	return dir;
}

describe("manifest", () => {
	const dir = fakeExport();
	const exported = readPlatformExport(dir, "ios");
	const built = buildManifest({
		exported,
		channel: "production",
		runtimeVersion: "rowcat-native-1",
		apiOrigin: "https://api.example.com",
		assetBaseUrl: "https://ota.example.com/",
		expoClient: { extra: { eas: { projectId: "p" } } },
		now: new Date("2026-10-03T01:02:03.004Z"),
	});
	const manifest = MobileUpdateManifest.parse(JSON.parse(built.body));

	it("the protocol's shape, with the time exactly as the string to be signed", () => {
		expect(manifest.createdAt).toBe("2026-10-03T01:02:03.004Z");
		expect(manifest.runtimeVersion).toBe("rowcat-native-1");
		expect(manifest.metadata).toEqual({
			channel: "production",
			platform: "ios",
			apiOrigin: "https://api.example.com",
		});
	});

	it("the hash is Base64URL SHA-256 and the address is that hash", () => {
		const sha = createHash("sha256").update("BUNDLE").digest();
		expect(manifest.launchAsset.hash).toBe(sha.toString("base64url"));
		expect(manifest.launchAsset.url).toBe(
			`https://ota.example.com/mobile-updates/assets/sha256/${sha.toString("hex")}`,
		);
		expect(manifest.launchAsset.key).toBe(
			createHash("md5").update("BUNDLE").digest("hex"),
		);
	});

	it("assets with the same bytes are carried once", () => {
		expect(manifest.assets).toHaveLength(2);
		expect(manifest.assets.map((asset) => asset.fileExtension).sort()).toEqual([
			".png",
			".ttf",
		]);
		expect(manifest.assets.find((asset) => asset.fileExtension === ".ttf")?.contentType).toBe(
			"font/ttf",
		);
	});

	it("carries the config Constants.expoConfig reads", () => {
		expect(manifest.extra.expoClient).toEqual({
			extra: { eas: { projectId: "p" } },
		});
	});

	it("the bundle's asset list carries sizes", () => {
		expect(built.assets.map((asset) => asset.byteSize)).toEqual([6, 5, 3]);
	});

	it("a republish gives the same assets with a new id and a new time", () => {
		const again = buildRepublishedManifest({
			previousBody: built.body,
			now: new Date("2026-10-04T00:00:00.000Z"),
		});
		expect(again.manifest.id).not.toBe(manifest.id);
		expect(again.manifest.createdAt).toBe("2026-10-04T00:00:00.000Z");
		expect(again.manifest.launchAsset).toEqual(manifest.launchAsset);
		expect(again.manifest.assets).toEqual(manifest.assets);
	});

	it("a rollback instruction's time is the signed commitTime", () => {
		const directive = buildRollbackDirective({
			channel: "preview",
			platform: "android",
			runtimeVersion: "rowcat-native-1",
			now: new Date("2026-10-03T00:00:00.000Z"),
		});
		expect(JSON.parse(directive.body)).toEqual({
			type: "rollBackToEmbedded",
			parameters: { commitTime: "2026-10-03T00:00:00.000Z" },
			extra: {
				channel: "preview",
				platform: "android",
				runtimeVersion: "rowcat-native-1",
			},
		});
	});

	it("the asset origin is https with no query", () => {
		expect(checkAssetBaseUrl("https://ota.example.com")).toBeNull();
		expect(checkAssetBaseUrl("http://localhost:8787")).toBeNull();
		expect(checkAssetBaseUrl("http://ota.example.com")).not.toBeNull();
		expect(checkAssetBaseUrl("https://ota.example.com/?x=1")).not.toBeNull();
		expect(checkAssetBaseUrl("https://user:pw@ota.example.com")).not.toBeNull();
	});
});

function opensslKey(name: string): { key: string; cert: string } {
	const dir = mkdtempSync(join(tmpdir(), "rowcat-ota-key-"));
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			join(dir, "k.pem"),
			"-out",
			join(dir, "c.pem"),
			"-days",
			"2",
			"-subj",
			`/CN=${name}`,
		],
		{ stdio: "ignore" },
	);
	return {
		key: readFileSync(join(dir, "k.pem"), "utf8"),
		cert: readFileSync(join(dir, "c.pem"), "utf8"),
	};
}

describe("signatures", () => {
	const production = opensslKey("rowcat-production-1");
	const preview = opensslKey("rowcat-preview-1");

	it("signs and verifies with the committed certificate", () => {
		const key = loadSigningKey({ ROWCAT_OTA_SIGNING_KEY: production.key });
		const signature = signForKeyId({
			body: '{"a":1}',
			key,
			keyId: "rowcat-production-1",
			certificatePem: production.cert,
		});
		expect(signature.alg).toBe("rsa-v1_5-sha256");
		expect(verifyWithCertificate('{"a":1}', signature.sig, production.cert)).toBe(
			true,
		);
		expect(verifyWithCertificate('{"a":2}', signature.sig, production.cert)).toBe(
			false,
		);
	});

	it("doesn't sign with another channel's key — that binary would refuse the signature", () => {
		const key = loadSigningKey({ ROWCAT_OTA_SIGNING_KEY: preview.key });
		expect(() =>
			signForKeyId({
				body: "{}",
				key,
				keyId: "rowcat-production-1",
				certificatePem: production.cert,
			}),
		).toThrow(/doesn't pair/);
	});

	it("stops with no key or two keys, and the error doesn't mention the key", () => {
		expect(() => loadSigningKey({})).toThrow();
		expect(() =>
			loadSigningKey({
				ROWCAT_OTA_SIGNING_KEY: production.key,
				ROWCAT_OTA_SIGNING_KEY_FILE: "/x",
			}),
		).toThrow();
		try {
			loadSigningKey({ ROWCAT_OTA_SIGNING_KEY: "not a key MIIsecret" });
		} catch (error) {
			expect(String(error)).not.toContain("MIIsecret");
		}
	});

	it("stops when the exported bundle contains a signing key", () => {
		const body = production.key.split("\n")[3] as string;
		expect(() =>
			assertNoSecretsInBundle(Buffer.from(`var x="${body}"`), {
				ROWCAT_OTA_SIGNING_KEY: production.key,
			}),
		).toThrow();
		expect(() =>
			assertNoSecretsInBundle(Buffer.from("var x=1"), {
				ROWCAT_OTA_SIGNING_KEY: production.key,
			}),
		).not.toThrow();
	});
});

describe("storage — never writes different bytes to the same address", () => {
	it("the same bytes are idempotent", async () => {
		const store = new FileArtifactStore(mkdtempSync(join(tmpdir(), "ota-store-")));
		expect(await store.putAsset(Buffer.from("x"), "image/png")).toBe("created");
		expect(await store.putAsset(Buffer.from("x"), "image/png")).toBe("existing");
	});

	it("stops when different bytes exist at the same hash address", async () => {
		const root = mkdtempSync(join(tmpdir(), "ota-store-"));
		const store = new FileArtifactStore(root);
		await store.putAsset(Buffer.from("x"), "image/png");
		const hex = createHash("sha256").update("x").digest("hex");
		writeFileSync(join(root, "mobile-updates/assets/sha256", hex), "tampered");
		await expect(store.putAsset(Buffer.from("x"), "image/png")).rejects.toBeInstanceOf(
			ArtifactConflictError,
		);
	});

	it("doesn't overwrite archived copies either", async () => {
		const store = new FileArtifactStore(mkdtempSync(join(tmpdir(), "ota-store-")));
		await store.putReleaseArchive("mobile-updates/releases/a.json", "{}");
		await expect(
			store.putReleaseArchive("mobile-updates/releases/a.json", '{"x":1}'),
		).rejects.toBeInstanceOf(ArtifactConflictError);
	});

	it("S3: writes with a conditional write, and on 412 compares the existing bytes", async () => {
		const objects = new Map<string, Uint8Array>();
		const seen: { method: string; ifNoneMatch: string | null; cache: string | null }[] = [];
		const fetchImpl = (async (request: Request) => {
			const key = new URL(request.url).pathname;
			seen.push({
				method: request.method,
				ifNoneMatch: request.headers.get("if-none-match"),
				cache: request.headers.get("cache-control"),
			});
			if (request.method === "PUT") {
				if (objects.has(key)) return new Response(null, { status: 412 });
				objects.set(key, new Uint8Array(await request.arrayBuffer()));
				return new Response(null, { status: 200 });
			}
			const stored = objects.get(key);
			return stored
				? new Response(Buffer.from(stored))
				: new Response(null, { status: 404 });
		}) as typeof fetch;
		const store = new S3ArtifactStore(
			{
				endpoint: "https://s3.example.com",
				bucket: "ota",
				region: "auto",
				accessKeyId: "id",
				secretAccessKey: "secret",
			},
			fetchImpl,
		);
		expect(await store.putAsset(Buffer.from("x"), "image/png")).toBe("created");
		expect(await store.putAsset(Buffer.from("x"), "image/png")).toBe("existing");
		expect(seen[0]).toEqual({
			method: "PUT",
			ifNoneMatch: "*",
			cache: "public, max-age=31536000, immutable",
		});
		const [key] = [...objects.keys()];
		objects.set(key as string, new Uint8Array([1, 2, 3]));
		await expect(store.putAsset(Buffer.from("x"), "image/png")).rejects.toBeInstanceOf(
			ArtifactConflictError,
		);
	});

	it("half an S3 config stops instead of falling back to local", () => {
		expect(() =>
			artifactStoreFromEnv({
				ROWCAT_OTA_STORAGE: "s3",
				ROWCAT_OTA_S3_ENDPOINT: "https://s3.example.com",
			}),
		).toThrow(/incomplete/);
		expect(() => artifactStoreFromEnv({})).toThrow();
	});
});

describe("runtime generation decision", () => {
	const lock = {
		generations: {
			"rowcat-native-1": { fingerprint: "aaa", recordedAt: "2026-10-03" },
		},
	};

	it("passes when it matches the record", () => {
		expect(judgeRuntime(lock, "rowcat-native-1", "aaa").ok).toBe(true);
	});

	it("stops when native changed but the generation stayed", () => {
		const judged = judgeRuntime(lock, "rowcat-native-1", "bbb");
		expect(judged.ok).toBe(false);
		expect(judged.ok ? "" : judged.problem).toContain("RUNTIME_VERSION");
	});

	it("doesn't publish with an unrecorded generation", () => {
		expect(judgeRuntime(lock, "rowcat-native-2", "bbb").ok).toBe(false);
	});
});

describe("result file — what CI reads when reporting to the operations console", () => {
	it("carries only the stage that stopped and the registered ids, never error sentences", async () => {
		const { StageTracker, writeResultFile } = await import("./result.ts");
		const { mkdtempSync, readFileSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const stages = new StageTracker();
		stages.enter("signing");
		const path = join(mkdtempSync(join(tmpdir(), "ota-result-")), "r.json");
		writeResultFile(path, { ok: false, stage: stages.current, releases: [] });
		const written = JSON.parse(readFileSync(path, "utf8"));
		expect(Object.keys(written).sort()).toEqual(["ok", "releases", "stage"]);
		expect(written).toEqual({ ok: false, stage: "signing", releases: [] });
	});
});
