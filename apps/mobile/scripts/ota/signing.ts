import {
	constants,
	createPrivateKey,
	type KeyObject,
	sign,
	verify,
	X509Certificate,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	MOBILE_UPDATE_SIGNATURE_ALGORITHM,
	type MobileUpdateSignature,
	MobileUpdateKeyId,
} from "@rowcat/contracts";

/**
 * Code signing. The only file in the repository that touches a private key.
 *
 * OTA is remote code execution by design, so signing is the trust model: the private key exists
 * only in the release environment (CI or the releaser's shell) and is read here alone; binaries
 * embed the public certificate (`apps/mobile/certs/<keyId>.pem`); the API, Postgres, CDN and object
 * storage hold no signing authority. Compromising any of them cannot produce new executable code.
 * What remains is replaying an already-signed body elsewhere, which per-channel keys, the runtime
 * filter and the manifest filter defend (`docs/ota/ARCHITECTURE.md`).
 *
 * The key comes from `ROWCAT_OTA_SIGNING_KEY` (PEM contents) or `ROWCAT_OTA_SIGNING_KEY_FILE`
 * (path), exactly one. The value never reaches logs, error text or artifacts.
 *
 * After signing, the signature is verified again with the committed certificate. A mismatch means
 * the key is not the one this channel's binary trusts (a production key signing preview, a key from
 * before a rotation); such a release would register but run on no device, and we want to learn that
 * here rather than on a device.
 */

export const certificatePathFor = (mobileRoot: string, keyId: string): string =>
	join(mobileRoot, "certs", `${keyId}.pem`);

export function loadSigningKey(
	env: Readonly<Record<string, string | undefined>>,
): KeyObject {
	const inline = env.ROWCAT_OTA_SIGNING_KEY?.trim();
	const file = env.ROWCAT_OTA_SIGNING_KEY_FILE?.trim();
	if (inline && file)
		throw new Error(
			"set only one of ROWCAT_OTA_SIGNING_KEY and ROWCAT_OTA_SIGNING_KEY_FILE",
		);
	if (!inline && !file)
		throw new Error(
			"no signing key — ROWCAT_OTA_SIGNING_KEY (PEM) or ROWCAT_OTA_SIGNING_KEY_FILE (path)",
		);
	let pem: string;
	try {
		pem = inline ?? readFileSync(file as string, "utf8");
	} catch {
		throw new Error("couldn't read the signing key file");
	}
	let key: KeyObject;
	try {
		key = createPrivateKey(pem);
	} catch {
		throw new Error("couldn't read the signing key (not a PEM private key)");
	}
	if (key.asymmetricKeyType !== "rsa")
		throw new Error("the signing key isn't RSA — expo-updates verifies only RSA");
	return key;
}

export function signBody(body: string, key: KeyObject): string {
	return sign("sha256", Buffer.from(body, "utf8"), {
		key,
		padding: constants.RSA_PKCS1_PADDING,
	}).toString("base64");
}

export function verifyWithCertificate(
	body: string,
	signature: string,
	certificatePem: string,
): boolean {
	try {
		return verify(
			"sha256",
			Buffer.from(body, "utf8"),
			{
				key: new X509Certificate(certificatePem).publicKey,
				padding: constants.RSA_PKCS1_PADDING,
			},
			Buffer.from(signature, "base64"),
		);
	} catch {
		return false;
	}
}

/** Signs, then verifies at once against the committed certificate; throws on mismatch. */
export function signForKeyId(input: {
	body: string;
	key: KeyObject;
	keyId: string;
	certificatePem: string;
}): MobileUpdateSignature {
	MobileUpdateKeyId.parse(input.keyId);
	const sig = signBody(input.body, input.key);
	if (!verifyWithCertificate(input.body, sig, input.certificatePem))
		throw new Error(
			`this signing key doesn't pair with ${input.keyId}'s certificate — that channel's binaries would refuse this signature`,
		);
	return { keyId: input.keyId, alg: MOBILE_UPDATE_SIGNATURE_ALGORITHM, sig };
}
