import { createHash } from "node:crypto";
import {
	type MobileUpdateAsset,
	MobileUpdateDirective,
	MobileUpdateManifest,
	MobileUpdateReleaseBundle,
	mobileUpdateKeyIdChannel,
} from "@rowcat/contracts";
import { checkCertificate, verifyBodySignature } from "./signature.ts";

/**
 * Registration check: does what the bundle claims about itself match what the signed body says?
 *
 * The bundle's structured fields (channel, platform, runtime, time, assets) become DB columns and
 * selection reads those columns, but clients trust the signed body. If the two diverged, the server
 * could pick from the production stream a release whose body says preview, so every value that will
 * become a column is re-read from the body and compared; any mismatch rejects registration.
 *
 * Pure: it never touches the DB. "Same id already exists" and "same content already exists" are
 * answered by queries inside the transaction (`index.ts`).
 */

export interface RegistrationContext {
	/** This deployment's public API origin (`API_ORIGIN`); must equal the one baked into the bundle. */
	deploymentApiOrigin: string;
	/** Key id to trusted root certificate (PEM), the files committed to the repository. */
	certificates: ReadonlyMap<string, string>;
	now: Date;
}

export interface ValidatedRelease {
	bundle: MobileUpdateReleaseBundle;
	createdAt: Date;
	contentKey: string;
}

export type RegistrationValidation =
	| { ok: true; release: ValidatedRelease }
	| { ok: false; problems: string[] };

const sameOrigin = (left: string, right: string): boolean => {
	try {
		return new URL(left).origin === new URL(right).origin;
	} catch {
		return false;
	}
};

/** Only local verification deployments may use http assets; everywhere else assets are https. */
const isLocalOrigin = (origin: string): boolean => {
	try {
		const host = new URL(origin).hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "[::1]" ||
			host.endsWith(".localhost") ||
			host.endsWith(".test")
		);
	} catch {
		return false;
	}
};

const base64UrlToHex = (value: string): string =>
	Buffer.from(value, "base64url").toString("hex");

/**
 * Key for "is this the same code": a hash over the set of executable assets (key and hash).
 *
 * Sorted so order does not matter. Exporting the same source twice gives identical Metro output and
 * so the same key, which stops a re-run of a failed publish from becoming a second release.
 */
export const contentKeyOf = (
	launchAsset: Pick<MobileUpdateAsset, "key" | "hash">,
	assets: readonly Pick<MobileUpdateAsset, "key" | "hash">[],
): string =>
	createHash("sha256")
		.update(
			[
				`launch ${launchAsset.key} ${launchAsset.hash}`,
				...assets.map((asset) => `asset ${asset.key} ${asset.hash}`).sort(),
			].join("\n"),
		)
		.digest("hex");

const assetIdentity = (asset: {
	key: string;
	hash: string;
	url: string;
	contentType: string;
}): string =>
	`${asset.key}\u0000${asset.hash}\u0000${asset.url}\u0000${asset.contentType}`;

function checkAssetUrls(
	assets: readonly { url: string; hash: string }[],
	allowHttp: boolean,
	problems: string[],
): void {
	let origin: string | null = null;
	for (const asset of assets) {
		let url: URL;
		try {
			url = new URL(asset.url);
		} catch {
			problems.push(`couldn't read the asset address: ${asset.url}`);
			continue;
		}
		if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:"))
			problems.push(`the asset address is not https: ${asset.url}`);
		if (url.username || url.password || url.search || url.hash)
			problems.push(
				`the asset address has credentials, a query or a fragment: ${asset.url}`,
			);
		if (origin === null) origin = url.origin;
		else if (url.origin !== origin)
			problems.push(`asset addresses don't share one origin: ${url.origin}`);
		// The URL's last segment is the bytes' hash (`…/sha256/<hex>`). If they diverge, clients download
		// bytes the body does not describe and the whole update is discarded at hash verification; catch
		// that here instead of on devices.
		const expected = `/sha256/${base64UrlToHex(asset.hash)}`;
		if (!url.pathname.endsWith(expected))
			problems.push(`the asset address is not a hash address: ${asset.url}`);
	}
}

