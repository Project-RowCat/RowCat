import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { LocalInstance } from "../local-scope.ts";

/**
 * The SecureStore prefix each instance's session lives under — **one session per instance**
 * (`docs/mobile/INSTANCES.md` §격리).
 *
 * ```text
 * home    rowcat.auth                  unchanged: an installed app stays signed in
 * other   rowcat.auth.<sha256(origin)> never shared with home or with another instance
 * ```
 *
 * The home value is what Better Auth's Expo client has always written under, so changing it would sign
 * every installed app out. Another instance's prefix is hashed for the same reason the local names are: a
 * Keychain entry name ends up in backups and diagnostics, and a server address is not something those need
 * to carry. Distinct prefixes are the whole of the isolation — one client per instance reads only its own.
 */
export const HOME_AUTH_STORAGE_PREFIX = "rowcat.auth";

export function authStoragePrefixFor(instance: LocalInstance): string {
	if (instance.kind === "home") return HOME_AUTH_STORAGE_PREFIX;
	return `${HOME_AUTH_STORAGE_PREFIX}.${bytesToHex(sha256(utf8ToBytes(instance.origin)))}`;
}

/**
 * The SecureStore entries one instance's session occupies, for forgetting it when the instance is removed.
 * Better Auth's Expo client writes two (`<prefix>_cookie`, `<prefix>_session_data`), and a value over its
 * per-entry limit is split into `<key>.0 … <key>.<n-1>` behind a `ba-chunks:<n>` marker — so deleting the
 * two names alone would leave the cookie's pieces behind. `chunkCountOf` reads that marker.
 */
export const authSessionEntryNames = (prefix: string): readonly string[] => [
	`${prefix}_cookie`,
	`${prefix}_session_data`,
];

const CHUNK_MARKER = "ba-chunks:";

export function chunkCountOf(stored: string | null): number {
	if (!stored?.startsWith(CHUNK_MARKER)) return 0;
	const count = Number(stored.slice(CHUNK_MARKER.length));
	return Number.isInteger(count) && count > 0 && count < 1000 ? count : 0;
}
