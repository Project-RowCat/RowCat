/**
 * The shape of the first-run setup code. The API derives and checks it; the operations console
 * folds what a person typed into the same form before sending it.
 *
 * Written once here because both sides must agree on what counts as the same code: if the console
 * accepted `7kqm 3xwd p9rt` while the server compared case-sensitively, an operator copying the
 * code from a log viewer that lowercases nothing but a terminal font that blurs `O`/`0` would be
 * refused with a correct code, and that failure looks exactly like a wrong one.
 *
 * Crockford base32 because the code is read off a log by a person and typed by hand: no `I`, `L`,
 * `O` or `U`, and the letters people confuse with digits fold to those digits.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters in a code. 12 × 5 bits = 60 bits, far beyond what the claim's rate limit lets anyone guess. */
export const SETUP_CODE_LENGTH = 12;

/** Bytes a derivation must supply: 60 bits round up to 8 bytes. */
export const SETUP_CODE_SOURCE_BYTES = 8;

/**
 * The first 60 bits of `bytes` as a code. Pure so the server's derivation and the tests agree on
 * the encoding without either one owning it.
 */
export function setupCodeFromBytes(bytes: Uint8Array): string {
	if (bytes.length < SETUP_CODE_SOURCE_BYTES)
		throw new Error(`setup code needs ${SETUP_CODE_SOURCE_BYTES} bytes`);
	let code = "";
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5 && code.length < SETUP_CODE_LENGTH) {
			bits -= 5;
			code += ALPHABET[(buffer >> bits) & 31];
		}
		buffer &= (1 << bits) - 1;
		if (code.length === SETUP_CODE_LENGTH) break;
	}
	return code;
}

/** `7KQM-3XWD-P9RT`: how the log prints it and how the console shows it back. */
export const formatSetupCode = (code: string): string =>
	code.match(/.{1,4}/g)?.join("-") ?? code;

/**
 * Folds typed input to the canonical code, or `null` when it cannot be one.
 *
 * Removes whitespace and hyphens, upper-cases, and maps the confusable letters (`I`/`L` → `1`,
 * `O` → `0`). Anything else outside the alphabet is rejected rather than dropped: silently removing
 * a stray character could shorten a mistyped code to the right length and send it on.
 */
export function normalizeSetupCode(raw: string): string | null {
	const folded = raw
		.replace(/[\s-]/g, "")
		.toUpperCase()
		.replace(/[IL]/g, "1")
		.replace(/O/g, "0");
	if (folded.length !== SETUP_CODE_LENGTH) return null;
	for (const char of folded) if (!ALPHABET.includes(char)) return null;
	return folded;
}
