import {
	authorizeRuntimeAssetResolver,
	bindRuntimeAssetResolver,
	EMPTY_MANAGED_ASSET_BINDINGS,
	type RuntimeManagedAssetBindings,
	type RuntimeRemoteAssetAllowlist,
	runtimeManagedAssetBindings,
} from "@rowcat/runtime/asset";
import { describe, expect, it, vi } from "vitest";
import { resolveNativeRuntimeAsset } from "./asset-resolver.ts";

/** The pure half of the native resolver: no path turns a creator's address into a `uri`. */
const mediaUrl = (mediaId: string) =>
	`https://api.rowcat.test/v2/media/${mediaId}`;
const runtimeAssetUrl = (remote: string) =>
	`https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent(remote)}`;

const urls = { mediaUrl, runtimeAssetUrl };

describe("resolveNativeRuntimeAsset", () => {
	it("remote references become RowCat sources with the session header", () => {
		expect(
			resolveNativeRuntimeAsset(
				{ kind: "remote", url: "https://creator.example/a.png?sig=1" },
				{ ready: true, headers: { Cookie: "rowcat.session=abc" } },
				urls,
			),
		).toEqual({
			uri: `https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent("https://creator.example/a.png?sig=1")}`,
			headers: { Cookie: "rowcat.session=abc" },
		});
	});

	/**
	 * Managed images get the session header too, though the media does not require a cookie. `GET
	 * /v2/media/:id` has no viewing gate (`routes/media.ts`: no middleware, no owner check, only
	 * `status = 'ready'`); the address itself is the authorization, since the id is a 122-bit random
	 * UUIDv4 and cannot be enumerated. The header is attached because the destination is our origin
	 * (`auth-image.ts` decides by origin). When a resource that really is gated passes through this
	 * function, that fact must already hold, and per-branch headers would make the decision two
	 * copies.
	 */
	it("managed images become RowCat media sources with the session header", () => {
		expect(
			resolveNativeRuntimeAsset(
				{ kind: "managed", mediaId: "media-A", mediaKind: "image" },
				{ ready: true, headers: { Cookie: "rowcat.session=abc" } },
				urls,
			),
		).toEqual({
			uri: mediaUrl("media-A"),
			headers: { Cookie: "rowcat.session=abc" },
		});
	});

	it("the result's uri isn't the creator's origin", () => {
		const source = resolveNativeRuntimeAsset(
			{ kind: "remote", url: "https://creator.example/pixel.png" },
			{ ready: true },
			urls,
		) as { uri: string };
		expect(source.uri.startsWith("https://api.rowcat.test/")).toBe(true);
		expect(source.uri.startsWith("https://creator.example/")).toBe(false);
	});

	/**
	 * Both branches wait together. This is a transport property, not managed-asset authorization.
	 * `Image` remembers a failed URI (`onError` → `failedUri`), so a request sent before the headers
	 * arrive would leave that picture a placeholder forever. The remote proxy really returns 401
	 * without a session (it is not an open proxy); managed images do not, yet they wait too. Sending
	 * each branch at a different moment would make that ordering a second rule, and only one frame is
	 * gained.
	 */
	it("a placeholder before the session header is settled — on both branches", () => {
		for (const target of [
			{ kind: "remote", url: "https://creator.example/a.png" },
			{ kind: "managed", mediaId: "media-A", mediaKind: "image" },
		] as const)
			expect(
				resolveNativeRuntimeAsset(target, { ready: false }, urls),
			).toBeNull();
	});

	it("an empty identity is a placeholder — it doesn't throw", () => {
		expect(
			resolveNativeRuntimeAsset(
				{ kind: "managed", mediaId: "", mediaKind: "image" },
				{ ready: true },
				{ mediaUrl: () => "", runtimeAssetUrl },
			),
		).toBeNull();
	});
});

/**
 * The composition of authorization, bindings, and resolution: the function the playback renderer
 * actually receives. It uses the same model as the web. If one side is looser, the same story sends
 * different requests per device, and the difference is visible only in the creator's server logs.
 */
describe("the composed native resolver", () => {
	const declared = "https://cdn.example.com/a.png";
	const assembled = "https://creator.example/pixel.png?q=secret";
	const credentials = { ready: true, headers: { Cookie: "rowcat.session=a" } };
	const allowlist: RuntimeRemoteAssetAllowlist = new Set([declared]);
	const bindings = runtimeManagedAssetBindings([
		{ path: "characters/sena/smile", assetId: "media-A" },
	]);

	const compose = (
		list: RuntimeRemoteAssetAllowlist = allowlist,
		map: RuntimeManagedAssetBindings = bindings,
	) =>
		authorizeRuntimeAssetResolver(
			() => list,
			bindRuntimeAssetResolver(
				() => map,
				(target) => resolveNativeRuntimeAsset(target, credentials, urls),
			),
		);

	it("a bound logical name becomes a RowCat media source", () => {
		expect(
			compose()({ kind: "logical", path: "characters/sena/smile" }, "image"),
		).toEqual({ uri: mediaUrl("media-A"), headers: credentials.headers });
	});

	/** An unbound name is a placeholder, not an error; it is a normal authoring state. */
	it("an unbound logical name is a placeholder", () => {
		expect(
			compose()({ kind: "logical", path: "characters/sena/missing" }, "image"),
		).toBeNull();
	});

	it("a declared address becomes a RowCat source", () => {
		expect(compose()({ kind: "remote", url: declared }, "image")).toEqual({
			uri: runtimeAssetUrl(declared),
			headers: credentials.headers,
		});
	});

	it("an address the runtime assembled doesn't become a source", () => {
		expect(compose()({ kind: "remote", url: assembled }, "image")).toBeNull();
	});

	it("for an unauthorized address no address is even built", () => {
		const builder = vi.fn(runtimeAssetUrl);
		const guarded = authorizeRuntimeAssetResolver(
			() => allowlist,
			bindRuntimeAssetResolver(
				() => bindings,
				(target) =>
					resolveNativeRuntimeAsset(target, credentials, {
						mediaUrl,
						runtimeAssetUrl: builder,
					}),
			),
		);
		expect(guarded({ kind: "remote", url: assembled }, "image")).toBeNull();
		expect(builder).not.toHaveBeenCalled();
	});

	/** Logical names are not an axis of the remote allowlist: an empty list still opens them if the table has them. */
	it("logical names are independent of the remote allowlist", () => {
		expect(
			compose(new Set<string>())(
				{ kind: "logical", path: "characters/sena/smile" },
				"image",
			),
		).not.toBeNull();
	});

	/**
	 * With an empty table every logical reference is a placeholder. The screen clears the table
	 * outside its session to prevent leaks between stories; this test shows what that gate does.
	 */
	it("when the table empties, previously bound names become placeholders too", () => {
		expect(
			compose(allowlist, EMPTY_MANAGED_ASSET_BINDINGS)(
				{ kind: "logical", path: "characters/sena/smile" },
				"image",
			),
		).toBeNull();
	});

	it("the creator's origin becomes a uri on no branch", () => {
		for (const url of [declared, assembled]) {
			const source = compose()({ kind: "remote", url }, "image") as {
				uri?: string;
			} | null;
			expect(source?.uri?.startsWith("https://cdn.example.com") ?? false).toBe(
				false,
			);
			expect(source?.uri?.startsWith("https://creator.example") ?? false).toBe(
				false,
			);
		}
	});
});
