import type { ByoProvider } from "@rowcat/chat";
import type { StoredProviderConnection } from "./record.ts";

/**
 * Protection of provider credentials at rest, so no plaintext API key sits on disk. The method
 * matches the wrapped DEK (local-sync/device-key.ts). The shape is aligned so the decision is not
 * made again here: wrapKey = generateKey(AES-GCM, extractable: false) stored = { wrapKey (the
 * CryptoKey object as is), iv, ct = AES-GCM(wrapKey, UTF-8(key), AAD) } IndexedDB can store a
 * CryptoKey by structured clone, and a non-extractable key comes back without its bytes ever being
 * readable. So there is no plaintext API key on disk. An IndexedDB dump from an extension, offline
 * disk analysis, and copying the browser profile all fail to yield the raw key.
 */

/**
 * The domain prefix of the AAD. The version is baked into the string on purpose. When the sealing
 * format changes and this value is bumped, old ciphertext will not open under the new code. That is
 * better than a half-understood decryption succeeding.
 */
const AAD_DOMAIN = "rowcat.provider-credential.v1";

/**
 * AES-GCM nonce length in bytes, the spec-recommended size. A new nonce is drawn for every seal.
 */
const IV_BYTES = 12;

/**
 * The binding for this ciphertext: member, provider and connection record. All three are needed.
 * Without the member, Alice's ciphertext could be copied into Bob's row. Without the provider, an
 * Anthropic key could be relabeled as a Gemini connection, which would send the Anthropic key to
 * Gemini. Without the connection id, an old ciphertext from before a key replacement could be
 * restored into the new row. If any AAD value differs, GCM authentication fails, and that failure
 * surfaces as an exception. The separator is |, and no component contains it: member ids are hex,
 * providers are a fixed vocabulary, and connection ids are UUIDs. If components are added and that
 * guarantee breaks, switch to a length-prefixed encoding.
 */
const credentialAad = (input: {
	viewerId: string;
	provider: ByoProvider;
	connectionId: string;
}): Uint8Array =>
	new TextEncoder().encode(
		`${AAD_DOMAIN}|${input.viewerId}|${input.provider}|${input.connectionId}`,
	);

export interface SealedCredential {
	wrapKey: CryptoKey;
	iv: Uint8Array;
	ct: Uint8Array;
}

/**
 * Seals a credential. A new wrapping key is created every time, and it is not reused, because of
 * the replacement path. If one key were reused, 'disconnect then reconnect' and 'key replacement'
 * would run on the same key. Old ciphertext left in a backup or an earlier snapshot would then open
 * in the new state. With a fresh key each time, the key that opens an old ciphertext disappears
 * together with its row.
 */
export async function sealCredential(input: {
	viewerId: string;
	provider: ByoProvider;
	connectionId: string;
	secret: string;
}): Promise<SealedCredential> {
	const wrapKey = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		// extractable: false, so no code can read this key's bytes.
		false,
		["encrypt", "decrypt"],
	);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: iv as unknown as BufferSource,
				additionalData: credentialAad(input) as unknown as BufferSource,
			},
			wrapKey,
			new TextEncoder().encode(input.secret) as unknown as BufferSource,
		),
	);
	return { wrapKey, iv, ct };
}

/**
 * Opens a seal. Failure returns null and never throws. This is called right before generation. An
 * exception there would make the user see 'the conversation broke', not 'the provider connection is
 * broken'. On null, the caller treats it as having no connection, and the normal reconnect prompt
 * opens. It deliberately does not report the kind of failure. A mismatched AAD, a tampered
 * ciphertext and a corrupted wrapper are all the same GCM authentication failure. Telling the user
 * the difference would not change what they can do, which is reconnect.
 */
export async function openCredential(
	row: StoredProviderConnection,
	viewerId: string,
): Promise<string | null> {
	try {
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: row.iv as unknown as BufferSource,
				additionalData: credentialAad({
					viewerId,
					provider: row.provider,
					connectionId: row.connectionId,
				}) as unknown as BufferSource,
			},
			row.wrapKey,
			row.ct as unknown as BufferSource,
		);
		return new TextDecoder().decode(plaintext);
	} catch {
		return null;
	}
}
