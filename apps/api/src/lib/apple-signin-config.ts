import {
	createPrivateKey,
	type KeyObject,
	randomUUID,
	sign as signWithKey,
} from "node:crypto";

/**
 * Sign in with Apple config resolution and client-secret signing.
 *
 * Apple differs from the other social providers in one way: there is no secret to paste. The token
 * endpoint's `client_secret` is a short-lived ES256 JWT we sign with the `.p8` private key.
 *
 * - The signed JWT is not accepted as an env var. That is easier and common, but the value
 *   expires silently: boot and health checks pass, every other login method works, and only people
 *   pressing the Apple button fail at token exchange, months after the deploy. Deriving the secret
 *   from the key at request time removes that state, and a wrong config dies at boot (`env.ts`).
 * - The lifetime is short. Apple allows up to six months but signing is synchronous and free, so
 *   only the blast radius of a leak matters. Callers see one string.
 * - The private key lives only as a `KeyObject`, never as a PEM string, and nothing is logged
 *   (`no-secret-logging.test.ts` scans this file). Error messages never carry key content, since
 *   boot logs are read by many people.
 */

export interface AppleSignInConfig {
	/** Services ID; Apple uses it as both `client_id` and the secret's `sub`. */
	clientId: string;
	teamId: string;
	keyId: string;
	/** Parsed key object, not PEM. */
	privateKey: KeyObject;
}

export type AppleSignInConfigResult =
	/** `config: null` means unconfigured (all four values empty). */
	| { ok: true; config: AppleSignInConfig | null }
	| { ok: false; message: string };

/** Secret audience, fixed by Apple. */
const APPLE_AUDIENCE = "https://appleid.apple.com";

/** Our own choice, not Apple's six-month cap. */
const SECRET_TTL_SECONDS = 30 * 60;

/** Re-sign early so a secret cannot expire mid-request. */
const SECRET_REFRESH_MARGIN_SECONDS = 5 * 60;

const base64url = (input: Buffer | string): string =>
	Buffer.from(input).toString("base64url");

/**
 * Restores a PEM from an env var, or names why it cannot.
 *
 * A multi-line `.p8` in a one-line env var gets mangled by hands and parsers. The shapes seen in
 * practice are this function's spec:
 *
 * ```text
 * multi-line in double quotes in .env      arrives intact                  passes
 * one line with `\n` as two characters     escape remains                  restored
 * CRLF                                     two-character newline           restored
 * multi-line WITHOUT quotes in .env        node reads only the first line  cannot restore -> truncated
 * double quotes + `\n` as two characters   node leaves the backslash       restored
 * newlines collapsed to spaces (secrets)   line structure lost             restored
 * body only, no header/footer              not a PEM                       restored
 * ```
 *
 * It repairs instead of rejecting because this is the only secret copied by hand and the mangling
 * comes from parser behaviour (rows four and five are node's `--env-file`), not user error. Every
 * shape is deterministically restorable and `createPrivateKey` still judges the result, so leniency
 * never admits a bad key.
 *
 * Row four is different: most of the value never arrived, so the failure is named (`truncated`) to
 * tell the caller what to fix. Folding everything into "not readable as PEM" makes people doubt a
 * good key and repeat the same mistake.
 */
type PemRepair =
	| { ok: true; pem: string }
	/** Only `truncated` needs the user to re-enter the value; the rest are shape problems. */
	| { ok: false; problem: "truncated" | "no-header" | "no-body" };

/** Characters a PEM body may contain once whitespace is removed. */
const BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;

/** Strips one layer of wrapping quotes; unstripped values do arrive. */
function unquote(value: string): string {
	const quoted =
		value.length >= 2 &&
		(value.startsWith('"') || value.startsWith("'")) &&
		value.endsWith(value[0] as string);
	return quoted ? value.slice(1, -1) : value;
}

