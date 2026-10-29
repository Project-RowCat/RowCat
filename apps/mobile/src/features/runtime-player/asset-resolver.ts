import type { ResolvedRuntimeAssetTarget } from "@rowcat/runtime/asset";
import type { ImageSourcePropType } from "react-native";
import type { AuthImageCredentials } from "../../lib/auth-image.ts";

/**
 * Native runtime asset resolution, the pure half: turns a reference into a source `Image` may open.
 *
 * ```text
 * managed  media-A                         →  { uri: {API}/v2/media/media-A, headers }
 * remote   https://cdn.example.com/a.webp  →  { uri: {API}/v2/runtime/assets/remote?url=…, headers }
 * ```
 *
 * ## Logical paths never arrive here
 *
 * The argument is `ResolvedRuntimeAssetTarget`, not `RuntimeAssetTarget`, which is the key fact of
 * this file. Turning a logical name into a media identity is done by the session's binding table
 * (`bindRuntimeAssetResolver`). A string that skipped that table would be turned into an address
 * here, but a logical name is not an address; the type prevents that mistake.
 *
 * Same place and rules as the web's `lib/runtime-assets/web-asset-resolver.ts`. The address comes
 * from one SDK function (`media.runtimeAssetUrl`), so the two apps never write a second path; here
 * it is passed in as an argument so the tests can check the rules without React or the SDK.
 *
 * ## Why this file lives in `features/`
 *
 * `lib/runtime-native/` does not know the API client (enforced by that folder's boundary check).
 * That layer runs the artifact, while building addresses belongs to the playback surface. On the
 * web the same rules live in `lib/` because two consumers (preview and playback) sit in different
 * folders; this app has one consumer.
 *
 * ## The session header travels with it
 *
 * The remote proxy can be called only with a session (it is not an open proxy), and native
 * `Image`'s loader does not go through the SDK transport, so it cannot attach cookies itself. This
 * is the same defect the cover hit (see the `auth-image.ts` header). **Returns `null` until the
 * headers are settled:** if `Image` remembers a 401 from a request sent earlier, the picture never
 * returns even after the cookie arrives. The header is attached only to the one destination this
 * function builds (our API address), so no separate judgment is needed. A creator's address never
 * becomes `uri` on any branch.
 */
export function resolveNativeRuntimeAsset(
	target: ResolvedRuntimeAssetTarget,
	credentials: AuthImageCredentials,
	urls: {
		/** Media identity → our origin's address (`client.media.url`). */
		mediaUrl: (mediaId: string) => string;
		/** Creator's HTTPS address → RowCat proxy address (`client.media.runtimeAssetUrl`). */
		runtimeAssetUrl: (remoteUrl: string) => string;
	},
): ImageSourcePropType | null {
	if (!credentials.ready) return null;
	/**
	 * Both branches receive the same credentials, but they need the header to different degrees.
	 *
	 * ```text
	 * remote   /v2/runtime/assets/remote   401 without a session (not an open proxy)
	 * managed  /v2/media/:id               no viewing gate; whoever knows the address opens it
	 * ```
	 *
	 * The managed image gets the header not because it is required but because the destination is our
	 * origin. A gated resource such as a cover that passes through here later must find that fact
	 * already true. Put the other way: this line is not the managed asset's authorization, which is
	 * carried by the 122-bit random address and the `status = 'ready'` predicate (`routes/media.ts`).
	 */
	const uri =
		target.kind === "managed"
			? urls.mediaUrl(target.mediaId)
			: urls.runtimeAssetUrl(target.url);
	if (uri.length === 0) return null;
	return credentials.headers ? { uri, headers: credentials.headers } : { uri };
}

/**
 * A resolved reference → one address the player opens.
 *
 * Kept apart from the image resolver because the answer has a different shape: `Image` takes a
 * source object, the player takes an address string. Only that differs; authorization and binding
 * pass through the same gate (the caller builds both resolvers from the same table).
 *
 * ## Remote references never arrive here
 *
 * The type has that branch, but this function returns `null` for it. Remote sound is already
 * blocked upstream (`bindRuntimeAssetResolver` never resolves a remote reference to sound).
 * Blocking again here keeps this file from quietly producing a proxy address if that layer changes.
 * Sound is not supported by the language contract: an image is fetched once, while sound is a
 * conversation of range requests for as long as it plays, and opening that surface to the creator's
 * host is not this slice's decision.
 *
 * ## No session header
 *
 * The destination is `/v2/media/:id` alone, which has no viewing gate (authorization is the 122-bit
 * random address and the `status = 'ready'` predicate). The picture waits for headers because a
 * failed remote proxy request is remembered by `Image`; there is no such branch here, so waiting
 * would only delay the background music.
 *
 * ## The URL rule is passed in as an argument
 *
 * Same reason as above: this file takes neither the SDK nor React, so the rule can be checked by
 * value (this folder's tests run without a simulator).
 */
export function resolveNativeRuntimeAudioUrl(
	target: ResolvedRuntimeAssetTarget,
	mediaUrl: (mediaId: string) => string,
): string | null {
	if (target.kind !== "managed") return null;
	const uri = mediaUrl(target.mediaId);
	return uri.length === 0 ? null : uri;
}
