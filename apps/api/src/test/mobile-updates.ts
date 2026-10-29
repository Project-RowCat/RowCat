import { execFileSync } from "node:child_process";
import { createHash, randomUUID, sign } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	MobileUpdateChannel,
	MobileUpdatePlatform,
	MobileUpdateReleaseBundle,
} from "@rowcat/contracts";

/**
 * Plays the release environment for OTA tests: generates keys and signs bodies. This is the other
 * side of the test, not server runtime (like sync tests playing the device side). Keys are created
 * per test process with `openssl` in the OS temp dir; no private key is committed.
 */

export interface TestKey {
	keyId: string;
	privateKeyPem: string;
	certificatePem: string;
}

const keys = new Map<string, TestKey>();

export function testKey(keyId: string): TestKey {
	const cached = keys.get(keyId);
	if (cached) return cached;
	const dir = mkdtempSync(join(tmpdir(), "rowcat-ota-test-"));
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			join(dir, "key.pem"),
			"-out",
			join(dir, "cert.pem"),
			"-days",
			"2",
			"-subj",
			`/CN=${keyId}`,
		],
		{ stdio: "ignore" },
	);
	const key = {
		keyId,
		privateKeyPem: readFileSync(join(dir, "key.pem"), "utf8"),
		certificatePem: readFileSync(join(dir, "cert.pem"), "utf8"),
	};
	keys.set(keyId, key);
	return key;
}

export const signBody = (body: string, key: TestKey): string =>
	sign("sha256", Buffer.from(body, "utf8"), key.privateKeyPem).toString(
		"base64",
	);

const b64urlSha256 = (value: string) =>
	createHash("sha256").update(value).digest("base64url");

export interface BundleOptions {
	platform?: MobileUpdatePlatform;
	channel?: MobileUpdateChannel;
	runtimeVersion?: string;
	apiOrigin?: string;
	createdAt?: Date;
	/** Content seed: the same seed yields the same asset set (same content key). */
	content?: string;
	keyId?: string;
	assetBase?: string;
	republishOf?: string | null;
	kind?: "update" | "rollback_to_embedded";
}

export function testBundle(
	options: BundleOptions = {},
): MobileUpdateReleaseBundle {
	const platform = options.platform ?? "ios";
	const channel = options.channel ?? "production";
	const runtimeVersion = options.runtimeVersion ?? "rowcat-native-1";
	const apiOrigin = options.apiOrigin ?? "http://localhost:3001";
	const createdAt = (options.createdAt ?? new Date()).toISOString();
	const keyId = options.keyId ?? `rowcat-${channel}-1`;
	const key = testKey(keyId);
	const id = randomUUID();
	const assetBase = options.assetBase ?? "https://updates.example.test";
	const content = options.content ?? id;

	if (options.kind === "rollback_to_embedded") {
		const body = JSON.stringify({
			type: "rollBackToEmbedded",
			parameters: { commitTime: createdAt },
			extra: { channel, platform, runtimeVersion },
		});
		return {
			formatVersion: 1,
			release: {
				id,
				kind: "rollback_to_embedded",
				platform,
				channel,
				runtimeVersion,
				createdAt,
				apiOrigin,
				republishOf: null,
				sourceCommit: "a".repeat(40),
			},
			body,
			signatures: [{ keyId, alg: "rsa-v1_5-sha256", sig: signBody(body, key) }],
			assets: [],
		};
	}

	const asset = (seed: string, contentType: string, ext?: string) => {
		const hash = b64urlSha256(seed);
		return {
			hash,
			key: createHash("md5").update(seed).digest("hex"),
			contentType,
			...(ext ? { fileExtension: ext } : {}),
			url: `${assetBase}/mobile-updates/assets/sha256/${Buffer.from(hash, "base64url").toString("hex")}`,
		};
	};
	const launchAsset = asset(`bundle:${content}`, "application/javascript");
	const image = asset(`image:${content}`, "image/png", ".png");
	const manifest = {
		id,
		createdAt,
		runtimeVersion,
		launchAsset,
		assets: [image],
		metadata: { channel, platform, apiOrigin },
		extra: {
			expoClient: { name: "RowCat", extra: { eas: { projectId: "p" } } },
		},
	};
	const body = JSON.stringify(manifest);
	return {
		formatVersion: 1,
		release: {
			id,
			kind: "update",
			platform,
			channel,
			runtimeVersion,
			createdAt,
			apiOrigin,
			republishOf: options.republishOf ?? null,
			sourceCommit: "b".repeat(40),
		},
		body,
		signatures: [{ keyId, alg: "rsa-v1_5-sha256", sig: signBody(body, key) }],
		assets: [
			{ ...launchAsset, byteSize: 100 },
			{ ...image, byteSize: 50 },
		],
	};
}

export const certificatesFor = (...keyIds: string[]): Map<string, string> =>
	new Map(keyIds.map((keyId) => [keyId, testKey(keyId).certificatePem]));
