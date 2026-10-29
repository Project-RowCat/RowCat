import { z } from "zod";
import { AppPlatform } from "./ops.ts";

/**
 * Mobile OTA protocol boundary: the shapes that cross it when we host Expo Updates protocol v1.
 * expo-updates is the client and is not reimplemented here.
 * - Contains: vocabulary (channel, runtime generation, status, kind, signing key id), the
 *   protocol body (manifest and directive, the signed bytes), and the release bundle that the
 *   publish tool produces and the registration CLI accepts.
 * - Excludes signing keys. The private key exists only in the publish environment (CI secrets).
 *   The server receives signed bytes and their signatures, so a compromised API, DB or CDN alone
 *   cannot mint new executable code (see docs/ota/ARCHITECTURE.md).
 * - Excludes arbitrary asset URLs (fixed at publish time inside the signed manifest), update
 *   notes (sourced from packages/domain/src/update-notes/), and app_update notices (unrelated to
 *   OTA).
 */

/**
 * Deployment channel. The value matches the EAS build profile name. The profile that built a binary
 * sets its channel (`app.config.ts`), and each channel's binary has a certificate for a different
 * signing key baked in. So the channel in the request header is routing only, not authority. A
 * client claiming another channel still gets a manifest that fails verification against its own
 * certificate and is discarded. `development` is intentionally absent: dev clients load the bundle
 * from Metro and have OTA off.
 */
export const MOBILE_UPDATE_CHANNELS = [
	"preview",
	"testflight",
	"production",
] as const;
export const MobileUpdateChannel = z.enum(MOBILE_UPDATE_CHANNELS);
export type MobileUpdateChannel = z.infer<typeof MobileUpdateChannel>;

/** The platform vocabulary is shared with minimum supported version and push (`ops.ts`). */
export const MobileUpdatePlatform = AppPlatform;
export type MobileUpdatePlatform = z.infer<typeof MobileUpdatePlatform>;

/**
 * Native runtime generation: the version of the native contract, not of the JS. Several OTA
 * releases target the same generation. When native contracts that JS relies on change (native
 * modules, plugins, Info.plist, manifest, the runtime WebView harness), the generation goes up, and
 * that generation exists only in new binaries. The rule against reusing generation numbers is
 * enforced by the fingerprint record (`apps/mobile/native-runtime.lock.json`). The format is locked
 * tightly because this value is the selection key. A one-character difference makes a different
 * runtime, and that release would reach no one. The only symptom would be 'updates never arrive'.
 */
export const MOBILE_RUNTIME_VERSION_PATTERN = /^rowcat-native-[1-9][0-9]{0,5}$/;
export const MobileRuntimeVersion = z
	.string()
	.regex(MOBILE_RUNTIME_VERSION_PATTERN);
export type MobileRuntimeVersion = z.infer<typeof MobileRuntimeVersion>;

/**
 * Release status:
 * - draft: registered but sent to no one. The default for production releases.
 * - active: goes to the rollout percentage.
 * - paused: no new installs receive it. Installs that already have it keep it, and it can be
 *   resumed.
 * - rolled_back: never selected again (terminal).
 *
 * Status names do not promise more than clients can do. Reverting installs that already received an
 * update is done by a newer signed response (made by the `rollback` tool), not by the status.
 */
export const MOBILE_UPDATE_STATUSES = [
	"draft",
	"active",
	"paused",
	"rolled_back",
] as const;
export const MobileUpdateStatus = z.enum(MOBILE_UPDATE_STATUSES);
export type MobileUpdateStatus = z.infer<typeof MobileUpdateStatus>;

/**
 * Release kind: whether the response is a manifest or a directive. `rollback_to_embedded` is a
 * signed instruction to fall back to the bundle inside the store binary. It is in the vocabulary
 * because it is the only recovery path left when the first OTA on a runtime is bad and no earlier
 * OTA exists.
 */
export const MOBILE_UPDATE_KINDS = ["update", "rollback_to_embedded"] as const;
export const MobileUpdateKind = z.enum(MOBILE_UPDATE_KINDS);
export type MobileUpdateKind = z.infer<typeof MobileUpdateKind>;

/**
 * Request header by which a binary declares its channel. It does not borrow EAS's
 * `expo-channel-name`: that name would suggest this endpoint implements EAS's channel and branch
 * semantics, which it does not.
 */
export const MOBILE_UPDATE_CHANNEL_HEADER = "rowcat-update-channel";

/** The only signing algorithm that expo-updates understands. */
export const MOBILE_UPDATE_SIGNATURE_ALGORITHM = "rsa-v1_5-sha256";

/**
 * Signing key id, in the form `rowcat-<channel>-<generation>`. The channel is in the name so the
 * server can compare three values: the channel in the request header, the key id the request
 * expects, and the release's channel. The number is the axis of key rotation. A binary with a new
 * certificate requests a new id, and the server returns only releases signed with that id's key.
 */
export const MOBILE_UPDATE_KEY_ID_PATTERN =
	/^rowcat-(preview|testflight|production)-[1-9][0-9]{0,3}$/;
export const MobileUpdateKeyId = z.string().regex(MOBILE_UPDATE_KEY_ID_PATTERN);

