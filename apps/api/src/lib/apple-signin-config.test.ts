import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	createAppleClientSecretSigner,
	resolveAppleSignInConfig,
} from "./apple-signin-config.ts";

/**
 * Config and secret signing, checked without booting. Breaking these rules only shows up after the
 * user finishes Apple's screen, leaving one token-exchange line in the server log, so the decision
 * was split from `env.ts`'s `process.exit` and is pinned by value here.
 */

/** Real P-256 keys: the signature format is under test, so fake keys will not do. */
const p256 = () =>
	generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});

const filled = (privateKey: string) => ({
	clientId: "com.example.web",
	teamId: "ABCDE12345",
	keyId: "KEY1234567",
	privateKey,
});

describe("resolveAppleSignInConfig", () => {
	test("all four empty means not configured", () => {
		const result = resolveAppleSignInConfig({
			clientId: "",
			teamId: "",
			keyId: "",
			privateKey: "",
		});
		expect(result).toEqual({ ok: true, config: null });
	});

	// P0: folding a half configuration into unconfigured silently kills the Apple button while the
	// operator believes it is on. Dying at boot names what is missing on the first deploy log line.
	test("any one missing is a failure, and it names what is missing", () => {
		const { privateKey } = p256();
		const result = resolveAppleSignInConfig({
			...filled(privateKey),
			keyId: "",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("APPLE_SIGN_IN_KEY_ID");
	});

	test("fails when it is not PEM", () => {
		const result = resolveAppleSignInConfig(filled("not-a-pem"));
		expect(result.ok).toBe(false);
	});

	// A non-ES256 key signs but Apple rejects it at token exchange, after login; block it here.
	test("rejects a key that is not EC", () => {
		const { privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		const result = resolveAppleSignInConfig(filled(privateKey));
		expect(result.ok).toBe(false);
	});

	// Mangled shapes, all observed in practice. Half the mangling is parser behaviour (node's
	// `--env-file` turns `\n` inside double quotes into a newline and leaves the backslash), and
	// rejecting restorable shapes makes people doubt a good key. Leniency admits no bad key:
	// `createPrivateKey` still judges the restored value (see the garbage test below).
	test.each([
		[
			"newlines as the two characters `\\n`",
			(pem: string) => pem.trim().replace(/\n/g, "\\n"),
		],
		["CRLF", (pem: string) => pem.trim().replace(/\n/g, "\r\n")],
		[
			"newlines with a backslash left over (node's --env-file)",
			(pem: string) => pem.trim().replace(/\n/g, "\\\n"),
		],
		[
			"newlines squashed into spaces",
			(pem: string) => pem.trim().replace(/\n/g, " "),
		],
		[
			"a value with its quotes not stripped",
			(pem: string) => `"${pem.trim()}"`,
		],
		[
			"only the body, without header and footer",
			(pem: string) => pem.trim().split("\n").slice(1, -1).join("\n"),
		],
		["all on one line", (pem: string) => pem.trim().split("\n").join("")],
	])("restores %s too", (_name, mangle) => {
		const { privateKey } = p256();
		expect(resolveAppleSignInConfig(filled(mangle(privateKey))).ok).toBe(true);
	});

	// The one unrestorable shape and the most common failure: an unquoted `.p8` in `.env` is read by
	// node as its first line only. It gets its own message, otherwise people doubt their key and paste
	// the same way again.
	test("a value cut at the first line says what to fix", () => {
		const result = resolveAppleSignInConfig(
			filled("-----BEGIN PRIVATE KEY-----"),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("double quotes");
	});

	/** Locks the other side: leniency must not pass arbitrary strings. */
	test("rejects junk values as is", () => {
		for (const value of [
			"hello world",
			"-----BEGIN PRIVATE KEY----- -----END PRIVATE KEY-----",
		])
			expect(resolveAppleSignInConfig(filled(value)).ok).toBe(false);
	});

	/** No failure message carries key content; boot logs are read by many people. */
	test("the failure message carries no key content", () => {
		const { privateKey } = p256();
		const body = privateKey.split("\n")[1] as string;
		const result = resolveAppleSignInConfig(
			filled(
				`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
			),
		);
		if (result.ok) return;
		expect(result.message).not.toContain(body);
	});
});

describe("createAppleClientSecretSigner", () => {
	const config = () => {
		const { privateKey } = p256();
		const resolved = resolveAppleSignInConfig(filled(privateKey));
		if (!resolved.ok || !resolved.config)
			throw new Error("the config must be valid");
		return resolved.config;
	};

	const decode = (token: string) => {
		const [header, payload] = token.split(".");
		return {
			header: JSON.parse(
				Buffer.from(header as string, "base64url").toString("utf8"),
			),
			payload: JSON.parse(
				Buffer.from(payload as string, "base64url").toString("utf8"),
			),
		};
	};

	test("carries the claims Apple requires", () => {
		const signed = createAppleClientSecretSigner(
			config(),
			() => 1_700_000_000_000,
		)();
		const { header, payload } = decode(signed);
		expect(header.alg).toBe("ES256");
		expect(header.kid).toBe("KEY1234567");
		expect(payload.iss).toBe("ABCDE12345");
		expect(payload.sub).toBe("com.example.web");
		expect(payload.aud).toBe("https://appleid.apple.com");
		expect(payload.exp).toBeGreaterThan(payload.iat);
	});

	// A JWS ECDSA signature is fixed-length R||S (64 bytes for P-256). Node's default DER looks like a
	// valid JWT and is rejected only by Apple, so the length is pinned here.
	test("the signature is in JWS form (P-1363)", () => {
		const signed = createAppleClientSecretSigner(config())();
		const signature = signed.split(".")[2] as string;
		expect(Buffer.from(signature, "base64url")).toHaveLength(64);
	});

	/** Far from expiry the same value is returned; no signing per request. */
	test("does not re-sign while it is still alive", () => {
		let now = 1_700_000_000_000;
		const sign = createAppleClientSecretSigner(config(), () => now);
		const first = sign();
		now += 60_000;
		expect(sign()).toBe(first);
	});

	// Second P0: a secret built once at boot makes Apple login fail one day in long-lived processes,
	// months after the deploy.
	test("re-signs when expiry is near", () => {
		let now = 1_700_000_000_000;
		const sign = createAppleClientSecretSigner(config(), () => now);
		const first = sign();
		now += 60 * 60 * 1000;
		expect(sign()).not.toBe(first);
	});
});