function repairPemKey(raw: string): PemRepair {
	const text = unquote(raw.trim())
		// CRLF/CR from a `.env` edited on Windows.
		.replace(/\r\n?/g, "\n")
		// A one-line value's `\n` as two characters.
		.replaceAll("\\n", "\n")
		// Node turns `\n` inside double quotes into a newline but leaves the backslash. That combination
		// cannot occur in a PEM (the body is base64), so it is safe to drop.
		.replace(/\\\n/g, "\n")
		.trim();

	const header = /-----BEGIN ([A-Z0-9 ]+?)-----/.exec(text);
	if (!header) {
		// Header missing: only the body was pasted. Wrap only when it is pure base64, otherwise any
		// string would be packaged as a PEM and the failure becomes "our value is wrong".
		const body = text.replace(/\s+/g, "");
		if (body.length >= 64 && BASE64_ONLY.test(body))
			return { ok: true, pem: wrapPem("PRIVATE KEY", body) };
		return { ok: false, problem: "no-header" };
	}

	const label = header[1] as string;
	const footer = text.indexOf(`-----END ${label}-----`);
	// Header present but footer missing: a multi-line value cut at its first line.
	if (footer < 0) return { ok: false, problem: "truncated" };

	const body = text
		.slice(header.index + header[0].length, footer)
		.replace(/\s+/g, "");
	if (body.length === 0 || !BASE64_ONLY.test(body))
		return { ok: false, problem: "no-body" };

	return { ok: true, pem: wrapPem(label, body) };
}

/** Re-assembles a canonical PEM with the body folded at 64 characters. Original line breaks are deliberately not preserved: collapsed values have none, and OpenSSL ignores the width. */
const wrapPem = (label: string, body: string): string =>
	`-----BEGIN ${label}-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${label}-----\n`;

/** Three separate messages because each calls for a different fix; one message would make a truncated value and a body-only paste both doubt their key. */
function pemProblemMessage(
	problem: "truncated" | "no-header" | "no-body",
): string {
	switch (problem) {
		// By far the most common failure here: pasting the `.p8` as-is into `.env` makes node's
		// `--env-file` read only the first line. Without saying so, people paste the same way again.
		case "truncated":
			return 'APPLE_SIGN_IN_PRIVATE_KEY was cut at the `-----BEGIN …-----` line — a multi-line value must be wrapped in double quotes in `.env` (APPLE_SIGN_IN_PRIVATE_KEY="-----BEGIN …"). To write it on one line, replace the newlines with the two characters `\\n`';
		case "no-header":
			return "couldn't find `-----BEGIN PRIVATE KEY-----` in APPLE_SIGN_IN_PRIVATE_KEY — put in the contents of the `.p8` file from the Apple developer site as is, header and footer included";
		case "no-body":
			return "APPLE_SIGN_IN_PRIVATE_KEY is empty or not base64 between its header and footer — check that the `.p8` file's contents are intact";
	}
}

/**
 * A half configuration is an error, not unconfigured: the user would get halfway through Apple's
 * flow and fail at token exchange, and the screen would only say login did not complete (the
 * identity-verification provider and Toss key pair made the same call).
 *
 * The key is parsed here too, since a malformed key otherwise surfaces on the first login attempt
 * as one OpenSSL line in the server log.
 *
 * Pure because `env.ts` can call `process.exit` on import, which makes its decisions untestable
 * (`webauthn-config.ts` is split for the same reason).
 */
