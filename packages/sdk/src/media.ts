/**
 * Media: the two rules that turn a reference into an address. The SDK owns the paths and origin,
 * and these methods send no requests.
 * - Avatars and covers carry a server-built url in responses. That is fine, because they are
 *   drawn and then discarded.
 * - Scene images are stored by id only, in replay snapshots kept on devices for months, so the
 *   address is built on each open. A baked-in absolute URL would break every existing room if the
 *   API origin moved.
 * - Runtime remote images are routed through RowCat's proxy so a player's device never contacts
 *   the creator's host. That path is built here too, so the web and native renderers cannot drift
 *   apart.
 */

export interface MediaApi {
	/**
	 * Returns the address for one media item. It is synchronous, since it runs during render, and a
	 * Promise would force a loading state for an image address. An empty id returns an empty string
	 * instead of throwing. The id comes from a device snapshot that may be months old, and one corrupt
	 * reference must not freeze the chat screen.
	 */
	url(mediaId: string): string;
	/**
	 * The argument is the HTTPS address exactly as the creator wrote it in `asset()`. The result is an
	 * address on our origin, so even if the string lands in `<img src>`, the device never reaches the
	 * creator's host. Validity (syntax, public host, image type) is decided by the server; this
	 * function only assembles. Empty input returns an empty string, as `url()` does.
	 */
	runtimeAssetUrl(remoteUrl: string): string;
}

export const createMediaApi = (base: string): MediaApi => ({
	url: (mediaId) =>
		mediaId ? `${base}/media/${encodeURIComponent(mediaId)}` : "",
	runtimeAssetUrl: (remoteUrl) =>
		remoteUrl
			? `${base}/runtime/assets/remote?url=${encodeURIComponent(remoteUrl)}`
			: "",
});
