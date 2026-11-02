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
