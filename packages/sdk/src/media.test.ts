import { describe, expect, it } from "vitest";
import { createMediaApi } from "./media.ts";

/**
 * Checks the one media address rule: what the screen gets from this function, and that this is the
 * only place linking a stored reference (`assetId`) to the deployment origin. A second copy would
 * go stale when the path changes.
 */

const media = createMediaApi("https://api.example/v2");

describe("mediaUrl", () => {
	it("appends the media path to the base", () => {
		expect(media.url("abc123")).toBe("https://api.example/v2/media/abc123");
	});

	it("encodes the id so a corrupt reference cannot escape the path", () => {
		expect(media.url("a/../b")).toBe("https://api.example/v2/media/a%2F..%2Fb");
	});

	it("an empty id is an empty string; it does not throw", () => {
		/**
		 * This value comes from a snapshot saved on the device months ago. One corrupt reference must not
		 * freeze the whole chat screen.
		 */
		expect(media.url("")).toBe("");
	});
});

describe("runtimeAssetUrl", () => {
	/**
	 * A creator's address is carried only as a query value. The result's origin is always ours, which
	 * is half of the promise that a player's device never reaches the creator's host (the server proxy
	 * is the other half).
	 */
	it("builds a proxy address on our origin", () => {
		expect(media.runtimeAssetUrl("https://cdn.example.com/a.png?v=1&x=y")).toBe(
			"https://api.example/v2/runtime/assets/remote?url=https%3A%2F%2Fcdn.example.com%2Fa.png%3Fv%3D1%26x%3Dy",
		);
	});

	it("the result does not start with the creator's address", () => {
		const url = media.runtimeAssetUrl("https://creator.example/pixel.png");
		expect(url.startsWith("https://api.example/")).toBe(true);
		expect(url.startsWith("https://creator.example/")).toBe(false);
	});

	it("an empty value is an empty string; it does not throw", () => {
		expect(media.runtimeAssetUrl("")).toBe("");
	});
});
