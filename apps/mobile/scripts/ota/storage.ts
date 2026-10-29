import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AwsClient } from "aws4fetch";
import { ASSET_KEY_PREFIX } from "./manifest.ts";

/**
 * Store for update assets: immutable, hash-addressed objects.
 *
 * Deliberately not the member-media port (`apps/api/src/lib/media/storage.ts`). That one carries
 * ownership and lifecycle (replacement, account-deletion cleanup) and the API streams its bytes;
 * this one has no owner, never deletes, and the API streams nothing (clients fetch from the CDN).
 * Merging them would put "delete a member's bytes on account deletion" and "bytes at an address are
 * forever" in one interface.
 *
 * ```text
 * mobile-updates/assets/sha256/<hex>                        one asset, shared across releases
 * mobile-updates/releases/<channel>/<platform>/<id>.json    archive of the signed bundle
 * ```
 *
 * Never write different bytes to the same address. Writes are create-if-absent (`If-None-Match:
 * *`); if the object exists its bytes are fetched and hashed. Equal is a no-op (retry, or another
 * release sharing the asset); different stops, because someone altered that object and every client
 * would drop an update built on it at hash verification. Callers do not choose keys for the same
 * reason: the key is computed from the bytes.
 */

export interface UpdateArtifactStore {
	readonly description: string;
	/** Writes a hash-addressed asset; if present, compares bytes and does nothing. */
	putAsset(
		bytes: Buffer,
		contentType: string,
	): Promise<"created" | "existing">;
	/** Archive copy; stops if the same key holds different bytes. */
	putReleaseArchive(key: string, body: string): Promise<"created" | "existing">;
}

export class ArtifactConflictError extends Error {}

const sha256Hex = (bytes: Buffer) =>
	createHash("sha256").update(bytes).digest("hex");

export const assetKeyFor = (bytes: Buffer): string =>
	`${ASSET_KEY_PREFIX}${sha256Hex(bytes)}`;

/* Local files: verification and tests. */

export class FileArtifactStore implements UpdateArtifactStore {
	readonly description: string;

	constructor(private readonly root: string) {
		this.description = `file:${root}`;
	}

	private write(key: string, bytes: Buffer): "created" | "existing" {
		const path = join(this.root, key);
		let existing: Buffer | null = null;
		try {
			existing = readFileSync(path);
		} catch {
			existing = null;
		}
		if (existing) {
			if (sha256Hex(existing) !== sha256Hex(bytes))
				throw new ArtifactConflictError(
					`different bytes already exist at ${key} — immutable objects aren't overwritten`,
				);
			return "existing";
		}
		mkdirSync(dirname(path), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, bytes);
		renameSync(temporary, path);
		return "created";
	}

	/** A local file has no place for a content type; that is the static server's job. */
	async putAsset(
		bytes: Buffer,
		_contentType?: string,
	): Promise<"created" | "existing"> {
		return this.write(assetKeyFor(bytes), bytes);
	}

	async putReleaseArchive(
		key: string,
		body: string,
	): Promise<"created" | "existing"> {
		return this.write(key, Buffer.from(body, "utf8"));
	}
}

/* S3-compatible storage: R2, S3, MinIO. */

export interface S3Settings {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/**
 * Cache header for asset responses: one year, immutable, since the address is a hash. Archives are
 * human-read files and get no cache header.
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export class S3ArtifactStore implements UpdateArtifactStore {
	readonly description: string;
	private readonly client: AwsClient;
	private readonly base: string;

	constructor(
		settings: S3Settings,
		private readonly fetchImpl: typeof fetch = fetch,
	) {
		this.client = new AwsClient({
			accessKeyId: settings.accessKeyId,
			secretAccessKey: settings.secretAccessKey,
			region: settings.region,
			service: "s3",
		});
		this.base = `${settings.endpoint.replace(/\/+$/, "")}/${settings.bucket}`;
		this.description = `s3:${new URL(settings.endpoint).host}/${settings.bucket}`;
	}

	private async send(
		key: string,
		init: RequestInit & { headers?: Record<string, string> },
	): Promise<Response> {
		const request = await this.client.sign(`${this.base}/${key}`, init);
		return this.fetchImpl(request);
	}

	private async write(
		key: string,
		bytes: Buffer,
		headers: Record<string, string>,
	): Promise<"created" | "existing"> {
		const response = await this.send(key, {
			method: "PUT",
			body: new Uint8Array(bytes),
			headers: { ...headers, "If-None-Match": "*" },
		});
		if (response.ok) return "created";
		// 412/409 means it already exists (conditional write); check the bytes match ours.
		if (response.status === 412 || response.status === 409) {
			const existing = await this.send(key, { method: "GET" });
			if (!existing.ok)
				throw new Error(`couldn't read ${key} back (${existing.status})`);
			const stored = Buffer.from(await existing.arrayBuffer());
			if (sha256Hex(stored) !== sha256Hex(bytes))
				throw new ArtifactConflictError(
					`different bytes already exist at ${key} — immutable objects aren't overwritten`,
				);
			return "existing";
		}
		throw new Error(`couldn't write ${key} (${response.status})`);
	}

	async putAsset(
		bytes: Buffer,
		contentType: string,
	): Promise<"created" | "existing"> {
		return this.write(assetKeyFor(bytes), bytes, {
			"Content-Type": contentType,
			"Cache-Control": IMMUTABLE_CACHE_CONTROL,
		});
	}

	async putReleaseArchive(
		key: string,
		body: string,
	): Promise<"created" | "existing"> {
		return this.write(key, Buffer.from(body, "utf8"), {
			"Content-Type": "application/json",
		});
	}
}

/**
 * Picks the store from settings. A half configuration is an error: if an S3 value is empty and this
 * silently fell back to local files, publishing would succeed with assets on no CDN and every
 * device would fail to download.
 */
export function artifactStoreFromEnv(
	env: Readonly<Record<string, string | undefined>>,
): UpdateArtifactStore {
	const kind = env.ROWCAT_OTA_STORAGE?.trim();
	if (kind === "file") {
		const root = env.ROWCAT_OTA_STORAGE_DIR?.trim();
		if (!root)
			throw new Error("ROWCAT_OTA_STORAGE=file needs ROWCAT_OTA_STORAGE_DIR");
		return new FileArtifactStore(root);
	}
	if (kind === "s3") {
		const settings = {
			endpoint: env.ROWCAT_OTA_S3_ENDPOINT?.trim() ?? "",
			bucket: env.ROWCAT_OTA_S3_BUCKET?.trim() ?? "",
			region: env.ROWCAT_OTA_S3_REGION?.trim() || "auto",
			accessKeyId: env.ROWCAT_OTA_S3_ACCESS_KEY_ID?.trim() ?? "",
			secretAccessKey: env.ROWCAT_OTA_S3_SECRET_ACCESS_KEY?.trim() ?? "",
		};
		const missing = Object.entries(settings)
			.filter(([, value]) => !value)
			.map(([name]) => name);
		if (missing.length > 0)
			throw new Error(`the S3 storage config is incomplete: ${missing.join(", ")}`);
		return new S3ArtifactStore(settings);
	}
	throw new Error("ROWCAT_OTA_STORAGE is s3 or file");
}
