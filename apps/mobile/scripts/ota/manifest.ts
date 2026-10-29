import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	MobileUpdateChannel,
	MobileUpdateDirective,
	MobileUpdateManifest,
	MobileUpdatePlatform,
	MobileUpdateStoredAsset,
} from "@rowcat/contracts";

/**
 * Pure layer that turns `expo export` output into the bytes to sign (the manifest).
 *
 * ```text
 * dist/metadata.json   fileMetadata[platform] = { bundle, assets: [{ path, ext }] }
 *   → per file: sha256 (Base64URL) · md5 (key) · size · content type
 *   → asset URL = <asset origin>/mobile-updates/assets/sha256/<hex>
 *   → manifest (JSON string) - this exact string is signed and passes through the server verbatim
 * ```
 *
 * The key is md5 because Metro names assets inside the bundle by their md5 (`assets/<md5>`) and
 * expo-updates uses the manifest `key` to map that name to a disk location. Assets in the store
 * binary share the key, so unchanged images and fonts are reused from the binary instead of
 * downloaded. Integrity is guarded by `hash` (SHA-256), not the key: the client compares the
 * downloaded bytes against it.
 *
 * The URL is a hash because bytes at one URL must never change (spec: assets must not change or
 * vanish). Naming by file name or release id would make that promise depend on the storage's
 * diligence; naming by hash makes a violation inexpressible, and releases share assets for free.
 */

export const ASSET_KEY_PREFIX = "mobile-updates/assets/sha256/";
export const RELEASE_KEY_PREFIX = "mobile-updates/releases/";

const CONTENT_TYPES: Record<string, string> = {
	js: "application/javascript",
	hbc: "application/javascript",
	json: "application/json",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ttf: "font/ttf",
	otf: "font/otf",
	woff: "font/woff",
	woff2: "font/woff2",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	html: "text/html",
	wasm: "application/wasm",
	txt: "text/plain",
};

export const contentTypeFor = (ext: string): string =>
	CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";

export interface ExportedFile {
	/** Path relative to the export folder. */
	path: string;
	ext: string;
	bytes: Buffer;
	sha256Hex: string;
	/** The protocol's `hash`: Base64URL(SHA-256), unpadded. */
	hash: string;
	md5: string;
}

export function readExportedFile(
	exportDir: string,
	path: string,
	ext: string,
): ExportedFile {
	const bytes = readFileSync(join(exportDir, path));
	const sha256 = createHash("sha256").update(bytes).digest();
	return {
		path,
		ext,
		bytes,
		sha256Hex: sha256.toString("hex"),
		hash: sha256.toString("base64url"),
		md5: createHash("md5").update(bytes).digest("hex"),
	};
}

interface ExportMetadata {
	fileMetadata: Record<
		string,
		{ bundle: string; assets: { path: string; ext: string }[] }
	>;
}

export interface PlatformExport {
	platform: MobileUpdatePlatform;
	launch: ExportedFile;
	assets: ExportedFile[];
}

export function readPlatformExport(
	exportDir: string,
	platform: MobileUpdatePlatform,
): PlatformExport {
	const metadata = JSON.parse(
		readFileSync(join(exportDir, "metadata.json"), "utf8"),
	) as ExportMetadata;
	const entry = metadata.fileMetadata[platform];
	if (!entry)
		throw new Error(`the export has no ${platform} bundle (metadata.json)`);
	const launchExt = entry.bundle.split(".").at(-1) ?? "js";
	// The same bytes under two names (same image) are listed once; the key is identical.

	const seen = new Set<string>();
	const assets: ExportedFile[] = [];
	for (const asset of entry.assets) {
		const file = readExportedFile(exportDir, asset.path, asset.ext);
		const identity = `${file.md5}.${file.ext}`;
		if (seen.has(identity)) continue;
		seen.add(identity);
		assets.push(file);
	}
	return {
		platform,
		launch: readExportedFile(exportDir, entry.bundle, launchExt),
		assets,
	};
}

