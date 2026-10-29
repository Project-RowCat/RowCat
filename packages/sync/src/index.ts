/**
 * Pure protocol core of @rowcat/sync: the parts that must give identical results on every device.
 *
 * Deliberately excluded:
 * - React, Dexie, IndexedDB, SQLite, DOM, fetch and Node APIs. Two platforms must produce the
 *   same bytes, so platform code would break that equivalence. Storage, transport and device keys
 *   are ports that the app supplies.
 * - @rowcat/chat and @rowcat/authoring. Sync must not become a hub that knows every domain, or
 *   each new domain field would force a protocol change. Codecs belong to their domains and satisfy
 *   `SyncCodec` structurally; the app assembles them.
 * - @rowcat/sdk. Knowing the transport implementation would tie the protocol to HTTP. Only
 *   `SyncTransport` is known.
 * - Date.now() and crypto.randomUUID(). Time and identity are injected. Randomness is the
 *   exception: the CSPRNG for key material is part of the spec.
 * - window, document and navigator. Auto-sync scheduling lives here, but its triggers
 *   (visibility, focus, online) belong to each platform.
 * - SSE, assets, tombstone GC and DEK rotation are later slices. Pairing is already here
 *   (pairing.ts).
 *
 * The package exists because this code is agreement between devices. If web and mobile implemented
 * it separately, the same two records could resolve to different winners, or fail to open each
 * other's ciphertext, and user writing would be lost. It was not left in web to be moved later,
 * because by then two implementations would already exist.
 *
 * Dependencies: only @rowcat/contracts, @noble/* and fflate. apps/api also imports
 * verifyKeyringProof and isValidEnvelopeSyntax. The server verifies but never decrypts.
 */
export * from "./aead.ts";
export * from "./auto-sync.ts";
export * from "./clock.ts";
export * from "./codec.ts";
export * from "./controller.ts";
export * from "./crypto.ts";
export * from "./device-key.ts";
export * from "./engine.ts";
export * from "./keyring.ts";
export * from "./merge.ts";
export * from "./pairing.ts";
export * from "./pairing-runner.ts";
export * from "./recovery.ts";
export * from "./registry.ts";
export * from "./store.ts";
export * from "./transport.ts";
