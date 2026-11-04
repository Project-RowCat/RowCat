import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Whose local data this is: **(instance, member)**, never a member id alone
 * (`docs/mobile/INSTANCES.md` §격리).
 *
 * Every per-member name on this device — the SQLite file, the draft-cover folder, the remembered sync
 * key, the provider keys — used to come from the member id by itself. That is right while the app talks
 * to one server, because that server issues the ids. Once it may talk to several, an id is only unique
 * per server, and a malicious server can **claim another server's member id** to open that member's
 * files. The origin is what a server cannot claim — TLS proves it — so it joins the key.
 *
 * ```text
 * home instance    sha256(memberId)                                 today's names, byte for byte
 * other instance   sha256("rowcat.local-scope.v1\0" ‖ len ‖ origin ‖ memberId)
 * ```
 *
 * **The home instance keeps today's derivation.** Installed apps hold conversations and drafts under
 * those names; changing them is a data migration, not a string change, and a device whose migration
 * failed would open an empty app (the same judgement as the web's IndexedDB name). So there are two
 * derivations and one function that picks.
 *
 * The other derivation is domain-separated (the tag cannot be a member id's prefix by accident and is
 * versioned) and **length-prefixes the origin**: concatenating two strings bare lets two different pairs
 * produce the same input.
 *
 * Nothing here reads which instance is active. Today every caller states `homeScope(viewerId)` at the
 * place a member id enters, and `local-scope.test.ts` lists those places — the slice that adds instance
 * selection replaces exactly them.
 */

/** The server this binary was built for (`EXPO_PUBLIC_API_ORIGIN`), or another one by its origin. */
export type LocalInstance =
	| { readonly kind: "home" }
	| { readonly kind: "other"; readonly origin: string };

export const HOME_INSTANCE: LocalInstance = Object.freeze({ kind: "home" });

export interface LocalScope {
	readonly instance: LocalInstance;
	readonly memberId: string;
}

export const homeScope = (memberId: string): LocalScope => ({
	instance: HOME_INSTANCE,
	memberId,
});

const OTHER_INSTANCE_TAG = "rowcat.local-scope.v1\0";

/** The hex digest every per-member local name is built from. Deterministic: the same scope opens the same files. */
export function localScopeKey(scope: LocalScope): string {
	if (scope.instance.kind === "home")
		return bytesToHex(sha256(utf8ToBytes(scope.memberId)));
	const { origin } = scope.instance;
	return bytesToHex(
		sha256(
			utf8ToBytes(
				`${OTHER_INSTANCE_TAG}${origin.length}:${origin}${scope.memberId}`,
			),
		),
	);
}

/**
 * A scope by its key alone — what the device records for another instance's members
 * (`instances/instance-registry.ts`), so removing that instance can delete their files without the
 * member ids. The key is the hash every name is built from; it says nothing about who the member is.
 */
export interface RecordedScope {
	readonly scopeKey: string;
}

export type ScopeRef = LocalScope | RecordedScope;

export const scopeKeyOf = (ref: ScopeRef): string =>
	"scopeKey" in ref ? ref.scopeKey : localScopeKey(ref);
