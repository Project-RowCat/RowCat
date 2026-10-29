import { describe, expect, it } from "vitest";
import {
	asset,
	authorizeRuntimeAssetResolver,
	authorizeRuntimeAssetTarget,
	bindRuntimeAssetResolver,
	canonicalRemoteAssetList,
	classifyRuntimeAssetValue,
	EMPTY_MANAGED_ASSET_BINDINGS,
	EMPTY_REMOTE_ASSET_ALLOWLIST,
	isAssetRef,
	type ResolvedRuntimeAssetTarget,
	RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH,
	runtimeAssetPath,
	runtimeManagedAssetBindings,
} from "./asset.ts";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";

/**
 * What asset references guarantee: what they accept, what they reject, and what an accepted value
 * is not. The type contract (a plain string source on Image is blocked) needs a real program to
 * check, so the compiler's tests own it (packages/runtime-compiler/src/compile.test.ts). Where a
 * remote address leads (private networks, redirects) is decided by the server at connect time
 * (apps/api/src/lib/remote-image). This module checks only the shape.
 */

const code = (fn: () => unknown): string => {
	try {
		fn();
	} catch (error) {
		if (error instanceof RuntimeError) return error.code;
		return `unexpected:${String(error)}`;
	}
	return "did not throw";
};

describe("logical paths", () => {
	it("seals a logical path as a reference", () => {
		const ref = asset("characters/sena/smile");
		expect(isAssetRef(ref)).toBe(true);
		expect(runtimeAssetPath(ref)).toBe("characters/sena/smile");
		expect(classifyRuntimeAssetValue("characters/sena/smile")).toEqual({
			kind: "logical",
			path: "characters/sena/smile",
		});
	});

	it.each([
		"music/mystery",
		"backgrounds/library",
		"cover",
		"ui/icons/heart-2",
		"scenes/ch1.intro",
		"a/b/c/d/e/f/g/h",
	])("%s", (path) => {
		expect(runtimeAssetPath(asset(path))).toBe(path);
	});

	it("is deterministic", () => {
		expect(runtimeAssetPath(asset("music/mystery"))).toBe(
			runtimeAssetPath(asset("music/mystery")),
		);
	});

	it("the reference is frozen", () => {
		expect(Object.isFrozen(asset("cover"))).toBe(true);
	});

	it.each([
		"../secret",
		"a/../../secret",
		"./here",
		"a/./b",
		"..",
	])("does not accept going up: %s", (path) => {
		expect(code(() => asset(path))).toBe(RUNTIME_ERROR_CODE.invalidAssetRef);
	});

	it.each([
		["", "empty value"],
		[" ", "whitespace only"],
		[" cover", "leading whitespace"],
		["cover ", "trailing whitespace"],
		["a b", "inner whitespace"],
		["/cover", "absolute path"],
		["cover/", "trailing slash"],
		["a//b", "empty segment"],
		["a\\b", "backslash"],
		["-cover", "starts with a symbol"],
		[".hidden", "starts with a dot"],
		["cover?v=1", "query string"],
		["cover#frag", "fragment"],
		["a/b/c/d/e/f/g/h/i", "too deep"],
		["a".repeat(201), "too long"],
	])("%s (%s)", (path) => {
		expect(code(() => asset(path))).toBe(RUNTIME_ERROR_CODE.invalidAssetRef);
	});

	/** Even where there is no type check, this function is the only gate. */
	it("non-string values throw too", () => {
		expect(code(() => asset(null as unknown as string))).toBe(
			RUNTIME_ERROR_CODE.invalidAssetRef,
		);
	});
});

