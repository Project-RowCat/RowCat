import { describe, expect, it, vi } from "vitest";
import { resolveNativeImageSource } from "./image-source.ts";

/**
 * Tests the native Image source as values, not by rendering, since there is no simulator here. It
 * verifies that no path exists for a creator's address to sit in uri. What it checks is where the
 * value passed to Image comes from: only the resolver's answer. The resolver receives a classified
 * kind, not a string.
 */

type Source = { uri: string; headers?: Record<string, string> };

const proxy = (target: { kind: string; url?: string }): Source | null =>
	target.kind === "remote"
		? {
				uri: `https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent(target.url ?? "")}`,
				headers: { Cookie: "session" },
			}
		: null;

describe("resolveNativeImageSource", () => {
	it("remote references become RowCat sources made by the resolver: not the creator's address", () => {
		const source = resolveNativeImageSource<Source>(
			"https://creator.example/a.png?sig=1",
			proxy,
		);
		expect(source?.uri.startsWith("https://api.rowcat.test/")).toBe(true);
		expect(source?.uri.startsWith("https://creator.example/")).toBe(false);
		expect(source?.uri).toContain(
			encodeURIComponent("https://creator.example/a.png?sig=1"),
		);
	});

	it("the resolver receives a decided kind, not a string", () => {
		const resolve = vi.fn<(target: unknown) => Source | null>(() => null);
		resolveNativeImageSource("https://cdn.example.com/a.png", resolve);
		resolveNativeImageSource("characters/sena/smile", resolve);
		expect(resolve.mock.calls).toEqual([
			[{ kind: "remote", url: "https://cdn.example.com/a.png" }, "image"],
			[{ kind: "logical", path: "characters/sena/smile" }, "image"],
		]);
	});

	/**
	 * This proxy answers only for remote references. The renderer cannot resolve logical names; the
	 * table from logical name to media identity is held and filled by the playback surface within the
	 * session. So a null answer is a placeholder, and the fact that the verdict is not this package's
	 * is visible here.
	 */
	it("logical references the resolver does not answer are placeholders", () => {
		expect(
			resolveNativeImageSource<Source>("characters/sena/smile", proxy),
		).toBeNull();
	});

	it("without props it is a placeholder", () => {
		const resolve = vi.fn(() => ({ uri: "never" }));
		expect(resolveNativeImageSource(null, resolve)).toBeNull();
		expect(resolve).not.toHaveBeenCalled();
	});

	/**
	 * Values the runtime could not have sealed never reach the resolver, even if they look like
	 * addresses.
	 */
	it.each([
		"http://creator.example/a.png",
		"https://127.0.0.1/a.png",
		"https://user:pw@creator.example/a.png",
		"data:image/png;base64,AAAA",
		"../secret",
	])("corrupt values are placeholders: %s", (value) => {
		const resolve = vi.fn(() => ({ uri: "never" }));
		expect(resolveNativeImageSource(value, resolve)).toBeNull();
		expect(resolve).not.toHaveBeenCalled();
	});
});