export function validateReleaseBundle(
	raw: unknown,
	context: RegistrationContext,
): RegistrationValidation {
	const parsed = MobileUpdateReleaseBundle.safeParse(raw);
	if (!parsed.success)
		return {
			ok: false,
			problems: parsed.error.issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`,
			),
		};
	const bundle = parsed.data;
	const { release } = bundle;
	const problems: string[] = [];

	if (!sameOrigin(release.apiOrigin, context.deploymentApiOrigin))
		problems.push(
			`the bundle's API origin (${release.apiOrigin}) differs from this deployment (${context.deploymentApiOrigin}) — ` +
				"that bundle is for a binary that talks to another backend",
		);

	// Verify every signature; one bad signature rejects the bundle. Tolerating the rest because one is
	// valid would be a gap during key rotation.
	const keyIds = new Set<string>();
	for (const signature of bundle.signatures) {
		if (keyIds.has(signature.keyId))
			problems.push(`two signatures with the same key: ${signature.keyId}`);
		keyIds.add(signature.keyId);
		if (mobileUpdateKeyIdChannel(signature.keyId) !== release.channel) {
			problems.push(
				`signing key ${signature.keyId} is not a ${release.channel} channel key`,
			);
			continue;
		}
		const certificate = context.certificates.get(signature.keyId);
		if (!certificate) {
			problems.push(
				`no trusted certificate was given for key ${signature.keyId}`,
			);
			continue;
		}
		const certificateCheck = checkCertificate(certificate, context.now);
		if (!certificateCheck.ok) {
			problems.push(`key ${signature.keyId}: ${certificateCheck.problem}`);
			continue;
		}
		if (!verifyBodySignature(bundle.body, signature.sig, certificate))
			problems.push(
				`key ${signature.keyId}: the signature doesn't match the body`,
			);
	}

	let body: unknown;
	try {
		body = JSON.parse(bundle.body);
	} catch {
		problems.push("the body isn't JSON");
		return { ok: false, problems };
	}

	const createdAt = new Date(release.createdAt);
	let contentKey = "";

	if (release.kind === "update") {
		const manifest = MobileUpdateManifest.safeParse(body);
		if (!manifest.success) {
			problems.push(
				...manifest.error.issues.map(
					(issue) => `manifest.${issue.path.join(".")}: ${issue.message}`,
				),
			);
			return { ok: false, problems };
		}
		const m = manifest.data;
		if (m.id !== release.id)
			problems.push("the manifest id differs from the release id");
		if (m.createdAt !== release.createdAt)
			problems.push("the manifest createdAt differs from the release time");
		if (m.runtimeVersion !== release.runtimeVersion)
			problems.push("the manifest runtime differs from the release runtime");
		if (m.metadata.channel !== release.channel)
			problems.push("the manifest's channel differs from the release channel");
		if (m.metadata.platform !== release.platform)
			problems.push(
				"the manifest's platform differs from the release platform",
			);
		if (!sameOrigin(m.metadata.apiOrigin, release.apiOrigin))
			problems.push("the manifest's API origin differs from the release's");

		const signedAssets = [m.launchAsset, ...m.assets];
		const declared = new Set(bundle.assets.map(assetIdentity));
		const signed = new Set(signedAssets.map(assetIdentity));
		if (
			declared.size !== signed.size ||
			[...signed].some((identity) => !declared.has(identity))
		)
			problems.push(
				"the bundle's asset list differs from the signed manifest's assets",
			);
		checkAssetUrls(signedAssets, isLocalOrigin(release.apiOrigin), problems);
		contentKey = contentKeyOf(m.launchAsset, m.assets);
	} else {
		const directive = MobileUpdateDirective.safeParse(body);
		if (!directive.success) {
			problems.push(
				...directive.error.issues.map(
					(issue) => `directive.${issue.path.join(".")}: ${issue.message}`,
				),
			);
			return { ok: false, problems };
		}
		const d = directive.data;
		if (d.parameters.commitTime !== release.createdAt)
			problems.push("the directive commitTime differs from the release time");
		if (
			d.extra?.channel !== release.channel ||
			d.extra?.platform !== release.platform ||
			d.extra?.runtimeVersion !== release.runtimeVersion
		)
			problems.push(
				"the directive's channel, platform or runtime differs from the release",
			);
		if (bundle.assets.length > 0)
			problems.push("a rollback instruction has no assets");
		// A directive is identified by its time, not its content; issuing the same one twice is normal.
		contentKey = `directive:${release.id}`;
	}

	if (problems.length > 0) return { ok: false, problems };
	return { ok: true, release: { bundle, createdAt, contentKey } };
}
