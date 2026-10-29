import { getRandomValues } from "expo-crypto";

/**
 * Installs the CSPRNG. This must be the first module loaded at app entry.
 *
 * Hermes has no `crypto.getRandomValues`, but `randomBytes` from `@noble/hashes` (used by the
 * shared sync package) calls it, and those bytes become key material: the DEK, recovery codes,
 * nonces and the pairing private key. Without it, sync either fails or runs with weak keys. This
 * wires the platform CSPRNG (`expo-crypto`, `SecRandomCopyBytes` / `SecureRandom`) into the name
 * the spec requires. It is not a shim that silences warnings. Injecting randomness into the shared
 * package instead would create a path where "what happens when nothing is injected" has no answer.
 *
 * An existing implementation is left alone, so a runtime that provides its own keeps it.
 */
const existing = globalThis.crypto as Crypto | undefined;

if (!existing?.getRandomValues) {
	/**
	 * Does not patch the existing object. If the runtime's global is frozen, `Object.assign` throws
	 * here, and that failure would only show up on first launch. Layering a prototype keeps the
	 * original delegating and adds one function.
	 */
	const shim = Object.create(existing ?? null) as Crypto;
	Object.defineProperty(shim, "getRandomValues", { value: getRandomValues });
	Object.defineProperty(globalThis, "crypto", {
		value: shim,
		configurable: true,
		writable: true,
	});
}

/** Makes the install order explicit. The import alone completes the install. */
export const SECURE_RANDOM_READY = true;
