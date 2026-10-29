import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	authorizeRuntimeAssetResolver,
	bindRuntimeAssetResolver,
	EMPTY_MANAGED_ASSET_BINDINGS,
	type RuntimeManagedAssetBindings,
	type RuntimeRemoteAssetAllowlist,
	runtimeManagedAssetBindings,
} from "@rowcat/runtime/asset";
import { describe, expect, it, vi } from "vitest";
import {
	createWebRuntimeAssetResolver,
	resolveWebRuntimeAsset,
} from "./web-asset-resolver.ts";

/**
 * Guards one thing: the resolver's answer is always our own origin. Remote assets must not come
 * back as the creator's address, or the player's browser would request that host (a tracking
 * pixel). A managed image's answer is a media identity, not an address, and setting that string as
 * src makes the browser re-request the current page. Neither defect is visible on screen; it only
 * shows up as a value.
 */
const mediaUrl = (mediaId: string) =>
	`https://api.rowcat.test/v2/media/${mediaId}`;
const runtimeAssetUrl = (remote: string) =>
	`https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent(remote)}`;

const urls = { mediaUrl, runtimeAssetUrl };

describe("createWebRuntimeAssetResolver", () => {
	it("a remote reference becomes a RowCat proxy address, not the creator's origin", () => {
		const url = createWebRuntimeAssetResolver(urls)({
			kind: "remote",
			url: "https://creator.example/pixel.png?id=42",
		});
		expect(url).toBe(
			runtimeAssetUrl("https://creator.example/pixel.png?id=42"),
		);
		expect(url?.startsWith("https://creator.example")).toBe(false);
	});

	it("a managed image becomes a RowCat media address", () => {
		expect(
			createWebRuntimeAssetResolver(urls)({
				kind: "managed",
				mediaId: "media-A",
				mediaKind: "image",
			}),
		).toBe(mediaUrl("media-A"));
	});

	it("an empty address is a placeholder; it does not throw", () => {
		const empty = createWebRuntimeAssetResolver({
			mediaUrl: () => "",
			runtimeAssetUrl: () => "",
		});
		expect(
			empty({ kind: "managed", mediaId: "", mediaKind: "image" }),
		).toBeNull();
		expect(
			empty({ kind: "remote", url: "https://creator.example/a.png" }),
		).toBeNull();
	});
});

describe("resolveWebRuntimeAsset", () => {
	/**
	 * A logical path cannot be expressed in this function's type. Mapping it to a media identity is
	 * the session binding table's job, and a string that skipped the table cannot arrive here. The
	 * synthetic test below checks that as a value; this one only checks that the wiring loads without
	 * a client.
	 */
	it("the module exports the app's resolver", () => {
		expect(typeof resolveWebRuntimeAsset).toBe("function");
	});
});

/**
 * The composed resolver, i.e. the function shape the renderer actually receives. The preview and
 * playback hooks both build it: the remote list comes from the session's `started`, and the logical
 * table from a draft snapshot or a publish response. These tests check what the composition
 * produces and what it does not.
 */
