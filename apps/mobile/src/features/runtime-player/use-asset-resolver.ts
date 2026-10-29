import {
	authorizeRuntimeAssetResolver,
	bindRuntimeAssetResolver,
	EMPTY_MANAGED_ASSET_BINDINGS,
	EMPTY_REMOTE_ASSET_ALLOWLIST,
	type RuntimeManagedAssetBindings,
	type RuntimeRemoteAssetAllowlist,
	runtimeManagedAssetBindings,
} from "@rowcat/runtime/asset";
import type {
	NativeRuntimeAssetResolver,
	NativeRuntimeAudioResolver,
} from "@rowcat/runtime-renderer-native";
import { useMemo } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { useAuthImageHeaders } from "../../lib/auth-image.ts";
import {
	resolveNativeRuntimeAsset,
	resolveNativeRuntimeAudioUrl,
} from "./asset-resolver.ts";

/**
 * The resolver the playback screen hands to the renderer. It joins the rules (`asset-resolver.ts`)
 * with **authorization**, the session header and the SDK.
 *
 * ```text
 * this session's authorization list ─▶ authorizeRuntimeAssetResolver ─▶ resolveNativeRuntimeAsset
 * ─▶ { uri, headers }
 *   └ a remote address outside the list ends here: no `uri` is built
 * ```
 *
 * The list comes from the session (the bridge's `started`). This hook does not re-read the
 * artifact, because the authority for that validation is the host inside the WebView. The list is
 * an argument because it differs per session: if it were frozen as a value, the previous work's
 * addresses would open in the next one.
 *
 * The headers are re-read when identity changes (`useAuthImageHeaders`), so the resolver is also
 * rebuilt then. The renderer re-requests images with the new headers from the next image on,
 * whenever the function's identity changes.
 */
/**
 * The two resolvers this screen gives the renderer and the deck, respectively.
 *
 * They are not merged because the shape of the answer differs: an image is the source of an
 * `Image`, while a sound is an address the player opens. Building both from **the same
 * authorization and the same table** is the reason this hook exists. Built separately, whichever
 * one forgot a gate would become a second path.
 */
export interface NativeRuntimeAssetResolvers {
	resolveAsset: NativeRuntimeAssetResolver;
	resolveAudio: NativeRuntimeAudioResolver;
}

export function useNativeRuntimeAssetResolver(
	remoteAssets: readonly string[],
	/**
	 * The session's **logical-name table**: the snapshot the authenticated playback response returned.
	 *
	 * Unlike the remote list, it does not cross the bridge. The authority for the remote list is the
	 * **validated artifact**, which the host inside the WebView must state. The authority for this
	 * table is the **playback response**, which Hermes holds. Round-tripping it would cross the
	 * isolation boundary twice for nothing, since the VM only emits logical names and has no need to
	 * know their identity.
	 *
	 * The caller passes a value **only while the session is running**. That gate is what stops the
	 * table leaking between works, and the remote list already has the same shape.
	 */
	managedAssets: readonly {
		path: string;
		assetId: string;
		/** Absent from snapshots published before this axis existed; absence means `image`. */
		kind?: "image" | "audio";
	}[],
): NativeRuntimeAssetResolvers {
	const credentials = useAuthImageHeaders();
	/**
	 * Keys the list by its **content**. The array is a new object on every render, so depending on it
	 * directly would rebuild the resolver each render, and the renderer would re-request images.
	 */
	const key = remoteAssets.join("\n");
	const allowlist = useMemo<RuntimeRemoteAssetAllowlist>(
		() =>
			key.length === 0
				? EMPTY_REMOTE_ASSET_ALLOWLIST
				: new Set(key.split("\n")),
		[key],
	);
	/**
	 * The table is keyed by **content** too, for the same reason and in the same shape as the list
	 * above: a new array on every render would rebuild the resolver, and the renderer would re-request
	 * images each time.
	 *
	 * It is parsed again from the key. Reading the source array inside the factory would leave its
	 * value out of the dependencies and break the rule, and suppressing the lint with a comment would
	 * silence the next person who adds a different value there too.
	 */
	const bindingKey = managedAssets
		.map(
			(binding) =>
				`${binding.path}\t${binding.assetId}\t${binding.kind ?? "image"}`,
		)
		.join("\n");
	const bindings = useMemo<RuntimeManagedAssetBindings>(
		() =>
			bindingKey.length === 0
				? EMPTY_MANAGED_ASSET_BINDINGS
				: runtimeManagedAssetBindings(
						bindingKey.split("\n").map((line) => {
							const [path = "", assetId = "", kind = "image"] =
								line.split("\t");
							return { path, assetId, kind };
						}),
					),
		[bindingKey],
	);

	const resolveAsset = useMemo<NativeRuntimeAssetResolver>(
		() =>
			authorizeRuntimeAssetResolver(
				() => allowlist,
				bindRuntimeAssetResolver(
					() => bindings,
					(target) => {
						const client = getRowCatClient();
						return resolveNativeRuntimeAsset(target, credentials, {
							mediaUrl: client.media.url,
							runtimeAssetUrl: client.media.runtimeAssetUrl,
						});
					},
				),
			),
		[allowlist, bindings, credentials],
	);

	/**
	 * The audio resolver. **It goes through the same two gates; only the shape of the answer
	 * differs.**
	 *
	 * Passing through authorization and binding unchanged is the point. Skipping either here would
	 * make audio a second path around authorization, and that leak would show no symptom.
	 *
	 * ```text
	 * remote address  → passes the list, but `bindRuntimeAssetResolver` does not resolve it to sound
	 * logical name    → becomes a media URL only when it is in the table and its kind is audio
	 * ```
	 *
	 * The answer is a string, not `{ uri, headers }`, because of the destination. Sound uses only
	 * managed assets (remote ones end above), and the URL is `/v2/media/:id`, a resource with no
	 * viewing gate, so no session header is needed. So **it does not wait for the header to settle**:
	 * unlike an image, the first request cannot end in a 401, and waiting would start background music
	 * late.
	 */
	const resolveAudio = useMemo<NativeRuntimeAudioResolver>(
		() =>
			authorizeRuntimeAssetResolver(
				() => allowlist,
				bindRuntimeAssetResolver(
					() => bindings,
					(target) =>
						resolveNativeRuntimeAudioUrl(target, getRowCatClient().media.url),
				),
			),
		[allowlist, bindings],
	);

	return useMemo(
		() => ({ resolveAsset, resolveAudio }),
		[resolveAsset, resolveAudio],
	);
}
