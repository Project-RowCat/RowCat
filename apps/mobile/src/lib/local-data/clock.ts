import { bytesToBase32 } from "@rowcat/sync";

/**
 * Identity and time of local records: **one of each per app process.**
 *
 * Same place and same rule as the web's `lib/local-data/clock.ts`. The point is that chat and
 * authoring share **one** issuer. Two issuers would hand out timestamps independently within the
 * same millisecond, and sync, which commits both domains in one transaction, could no longer tell
 * which change happened first.
 *
 * There is one module-level global (`lastIssuedAt`), but it is a **clock**, not ownership. It does
 * not conflict with the rule against module globals for members, connections or stores. Switching
 * accounts keeps this process's clock single. A clock per store instance would repeat the same
 * value right after the switch.
 */

/**
 * CSPRNG. **Does not rely on `crypto.randomUUID()`.**
 *
 * Hermes does not have that function. This is why the shared package takes identity issuance by
 * injection (see the header of `@rowcat/sync`'s `clock.ts`), and this file performs the injection.
 * The only byte source is `crypto.getRandomValues`. On device, `expo-crypto` fills that slot at app
 * entry (`src/lib/secure-random.ts`), and Node tests already have it in the runtime.
 *
 * **Throws when missing.** There is no path that falls back to `Math.random()`. A value produced
 * that way raises no error anywhere and survives silently as a predictable identifier.
 */
function randomBytes(length: number): Uint8Array {
	const source = globalThis.crypto;
	if (!source?.getRandomValues)
		throw new Error(
			"crypto.getRandomValues is missing — secure-random wasn't loaded at app entry",
		);
	return source.getRandomValues(new Uint8Array(length));
}

/**
 * Identity issuance: 128 bits written in Crockford base32, 26 characters.
 *
 * The web uses `crypto.randomUUID()` (36 characters with hyphens) and the server uses 32-character
 * hex. Mixing three formats is normal. This is why the contract (`SyncRecordId`) never narrowed to
 * UUID, and these values are never compared with each other, only handled as **opaque strings**.
 * Imitating UUID to match the web's format would let two devices' ids read as the same on the day
 * that imitation drifts.
 */
export const newLocalId = (): string => bytesToBase32(randomBytes(16));

/**
 * Device identifier: **once per local database.**
 *
 * It is the tie-break axis of revisions (`Rev.d`), so it needs two properties. It must persist for
 * as long as this database lives (hence it is stored in the `sync_state` row), and it must not
 * collide with values produced elsewhere. The member id is not used, because the same person uses
 * several devices.
 */
export const newDeviceId = (): string => bytesToBase32(randomBytes(16));

let lastIssuedAt = "";

/**
 * **Monotonically increasing** storage time.
 *
 * Do not use `new Date().toISOString()` directly. Milliseconds really do collide: writing a user
 * message and immediately confirming the response, or autosave writing several children in a row,
 * gives two records the same `createdAt`. The next sort axis, `id`, then decides the order, and
 * that is random, so records saved in the same millisecond can appear reversed on screen.
 *
 * On collision, this moves one millisecond forward. The timestamp may run a few milliseconds ahead
 * of the real time, but **order is what matters**. Millisecond accuracy does not.
 */
export function nowIso(): string {
	const now = new Date().toISOString();
	if (now > lastIssuedAt) {
		lastIssuedAt = now;
		return now;
	}
	lastIssuedAt = new Date(Date.parse(lastIssuedAt) + 1).toISOString();
	return lastIssuedAt;
}
