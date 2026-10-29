import { constants, verify, X509Certificate } from "node:crypto";

/**
 * Signature verification only; nothing here can sign.
 *
 * The server holds only public certificates and can only ask whether bytes were signed by that key.
 * Signing is done with the private key by the release tool (`apps/mobile/scripts/ota/signing.ts`);
 * a static check (`services/mobile-updates/boundaries.test.ts`) keeps the API runtime from
 * importing it.
 *
 * The algorithm is the single one expo-updates knows: RSA PKCS#1 v1.5 + SHA-256 with a standard
 * Base64 signature, the same computation as the client's
 * `CodeSigningConfiguration.verifyRSASHA256SignedData`.
 */

export interface CertificateCheck {
	ok: boolean;
	problem?: string;
}

/**
 * Whether a certificate is usable as a code-signing trust root: only key type and validity period
 * are checked. No chain validation, because the binary embeds this one self-signed certificate and
 * registration compares against that same committed file.
 */
export function checkCertificate(pem: string, now: Date): CertificateCheck {
	let certificate: X509Certificate;
	try {
		certificate = new X509Certificate(pem);
	} catch {
		return { ok: false, problem: "couldn't read the certificate" };
	}
	if (certificate.publicKey.asymmetricKeyType !== "rsa")
		return { ok: false, problem: "not a certificate for an RSA key" };
	if (new Date(certificate.validTo).getTime() <= now.getTime())
		return {
			ok: false,
			problem: `the certificate has expired (${certificate.validTo})`,
		};
	if (new Date(certificate.validFrom).getTime() > now.getTime())
		return { ok: false, problem: "the certificate isn't valid yet" };
	return { ok: true };
}

export function verifyBodySignature(
	body: string,
	signatureBase64: string,
	certificatePem: string,
): boolean {
	try {
		const certificate = new X509Certificate(certificatePem);
		return verify(
			"sha256",
			Buffer.from(body, "utf8"),
			{ key: certificate.publicKey, padding: constants.RSA_PKCS1_PADDING },
			Buffer.from(signatureBase64, "base64"),
		);
	} catch {
		return false;
	}
}