describe("remote HTTPS images", () => {
	it("seals a public HTTPS address as a reference", () => {
		const ref = asset("https://cdn.example.com/characters/sena.webp");
		expect(isAssetRef(ref)).toBe(true);
		expect(runtimeAssetPath(ref)).toBe(
			"https://cdn.example.com/characters/sena.webp",
		);
		expect(
			classifyRuntimeAssetValue("https://cdn.example.com/characters/sena.webp"),
		).toEqual({
			kind: "remote",
			url: "https://cdn.example.com/characters/sena.webp",
		});
	});

	it.each([
		"https://example.com/a.png",
		"https://cdn.example.com/images/a.webp",
		"https://images.example.com/a.jpg?v=42",
		"https://images.example.com/path/to/image.png?width=800&quality=90",
		"https://images.example.com:443/a.png",
		"https://example.com/",
		"https://example.com",
		"https://xn--9n2bp8q.example/a.png",
		"https://cdn.example.com/a%20b.png?sig=abc%2Fdef",
		"https://a.b.c.d.example.co.kr/x/y/z.gif",
	])("accepts: %s", (url) => {
		expect(runtimeAssetPath(asset(url))).toBe(url);
		expect(classifyRuntimeAssetValue(url)?.kind).toBe("remote");
	});

	/** The reference keeps exactly what was written. It is not normalized or encoded. */
	it("does not modify the address", () => {
		const url = "https://cdn.example.com/a.png?token=abc&x=1";
		expect(runtimeAssetPath(asset(url))).toBe(url);
	});

	it("accepts long addresses within the cap and refuses those past it", () => {
		const prefix = "https://cdn.example.com/?q=";
		const fits =
			prefix + "a".repeat(RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH - prefix.length);
		expect(fits.length).toBe(RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH);
		expect(runtimeAssetPath(asset(fits))).toBe(fits);
		expect(code(() => asset(`${fits}a`))).toBe(
			RUNTIME_ERROR_CODE.invalidAssetRef,
		);
	});

	/**
	 * The scheme is a single value, not a list. http: is plaintext. The other schemes are content or
	 * execution, not addresses.
	 */
	it.each([
		"http://example.com/a.png",
		"HTTP://example.com/a.png",
		"HTTPS://example.com/a.png",
		"Https://example.com/a.png",
		"//example.com/a.png",
		"data:image/png;base64,AAAA",
		"blob:https://example.com/uuid",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"vbscript:msgbox",
		"ftp://example.com/a.png",
		"https:example.com/a.png",
		"https:/example.com/a.png",
	])("does not accept the scheme: %s", (url) => {
		expect(code(() => asset(url))).toBe(RUNTIME_ERROR_CODE.invalidAssetRef);
		expect(classifyRuntimeAssetValue(url)).toBeNull();
	});

	it.each([
		["https://user:password@example.com/a.png", "credentials"],
		["https://user@example.com/a.png", "user name"],
		["https://@example.com/a.png", "empty credentials"],
	])("%s (%s)", (url) => {
		expect(code(() => asset(url))).toBe(RUNTIME_ERROR_CODE.invalidAssetRef);
	});

	/**
	 * IP literals are rejected in any notation. Requiring a name means there is no need to count every
	 * way a private address can be written. localhost is a name, but it always refers to this device.
	 */
	it.each([
		"https://127.0.0.1/a.png",
		"https://10.0.0.5/a.png",
		"https://169.254.169.254/latest/meta-data",
		"https://[::1]/a.png",
		"https://[fe80::1]/a.png",
		"https://2130706433/a.png",
		"https://0x7f000001/a.png",
		"https://127.1/a.png",
		"https://localhost/a.png",
		"https://localhost:443/a.png",
		"https://api.localhost/a.png",
		"https://intranet/a.png",
		"https://example.com./a.png",
	])("does not accept the host: %s", (url) => {
		expect(code(() => asset(url))).toBe(RUNTIME_ERROR_CODE.invalidAssetRef);
		expect(classifyRuntimeAssetValue(url)).toBeNull();
	});

	it.each([
		["https://example.com:8443/a.png", "another port"],
		["https://example.com:80/a.png", "plain port"],
		["https://example.com:/a.png", "empty port"],
		["https://EXAMPLE.com/a.png", "uppercase host"],
		["https://exa mple.com/a.png", "whitespace in the host"],
		["https://example.com/a b.png", "whitespace in the path"],
		[" https://example.com/a.png", "leading whitespace"],
		["https://example.com/a.png ", "trailing whitespace"],
		["https://example.com/a.png\n", "line break"],
		["https://example.com/a\tb.png", "tab"],
		["https://example.com/a.png#frag", "fragment"],
		["https://example.com/a.png?x=%2", "broken percent encoding"],
		["https://example.com/\ud55c\uae00.png", "unencoded non-ASCII"],
		["https://example.com/a\\b.png", "backslash"],
		["https://example.com/<a>.png", "angle brackets"],
		["https://-example.com/a.png", "a label starting with a hyphen"],
		["https://ex_ample.com/a.png", "underscore"],
		["https:///a.png", "no host"],
	])("%s (%s)", (url) => {
		expect(code(() => asset(url))).toBe(RUNTIME_ERROR_CODE.invalidAssetRef);
	});
});