export const mobileUpdateKeyIdChannel = (
	keyId: string,
): MobileUpdateChannel | null => {
	const matched = keyId.match(MOBILE_UPDATE_KEY_ID_PATTERN);
	return matched ? (matched[1] as MobileUpdateChannel) : null;
};

/**
 * Rollout percentage as an integer. Decimals are not accepted. The day when 0.5% is needed has not
 * come, and accepting decimals would give the same percentage two representations (10 and 10.0).
 * The 'percentage never decreases' check would then have to handle floating-point error.
 */
export const MobileUpdateRolloutPercentage = z.number().int().min(0).max(100);

/** Base64URL-encoded SHA-256, the format of the protocol `hash` field (unpadded, 43 characters). */
export const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const MobileUpdateAsset = z.object({
	hash: z.string().regex(BASE64URL_SHA256_PATTERN),
	key: z.string().min(1).max(256),
	contentType: z.string().min(1).max(128),
	fileExtension: z
		.string()
		.regex(/^\.[A-Za-z0-9]{1,16}$/)
		.optional(),
	url: z.url({ protocol: /^https?$/ }),
});
export type MobileUpdateAsset = z.infer<typeof MobileUpdateAsset>;

/**
 * Manifest: the shape of the signed bytes. `metadata`'s three values (`channel`, `platform`,
 * `apiOrigin`) are this repo's extension. All three are inside the signature. If the DB moves a row
 * to another channel, that fact disagrees with the body and registration rejects it. `channel` also
 * pairs with the manifest filter in the response header. `extra.expoClient` is included because the
 * `Constants.expoConfig` of an OTA-launched app comes from it. Without it that value is empty, and
 * the EAS project id that push registration reads disappears (`lib/push/native.ts`).
 */
export const MobileUpdateManifest = z.object({
	id: z.uuid(),
	createdAt: z.iso.datetime(),
	runtimeVersion: MobileRuntimeVersion,
	launchAsset: MobileUpdateAsset.omit({ fileExtension: true }).extend({
		fileExtension: z.string().optional(),
	}),
	assets: z.array(MobileUpdateAsset).max(2000),
	metadata: z.object({
		channel: MobileUpdateChannel,
		platform: MobileUpdatePlatform,
		apiOrigin: z.url(),
	}),
	extra: z.object({ expoClient: z.record(z.string(), z.unknown()) }).loose(),
});
export type MobileUpdateManifest = z.infer<typeof MobileUpdateManifest>;

/**
 * Directive: currently only `rollBackToEmbedded`. `commitTime` is the time of this instruction.
 * Clients follow it only when it is newer than the update they are running (expo-updates'
 * `LoaderSelectionPolicyFilterAware`). So this value is the moment the publish tool signs it.
 */
export const MobileUpdateDirective = z.object({
	type: z.literal("rollBackToEmbedded"),
	parameters: z.object({ commitTime: z.iso.datetime() }),
	extra: z
		.object({
			channel: MobileUpdateChannel,
			platform: MobileUpdatePlatform,
			runtimeVersion: MobileRuntimeVersion,
		})
		.optional(),
});
export type MobileUpdateDirective = z.infer<typeof MobileUpdateDirective>;

export const MobileUpdateSignature = z.object({
	keyId: MobileUpdateKeyId,
	alg: z.literal(MOBILE_UPDATE_SIGNATURE_ALGORITHM),
	/** Standard Base64, not URL-safe: this is exactly the value expo-updates receives as `sig`. */
	sig: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type MobileUpdateSignature = z.infer<typeof MobileUpdateSignature>;

/**
 * Storage facts for one asset: the protocol fields plus a size. The size is read by the
 * garbage-collection report (how much has accumulated). Integrity is guaranteed by the hash, not
 * the size.
 */
export const MobileUpdateStoredAsset = MobileUpdateAsset.extend({
	fileExtension: z.string().optional(),
	byteSize: z.number().int().positive(),
});
export type MobileUpdateStoredAsset = z.infer<typeof MobileUpdateStoredAsset>;

/**
 * Release bundle: a file that does not change once created. `body` is the exact signed bytes, and
 * the server emits that string without altering a character. The structured fields (`release`,
 * `assets`) are re-read from the body and compared against it. They do not stand in for it. A
 * bundle where the two disagree is not registered. `signatures` is an array because of key
 * rotation. Today it has one element. During a rotation period, the same body carries signatures
 * from two keys (see the signing trust rotation section in docs/ota/OPERATIONS.md).
 */
export const MobileUpdateReleaseBundle = z
	.object({
		formatVersion: z.literal(1),
		release: z.object({
			id: z.uuid(),
			kind: MobileUpdateKind,
			platform: MobileUpdatePlatform,
			channel: MobileUpdateChannel,
			runtimeVersion: MobileRuntimeVersion,
			createdAt: z.iso.datetime(),
			apiOrigin: z.url(),
			/**
			 * The original release, when a rollback produced this one by re-signing a previous release's
			 * assets. Null otherwise.
			 */
			republishOf: z.uuid().nullable(),
			sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
		}),
		body: z.string().min(2).max(2_000_000),
		signatures: z.array(MobileUpdateSignature).min(1).max(4),
		assets: z.array(MobileUpdateStoredAsset).max(2001),
	})
	.strict();
export type MobileUpdateReleaseBundle = z.infer<
	typeof MobileUpdateReleaseBundle
>;
