import { STORY_COVER_INPUT_MIME } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	imageExtensionOf,
	isRefusedImageUrl,
	MARKDOWN_IMAGE_EXTENSIONS,
	REFUSED_IMAGE_EXTENSIONS,
} from "./image-url.ts";
import { looksLikeImageUrl } from "./index.ts";

describe("the vocabulary comes from the contract", () => {
	/**
	 * Checks that the extension table covers every input format in the contract. Otherwise, when a
	 * format is added, its images are silently not promoted: they render as plain links, with no error
	 * or warning.
	 */
	it("every contract input format has an extension", () => {
		const known: Record<string, readonly string[]> = {
			"image/jpeg": ["jpg", "jpeg"],
			"image/png": ["png"],
			"image/webp": ["webp"],
			"image/gif": ["gif"],
		};
		for (const mime of STORY_COVER_INPUT_MIME) {
			expect(known[mime], mime).toBeDefined();
			for (const extension of known[mime] ?? [])
				expect(MARKDOWN_IMAGE_EXTENSIONS, mime).toContain(extension);
		}
	});

	/**
	 * The absence of SVG is the most important fact in this list. SVG is a document that can carry
	 * scripts and external entities, not just an image (contracts/media.ts made the same call).
	 */
	it("SVG is not in the draw list and is in the refuse list", () => {
		expect(MARKDOWN_IMAGE_EXTENSIONS).not.toContain("svg");
		expect(REFUSED_IMAGE_EXTENSIONS).toContain("svg");
		expect(isRefusedImageUrl("https://example.com/x.svg")).toBe(true);
		expect(isRefusedImageUrl("https://example.com/x.svg?v=1")).toBe(true);
		expect(isRefusedImageUrl("https://example.com/x.png")).toBe(false);
	});
});

describe("reading extensions", () => {
	it("strips query and fragment and reads the last path segment", () => {
		expect(imageExtensionOf("https://example.com/a/cat.PNG?v=2#x")).toBe("png");
		expect(imageExtensionOf("https://example.com/a.b/cat")).toBeNull();
		expect(imageExtensionOf("https://example.com/cat.")).toBeNull();
		expect(imageExtensionOf("https://example.com/.hidden")).toBeNull();
	});
});

describe("bare URL promotion", () => {
	it("promotes when it points at an image", () => {
		expect(looksLikeImageUrl("https://example.com/cat.png")).toBe(true);
		expect(looksLikeImageUrl("https://example.com/cat.gif?w=1")).toBe(true);
	});

	/** A URL pointing to a document stays a link, because that is what the author wrote. */
	it("does not promote when it points at a document", () => {
		expect(looksLikeImageUrl("https://example.com/article")).toBe(false);
		expect(looksLikeImageUrl("https://example.com/page.html")).toBe(false);
	});

	it("does not promote a dangerous scheme regardless of extension", () => {
		expect(looksLikeImageUrl("javascript:alert(1)//x.png")).toBe(false);
		expect(looksLikeImageUrl("data:image/png;base64,AAAA")).toBe(false);
	});
});