describe("is opaque", () => {
	/**
	 * If a reference were a hidden string, creators would start concatenating and slicing it, and a
	 * later host would receive a shape it never issued. The same holds for remote addresses. If a .url
	 * property existed, it would become the API.
	 */
	it.each([
		"characters/sena/smile",
		"https://cdn.example.com/a.png",
	])("has no named property at all: %s", (value) => {
		const ref = asset(value) as unknown as Record<string, unknown>;
		expect(Object.keys(ref)).toEqual([]);
		expect(ref.url).toBeUndefined();
		expect(ref.id).toBeUndefined();
		expect(ref.path).toBeUndefined();
		expect(ref.kind).toBeUndefined();
		expect(ref.source).toBeUndefined();
		expect(JSON.stringify(ref)).toBe("{}");
	});

	it("is not a string", () => {
		expect(typeof asset("cover")).toBe("object");
		expect(typeof asset("https://example.com/a.png")).toBe("object");
	});

	/** A plain object that imitates a reference's shape is not a reference. The key is a symbol. */
	it("cannot be forged", () => {
		expect(isAssetRef({ path: "cover" })).toBe(false);
		expect(isAssetRef({ url: "https://example.com/a.png" })).toBe(false);
		expect(isAssetRef("characters/sena/smile")).toBe(false);
		expect(isAssetRef(JSON.parse('{"path":"cover"}'))).toBe(false);
	});
});

describe("the trusted layer's decision", () => {
	/**
	 * The renderer and the server get the kind from the same function. Not throwing is the point: one
	 * corrupted wire value must not kill the session, and the server answers 400.
	 */
	it("null for values asset() refuses", () => {
		expect(classifyRuntimeAssetValue("")).toBeNull();
		expect(classifyRuntimeAssetValue("../x")).toBeNull();
		expect(classifyRuntimeAssetValue("http://example.com/a.png")).toBeNull();
		expect(classifyRuntimeAssetValue(42 as unknown as string)).toBeNull();
	});

	it("accepts exactly the same set asset() accepts", () => {
		for (const value of [
			"cover",
			"characters/sena/smile",
			"https://example.com/a.png",
			"https://example.com/a.png?v=1",
		]) {
			expect(classifyRuntimeAssetValue(value)).not.toBeNull();
			expect(code(() => asset(value))).toBe("did not throw");
		}
	});
});

/**
 * Authorization: valid syntax does not mean the address may be fetched.
 *
 * asset() also accepts addresses built from runtime values, since it never asks where a value came
 * from. Without an allowlist, one address carrying text the player typed becomes a one-way channel
 * to the creator's server. That the response cannot be read does not prevent it.
 */
