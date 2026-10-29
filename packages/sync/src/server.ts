/**
 * The only surface the server may import from this package. `apps/api` has no reason to know this
 * package. The server does not decrypt, merge, or know the domain. Two functions are still needed:
 * - verifyKeyringProof: constant-time check that a keyring replacement proves possession of the
 *   current DEK.
 * - isValidEnvelopeSyntax: checks envelope syntax without decrypting. Re-implementing these on
 *   the server would be worse. A hand-written HMAC comparison eventually becomes `===`, which loses
 *   constant time. If envelope validation diverged, the format clients produce and the format the
 *   server accepts would differ. Keeping this file small makes the allowed scope readable in one
 *   line. Any other path from server code into this package crosses the boundary. decryptRecord,
 *   unlockWithRecovery and createSyncEngine must never appear on the server. Nothing here decrypts:
 *   proof verification is a MAC comparison, and envelope validation is shallow parsing.
 */

export { b64ToBytes } from "./codec.ts";
export { isValidEnvelopeSyntax } from "./crypto.ts";
export { verifyKeyringProof } from "./keyring.ts";