describe("composed resolver", () => {
	const declared = "https://cdn.example.com/a.png";
	const assembled = "https://creator.example/pixel.png?q=secret";
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
			bindRuntimeAssetResolver(() => map, createWebRuntimeAssetResolver(urls)),
		);

	it("a bound logical name becomes a RowCat media address", () => {
		expect(
			compose()({ kind: "logical", path: "characters/sena/smile" }, "image"),
		).toBe(mediaUrl("media-A"));
	});

	/**
	 * An unbound logical name is a placeholder, not an error (§32). Images not yet uploaded, paths
	 * mid-rename, and dynamically assembled names without a matching combination are normal states
	 * during authoring. If one of them killed the session, the screen would not open while the project
	 * is being fixed.
	 */
	it("an unbound logical name is a placeholder", () => {
		expect(
			compose()({ kind: "logical", path: "characters/sena/missing" }, "image"),
		).toBeNull();
	});

	/**
	 * A dynamically built name also opens if the table has it. The threat model differs from remote
	 * addresses (§31).
	 */
	it("a dynamically assembled logical name opens if it is in the table", () => {
		const face = "smile";
		expect(
			compose()({ kind: "logical", path: `characters/sena/${face}` }, "image"),
		).toBe(mediaUrl("media-A"));
	});

	it("a declared remote address becomes a RowCat proxy address", () => {
		expect(compose()({ kind: "remote", url: declared }, "image")).toBe(
			runtimeAssetUrl(declared),
		);
	});

	it("a remote address the runtime assembled becomes no address; it is a placeholder", () => {
		expect(compose()({ kind: "remote", url: assembled }, "image")).toBeNull();
	});

	it("an unauthorized remote address never gets an address built", () => {
		const builder = vi.fn(runtimeAssetUrl);
		const guarded = authorizeRuntimeAssetResolver(
			() => allowlist,
			bindRuntimeAssetResolver(
				() => bindings,
				createWebRuntimeAssetResolver({ mediaUrl, runtimeAssetUrl: builder }),
			),
		);
		expect(guarded({ kind: "remote", url: assembled }, "image")).toBeNull();
		expect(builder).not.toHaveBeenCalled();
	});

	/**
	 * The creator's origin must not appear as the answer on either branch, even for an authorized
	 * asset, because authorized assets also go through the proxy.
	 */
	it("the creator's origin does not appear in the answer", () => {
		for (const url of [declared, assembled]) {
			const answer = compose()({ kind: "remote", url }, "image");
			expect(answer?.startsWith("https://cdn.example.com") ?? false).toBe(
				false,
			);
			expect(answer?.startsWith("https://creator.example") ?? false).toBe(
				false,
			);
		}
	});

	/**
	 * Logical names are not an axis of the remote allow-list (§30): a name the table has still opens
	 * when the remote list is empty.
	 */
	it("logical names do not depend on the remote authorization list", () => {
		expect(
			compose(new Set<string>())(
				{ kind: "logical", path: "characters/sena/smile" },
				"image",
			),
		).toBe(mediaUrl("media-A"));
	});

	/**
	 * The table is passed as a function because the renderer is built once while sessions are set many
	 * times. Frozen as a value, the previous work's images would open in the next work with no visible
	 * symptom.
	 */
	it("a changed table applies from the next decision", () => {
		let current: RuntimeManagedAssetBindings = EMPTY_MANAGED_ASSET_BINDINGS;
		const live = bindRuntimeAssetResolver(
			() => current,
			createWebRuntimeAssetResolver(urls),
		);
		const path = "characters/sena/smile";
		expect(live({ kind: "logical", path }, "image")).toBeNull();
		current = runtimeManagedAssetBindings([{ path, assetId: "media-A" }]);
		expect(live({ kind: "logical", path }, "image")).toBe(mediaUrl("media-A"));
		current = runtimeManagedAssetBindings([{ path, assetId: "media-B" }]);
		expect(live({ kind: "logical", path }, "image")).toBe(mediaUrl("media-B"));
		current = EMPTY_MANAGED_ASSET_BINDINGS;
		expect(live({ kind: "logical", path }, "image")).toBeNull();
	});

	/** The table carries media identity, not addresses; the SDK builds the URL. */
	it("the table carries identities, not addresses", () => {
		expect([...bindings.values()]).toEqual([
			{ mediaId: "media-A", mediaKind: "image" },
		]);
		for (const value of bindings.values())
			expect(value.mediaId.startsWith("http")).toBe(false);
	});
});

/**
 * Preview and playback go through the same gate, so they meet the same server rules. The per-member
 * byte budget, process slots, and cancellation for remote images are enforced by the server proxy
 * (apps/api/src/routes/runtime-assets.ts), and they apply only if both surfaces call the same
 * endpoint with the same address rule. A surface with its own resolver would silently skip the
 * budget and SSRF check while still rendering correctly; using the source address directly as src
 * is the easiest such mistake.
 */
describe("runtime surfaces use one resolver", () => {
	const SURFACES = [
		"features/runtime-studio/runtime-studio-page.tsx",
		"features/playtest/runtime-playtest.tsx",
		"features/runtime-player/runtime-conversation.tsx",
		"features/runtime-template-lab/template-lab-page.tsx",
	];
	const SRC = fileURLToPath(new URL("../..", import.meta.url));

	it.each(SURFACES)("%s", (surface) => {
		const source = readFileSync(join(SRC, surface), "utf8");
		expect(source).toMatch(
			/import \{ resolveWebRuntimeAsset \} from "#\/lib\/runtime-assets\/web-asset-resolver\.ts";/,
		);
		/** Proxy and media paths must not be hand-assembled; that rule belongs to the SDK alone. */
		expect(source).not.toMatch(/\/runtime\/assets\/remote|\/v2\/media\//);
	});
});