describe("remote asset authorization", () => {
	const declared = "https://cdn.example.com/a.png";
	const assembled = "https://creator.example/p.png?q=secret";
	const allowlist = new Set([declared]);

	it("only remote addresses in the list pass", () => {
		expect(
			authorizeRuntimeAssetTarget({ kind: "remote", url: declared }, allowlist),
		).toEqual({ kind: "remote", url: declared });
		expect(
			authorizeRuntimeAssetTarget(
				{ kind: "remote", url: assembled },
				allowlist,
			),
		).toBeNull();
	});

	/**
	 * Logical references are not an authorization concern. No request goes out, so there is nothing to
	 * block.
	 */
	it("logical references pass regardless of the list", () => {
		expect(
			authorizeRuntimeAssetTarget(
				{ kind: "logical", path: "characters/sena" },
				EMPTY_REMOTE_ASSET_ALLOWLIST,
			),
		).toEqual({ kind: "logical", path: "characters/sena" });
	});

	it("an empty list authorizes no remote address", () => {
		expect(
			authorizeRuntimeAssetTarget(
				{ kind: "remote", url: declared },
				EMPTY_REMOTE_ASSET_ALLOWLIST,
			),
		).toBeNull();
	});

	describe("canonicalization", () => {
		it("folds duplicates and sorts by code unit", () => {
			expect(
				canonicalRemoteAssetList([
					"https://cdn.example.com/z.png",
					"https://cdn.example.com/a.png",
					"https://cdn.example.com/z.png",
				]),
			).toEqual([
				"https://cdn.example.com/a.png",
				"https://cdn.example.com/z.png",
			]);
		});

		/**
		 * A list that carries two kinds of values blurs the authorization boundary. Non-remote values are
		 * dropped.
		 */
		it("non-remote values drop", () => {
			expect(
				canonicalRemoteAssetList([
					"characters/sena/smile",
					"http://cdn.example.com/a.png",
					"https://localhost/a.png",
					42,
					null,
					"https://cdn.example.com/a.png",
				]),
			).toEqual(["https://cdn.example.com/a.png"]);
		});

		it("the same input gives the same list regardless of order", () => {
			expect(
				canonicalRemoteAssetList([
					"https://b.example.com/x.png",
					"https://a.example.com/y.png",
				]),
			).toEqual(
				canonicalRemoteAssetList([
					"https://a.example.com/y.png",
					"https://b.example.com/x.png",
				]),
			);
		});
	});

	describe("the wrapping resolver", () => {
		it("does not call the resolver outside the list", () => {
			const calls: string[] = [];
			const resolve = authorizeRuntimeAssetResolver(
				() => allowlist,
				(target) => {
					calls.push(target.kind === "remote" ? target.url : target.path);
					return "resolved";
				},
			);
			expect(resolve({ kind: "remote", url: assembled }, "image")).toBeNull();
			expect(calls).toEqual([]);
			expect(resolve({ kind: "remote", url: declared }, "image")).toBe(
				"resolved",
			);
			expect(calls).toEqual([declared]);
		});

		/** Why the list is a function: the renderer is built once, but sessions start many times. */
		it("a changed list changes from the next decision", () => {
			let current: ReadonlySet<string> = EMPTY_REMOTE_ASSET_ALLOWLIST;
			const resolve = authorizeRuntimeAssetResolver(
				() => current,
				() => "resolved",
			);
			expect(resolve({ kind: "remote", url: declared }, "image")).toBeNull();
			current = allowlist;
			expect(resolve({ kind: "remote", url: declared }, "image")).toBe(
				"resolved",
			);
		});
	});
});

