import { describe, expect, it } from "vitest";
import {
	prepareRuntimeAssetCatalog,
	type RuntimeAssetEditorEntry,
} from "./catalog.ts";
import {
	planRuntimeAssetHover,
	runtimeAssetHoverMarkdown,
	runtimeAssetThumbnailBox,
} from "./hover.ts";

/**
 * Preview above a name written in code. The most important thing in this file is where the address
 * points. If the hover opened a creator's remote address, opening the studio would send a request
 * to the creator's server, and that request would go out just from the cursor passing over the
 * name.
 */

const ORIGIN = "https://api.rowcat.test";
const MEDIA = (mediaId: string) => `${ORIGIN}/v2/media/${mediaId}`;

const entry = (
	path: string,
	extra: Partial<RuntimeAssetEditorEntry> = {},
): RuntimeAssetEditorEntry => ({
	path,
	kind: "image",
	mediaId: "media-A",
	mime: "image/webp",
	width: 640,
	height: 480,
	durationMs: null,
	...extra,
});

const catalog = (...entries: RuntimeAssetEditorEntry[]) =>
	prepareRuntimeAssetCatalog(entries, MEDIA);

const hoverIn = (source: string, needle: string) =>
	planRuntimeAssetHover(
		catalog(entry("characters/sena/smile")),
		source,
		source.indexOf(needle),
	);

describe("bound names", () => {
	const SOURCE = '<Image source={asset("characters/sena/smile")} />';

	it("gives name, dimensions, format and thumbnail", () => {
		const content = hoverIn(SOURCE, "smile");
		expect(content?.path).toBe("characters/sena/smile");
		expect(content?.detail).toBe("640 × 480 · WebP");
		expect(content?.image?.url).toBe(`${ORIGIN}/v2/media/media-A`);
	});

	it("the highlight range is inside the quotes", () => {
		const content = hoverIn(SOURCE, "smile");
		expect(SOURCE.slice(content?.start, content?.end)).toBe(
			"characters/sena/smile",
		);
	});

	/**
	 * The thumbnail address is built only from the media identity. If a path existed where characters
	 * written in source sit, those characters would be a value the creator controls.
	 */
	it("the URL is RowCat's origin, not built from the source text", () => {
		const content = hoverIn(SOURCE, "smile");
		expect(content?.image?.url.startsWith(`${ORIGIN}/`)).toBe(true);
		expect(content?.image?.url).not.toContain("characters/sena/smile");
	});

	it("neither the storage key nor the media identity appears in screen text", () => {
		const content = hoverIn(SOURCE, "smile");
		expect(content).not.toBeNull();
		expect(content?.path).toBe("characters/sena/smile");
		expect(content?.detail).not.toContain("media-A");
	});
});

describe("places that draw nothing", () => {
	it("an unbound name shows no fake preview", () => {
		expect(hoverIn('asset("characters/sena/missing")', "missing")).toBeNull();
	});

	/**
	 * Over a creator's remote address, no address is built at all. Building one would let a hover
	 * bypass the proxy boundary that exists to hide the player's IP, inside the editor.
	 */
	it("a remote HTTPS URL makes no hover", () => {
		const source = 'asset("https://creator.example/a.png")';
		expect(
			planRuntimeAssetHover(
				catalog(entry("characters/sena/smile")),
				source,
				source.indexOf("creator"),
			),
		).toBeNull();
	});

	it("a template with substitutions does not invent an exact hover", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the `${face}` is input from the creator's source, not one of our templates.
		const source = "asset(`characters/sena/${face}`)";
		expect(
			planRuntimeAssetHover(
				catalog(entry("characters/sena/smile")),
				source,
				source.indexOf("sena"),
			),
		).toBeNull();
	});

	it("plain strings and comments have no hover", () => {
		for (const source of [
			'const x = "characters/sena/smile";',
			'// asset("characters/sena/smile")',
		])
			expect(
				planRuntimeAssetHover(
					catalog(entry("characters/sena/smile")),
					source,
					source.indexOf("smile"),
				),
				source,
			).toBeNull();
	});
});

/**
 * A 4000×4000 image must not grow the hover to the size of the screen. Keeping the aspect ratio is
 * part of the rule too: writing both axes as the box values would squash a tall image.
 */
describe("thumbnail box", () => {
	it("shrinks a large picture keeping its ratio", () => {
		expect(runtimeAssetThumbnailBox(4000, 4000)).toEqual({
			width: 160,
			height: 160,
		});
		expect(runtimeAssetThumbnailBox(2000, 500)).toEqual({
			width: 220,
			height: 55,
		});
	});

	it("does not enlarge a small picture", () => {
		expect(runtimeAssetThumbnailBox(48, 48)).toEqual({ width: 48, height: 48 });
	});

	it("no box for broken dimensions", () => {
		expect(runtimeAssetThumbnailBox(0, 100)).toBeNull();
		expect(runtimeAssetThumbnailBox(Number.NaN, 100)).toBeNull();
	});

	it("without dimensions it draws text only", () => {
		const content = planRuntimeAssetHover(
			catalog(entry("ui/heart", { width: 0, height: 0 })),
			'asset("ui/heart")',
			8,
		);
		expect(content?.image).toBeNull();
		expect(content?.path).toBe("ui/heart");
	});
});

describe("markdown", () => {
	it("holds name, picture and detail and sends the box values", () => {
		const markdown = runtimeAssetHoverMarkdown({
			path: "characters/sena/smile",
			detail: "640 × 480 · WebP",
			image: { url: `${ORIGIN}/v2/media/media-A`, width: 220, height: 165 },
			start: 0,
			end: 0,
		});
		expect(markdown).toBe(
			[
				"`characters/sena/smile`",
				`![characters/sena/smile](${ORIGIN}/v2/media/media-A|width=220,height=165)`,
				"640 × 480 · WebP",
			].join("\n\n"),
		);
	});

	/**
	 * No command links and no raw HTML. The hover is the only place where a creator-written value
	 * becomes markdown, so an executable item there would make the editor an attack surface.
	 */
	it("makes neither command links nor HTML", () => {
		const markdown = runtimeAssetHoverMarkdown({
			path: "ui/heart",
			detail: "10 × 10 · PNG",
			image: { url: `${ORIGIN}/v2/media/m`, width: 10, height: 10 },
			start: 0,
			end: 0,
		});
		expect(markdown).not.toContain("command:");
		expect(markdown).not.toContain("<");
	});

	it("no picture for a URL that would break the markdown", () => {
		const content = planRuntimeAssetHover(
			prepareRuntimeAssetCatalog(
				[entry("ui/heart")],
				() => `${ORIGIN}/v2/media/a|b`,
			),
			'asset("ui/heart")',
			8,
		);
		expect(content?.image).toBeNull();
	});

	it("an empty URL has no picture, so the current page isn't requested again", () => {
		const content = planRuntimeAssetHover(
			prepareRuntimeAssetCatalog([entry("ui/heart")], () => ""),
			'asset("ui/heart")',
			8,
		);
		expect(content?.image).toBeNull();
	});
});