export const assetUrlFor = (assetBaseUrl: string, sha256Hex: string): string =>
	`${assetBaseUrl.replace(/\/+$/, "")}/${ASSET_KEY_PREFIX}${sha256Hex}`;

/**
 * Asset origin rule: https, with no credentials, query or fragment; only local verification origins
 * may use http. Registration re-checks the same rule
 * (`apps/api/src/services/mobile-updates/registration.ts`).
 */
export function checkAssetBaseUrl(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return `couldn't read the asset origin: ${value}`;
	}
	const local =
		url.hostname === "localhost" ||
		url.hostname === "127.0.0.1" ||
		url.hostname.endsWith(".localhost") ||
		url.hostname.endsWith(".test");
	if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
		return `the asset origin is https: ${value}`;
	if (url.username || url.password || url.search || url.hash)
		return `the asset origin carries no credentials, query or fragment: ${value}`;
	return null;
}

export interface BuiltRelease {
	id: string;
	createdAt: string;
	body: string;
	assets: MobileUpdateStoredAsset[];
}

export function buildManifest(input: {
	exported: PlatformExport;
	channel: MobileUpdateChannel;
	runtimeVersion: string;
	apiOrigin: string;
	assetBaseUrl: string;
	expoClient: Record<string, unknown>;
	now: Date;
	id?: string;
}): BuiltRelease {
	const { exported } = input;
	const id = input.id ?? randomUUID();
	const createdAt = input.now.toISOString();
	const launchAsset = {
		hash: exported.launch.hash,
		key: exported.launch.md5,
		contentType: "application/javascript",
		url: assetUrlFor(input.assetBaseUrl, exported.launch.sha256Hex),
	};
	const assets = exported.assets.map((file) => ({
		hash: file.hash,
		key: file.md5,
		contentType: contentTypeFor(file.ext),
		fileExtension: `.${file.ext}`,
		url: assetUrlFor(input.assetBaseUrl, file.sha256Hex),
	}));
	const manifest: MobileUpdateManifest = {
		id,
		createdAt,
		runtimeVersion: input.runtimeVersion,
		launchAsset,
		assets,
		metadata: {
			channel: input.channel,
			platform: exported.platform,
			apiOrigin: input.apiOrigin,
		},
		extra: { expoClient: input.expoClient },
	};
	return {
		id,
		createdAt,
		body: JSON.stringify(manifest),
		assets: [
			{ ...launchAsset, byteSize: exported.launch.bytes.length },
			...assets.map((asset, index) => ({
				...asset,
				byteSize: (exported.assets[index] as ExportedFile).bytes.length,
			})),
		],
	};
}

/**
 * Republish: the body to re-sign with the previous release's assets under a new id and time.
 *
 * Rollback uses it. Clients only accept a manifest newer than what they run, so returning an
 * install that took bad B to A means reissuing A's code with a timestamp newer than B, not
 * re-enabling A. The asset bytes are already in storage, so nothing is uploaded.
 */
export function buildRepublishedManifest(input: {
	previousBody: string;
	now: Date;
	id?: string;
}): BuiltRelease & { manifest: MobileUpdateManifest } {
	const previous = JSON.parse(input.previousBody) as MobileUpdateManifest;
	const id = input.id ?? randomUUID();
	const createdAt = input.now.toISOString();
	const manifest: MobileUpdateManifest = { ...previous, id, createdAt };
	return {
		id,
		createdAt,
		body: JSON.stringify(manifest),
		manifest,
		assets: [],
	};
}

export function buildRollbackDirective(input: {
	channel: MobileUpdateChannel;
	platform: MobileUpdatePlatform;
	runtimeVersion: string;
	now: Date;
	id?: string;
}): BuiltRelease {
	const createdAt = input.now.toISOString();
	const directive: MobileUpdateDirective = {
		type: "rollBackToEmbedded",
		parameters: { commitTime: createdAt },
		extra: {
			channel: input.channel,
			platform: input.platform,
			runtimeVersion: input.runtimeVersion,
		},
	};
	return {
		id: input.id ?? randomUUID(),
		createdAt,
		body: JSON.stringify(directive),
		assets: [],
	};
}