describe("managed asset bindings", () => {
	const IMAGE = "characters/sena/smile";
	const AUDIO = "audio/bgm/main";

	const table = () =>
		runtimeManagedAssetBindings([
			{ path: IMAGE, assetId: "media-image", kind: "image" },
			{ path: AUDIO, assetId: "media-audio", kind: "audio" },
		]);

	/**
	 * Only values that pass the table reach the app's resolver. The test records calls to confirm
	 * that.
	 */
	function resolver(bindings = table()) {
		const seen: ResolvedRuntimeAssetTarget[] = [];
		const resolve = bindRuntimeAssetResolver(
			() => bindings,
			(target) => {
				seen.push(target);
				return "resolved";
			},
		);
		return { seen, resolve };
	}

	describe("resolve only when the kind matches", () => {
		it("image names resolve only as images", () => {
			const r = resolver();
			expect(r.resolve({ kind: "logical", path: IMAGE }, "image")).toBe(
				"resolved",
			);
			expect(r.seen).toEqual([
				{ kind: "managed", mediaId: "media-image", mediaKind: "image" },
			]);
		});

		it("sound names resolve only as sounds", () => {
			const r = resolver();
			expect(r.resolve({ kind: "logical", path: AUDIO }, "audio")).toBe(
				"resolved",
			);
			expect(r.seen).toEqual([
				{ kind: "managed", mediaId: "media-audio", mediaKind: "audio" },
			]);
		});

		/**
		 * These two checks are this slice's security axis.
		 *
		 * If the check relied on a browser decode failure, the request would already have gone out,
		 * possibly to media this session may not open. So what is verified is not that nothing is drawn.
		 * It is that the app's resolver is never invoked. The address is built in exactly one place.
		 */
		it("asking for a sound name as an image builds no address", () => {
			const r = resolver();
			expect(r.resolve({ kind: "logical", path: AUDIO }, "image")).toBeNull();
			expect(r.seen).toEqual([]);
		});

		it("asking for an image name as a sound builds no address", () => {
			const r = resolver();
			expect(r.resolve({ kind: "logical", path: IMAGE }, "audio")).toBeNull();
			expect(r.seen).toEqual([]);
		});
	});

	describe("names not in the table", () => {
		/**
		 * Not an exception. An asset that has not been uploaded yet is a normal state during authoring.
		 */
		it("a placeholder, not a failure", () => {
			const r = resolver();
			expect(
				r.resolve({ kind: "logical", path: "nope/nope" }, "image"),
			).toBeNull();
			expect(
				r.resolve({ kind: "logical", path: "nope/nope" }, "audio"),
			).toBeNull();
			expect(r.seen).toEqual([]);
		});
	});

	describe("remote addresses", () => {
		const remote = {
			kind: "remote",
			url: "https://cdn.example.com/a.webp",
		} as const;

		it("pass as is for images", () => {
			const r = resolver();
			expect(r.resolve(remote, "image")).toBe("resolved");
			expect(r.seen).toEqual([remote]);
		});

		/**
		 * Remote sound is not part of this design.
		 *
		 * The compiler collects static HTTPS strings from source for any primitive that consumes them, so
		 * an address may legitimately appear in the artifact's list. That a sound cannot resolve must be
		 * answered here, and the answer is: no request.
		 */
		it("do not resolve for sounds and build no address", () => {
			const r = resolver();
			expect(r.resolve(remote, "audio")).toBeNull();
			expect(r.seen).toEqual([]);
		});
	});

	describe("absence of kind", () => {
		/**
		 * Bindings in snapshots published before this axis existed have no kind. At that time managed
		 * assets were images only, so the absence itself is the fact. Already-published works must keep
		 * opening.
		 */
		it("no kind means image", () => {
			const r = resolver(
				runtimeManagedAssetBindings([{ path: IMAGE, assetId: "media-old" }]),
			);
			expect(r.resolve({ kind: "logical", path: IMAGE }, "image")).toBe(
				"resolved",
			);
			expect(r.resolve({ kind: "logical", path: IMAGE }, "audio")).toBeNull();
		});

		/**
		 * Unknown values are dropped rather than folded into images. Folding them in would seat a
		 * non-image value in an image slot.
		 */
		it("unknown kinds do not enter the table", () => {
			const r = resolver(
				runtimeManagedAssetBindings([
					{ path: IMAGE, assetId: "media-x", kind: "video" },
				]),
			);
			expect(r.resolve({ kind: "logical", path: IMAGE }, "image")).toBeNull();
			expect(r.seen).toEqual([]);
		});
	});

	/** Why the table is a function: the renderer is built once, but sessions start many times. */
	it("a changed table changes from the next decision", () => {
		let current = EMPTY_MANAGED_ASSET_BINDINGS;
		const resolve = bindRuntimeAssetResolver(
			() => current,
			(target) => (target.kind === "managed" ? target.mediaId : target.url),
		);
		expect(resolve({ kind: "logical", path: AUDIO }, "audio")).toBeNull();
		current = table();
		expect(resolve({ kind: "logical", path: AUDIO }, "audio")).toBe(
			"media-audio",
		);
	});
});