export function resolveAppleSignInConfig(input: {
	clientId: string;
	teamId: string;
	keyId: string;
	/** Contents of the `.p8` file; mangled shapes are repaired by `repairPemKey`. */
	privateKey: string;
}): AppleSignInConfigResult {
	const clientId = input.clientId.trim();
	const teamId = input.teamId.trim();
	const keyId = input.keyId.trim();
	const rawPrivateKey = input.privateKey.trim();

	const present = [
		["APPLE_SIGN_IN_CLIENT_ID", clientId],
		["APPLE_SIGN_IN_TEAM_ID", teamId],
		["APPLE_SIGN_IN_KEY_ID", keyId],
		["APPLE_SIGN_IN_PRIVATE_KEY", rawPrivateKey],
	] as const;

	const missing = present.filter(([, value]) => !value).map(([name]) => name);
	if (missing.length === present.length) return { ok: true, config: null };
	if (missing.length > 0)
		return {
			ok: false,
			message: `half an Apple sign-in config — empty values: ${missing.join(", ")}. Fill all four or leave all four empty`,
		};

	const repaired = repairPemKey(rawPrivateKey);
	if (!repaired.ok)
		return { ok: false, message: pemProblemMessage(repaired.problem) };

	let privateKey: KeyObject;
	try {
		privateKey = createPrivateKey({ key: repaired.pem, format: "pem" });
	} catch {
		// Reaching here means PEM-shaped content that is not a key; mangling was already repaired and
		// unrestorable shapes have their own message, so this branch is rare (usually the wrong file or a
		// cut value). The exception is not echoed: node's OpenSSL errors rarely contain key material, but
		// that guarantee is the runtime's, and boot logs are read by many people.
		return {
			ok: false,
			message:
				"APPLE_SIGN_IN_PRIVATE_KEY looks like PEM but doesn't read as a key — check that it is the `.p8` file from the Apple developer site and that its contents aren't truncated",
		};
	}

	// A non-ES256 key signs fine but Apple rejects it at token exchange, after the user has finished
	// Apple's flow; block it here.
	if (privateKey.asymmetricKeyType !== "ec")
		return {
			ok: false,
			message: `APPLE_SIGN_IN_PRIVATE_KEY is not an EC key (${privateKey.asymmetricKeyType ?? "unknown"}) — Sign in with Apple keys are P-256 EC`,
		};

	const curve = privateKey.asymmetricKeyDetails?.namedCurve;
	if (curve && curve !== "prime256v1")
		return {
			ok: false,
			message: `APPLE_SIGN_IN_PRIVATE_KEY's curve is not P-256 (${curve}) — Apple accepts only ES256`,
		};

	return { ok: true, config: { clientId, teamId, keyId, privateKey } };
}

/**
 * Returns a function yielding a currently valid `client_secret`. Being a function is the whole API:
 * a string built at boot freezes for the process lifetime, while a six-month lifetime brings back
 * the silent expiry this file avoids. Signing is synchronous (`crypto.sign`), so the caller can use
 * it as an accessor and still satisfy Better Auth's `string`-shaped option; async would need a
 * timer to warm a cache.
 */
export function createAppleClientSecretSigner(
	config: AppleSignInConfig,
	/** Tests pin the clock. */
	now: () => number = Date.now,
): () => string {
	let cached: { token: string; expiresAt: number } | null = null;

	return () => {
		const seconds = Math.floor(now() / 1000);
		if (cached && cached.expiresAt - seconds > SECRET_REFRESH_MARGIN_SECONDS)
			return cached.token;

		const expiresAt = seconds + SECRET_TTL_SECONDS;
		const header = base64url(
			JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }),
		);
		const payload = base64url(
			JSON.stringify({
				iss: config.teamId,
				iat: seconds,
				exp: expiresAt,
				aud: APPLE_AUDIENCE,
				sub: config.clientId,
				// Not for replay detection; it keeps two secrets minted in the same second from being the same
				// string. ECDSA is already probabilistic, but that is the algorithm's property, not a contract
				// to lean on.
				jti: randomUUID(),
			}),
		);

		const signingInput = `${header}.${payload}`;
		// `ieee-p1363` is the encoding JWS requires. Without it node signs in DER, which looks like a
		// valid JWT and is rejected only by Apple, so no local check catches it.
		const signature = signWithKey("sha256", Buffer.from(signingInput), {
			key: config.privateKey,
			dsaEncoding: "ieee-p1363",
		});

		const token = `${signingInput}.${base64url(signature)}`;
		cached = { token, expiresAt };
		return token;
	};
}
