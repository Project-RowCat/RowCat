import type * as monaco from "monaco-editor/editor/editor.api";
import {
	type RuntimeAssetEditorCatalog,
	type RuntimeAssetEditorEntry,
	runtimeAssetCatalogFor,
	runtimeAssetDetail,
} from "./catalog.ts";
import { runtimeAssetReferenceAt } from "./source.ts";

/**
 * Shows the image for a name written in code, and only for images RowCat holds.
 * - The lookup asks whether this draft's list contains the name. If so, it shows the name,
 *   thumbnail, dimensions, and format. If not, nothing is drawn; no fake preview is created.
 * - Creators' remote addresses are never opened here. Opening
 *   `asset("https://creator.example/a.png")` on hover would send a request to the creator's server
 *   just because the cursor passed over it. Playback routes such requests through RowCat's proxy so
 *   the creator never learns the player's IP; that protection must not leak out through the editor.
 * - So the list this layer sees holds only logical names (`collectRuntimeAssetReferences` drops
 *   remote ones), and the only material for the address is the media identity.
 * - A name that does not resolve stays silent. Assets not yet uploaded, or a path caught
 *   mid-rename, are normal states during authoring. A broken image or a 'missing' badge would
 *   report an error that does not exist. At runtime such a name is a placeholder, not an exception
 *   (§38).
 */

/**
 * The thumbnail box. Keeps a 4000×4000 image from growing the hover to the size of the screen.
 *
 * CSS is not written here, because Monaco already has the syntax
 * (`![alt](address|width=…,height=…)`). Global styles would also shrink hover images in any other
 * Monaco consumer the app gains later.
 */
const THUMBNAIL = { width: 220, height: 160 } as const;

/**
 * Fits the box while keeping the aspect ratio. Never enlarges.
 *
 * Writing both axes as box values (`width=220 height=160`) would squash a tall image, and writing
 * only one axis would let the other exceed the box. The dimensions are known, so computing once
 * here is correct.
 */
export function runtimeAssetThumbnailBox(
	width: number,
	height: number,
): { width: number; height: number } | null {
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width <= 0 || height <= 0) return null;
	const scale = Math.min(1, THUMBNAIL.width / width, THUMBNAIL.height / height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * Whether the address can go into a markdown link as-is.
 *
 * `|` is read by Monaco as size syntax, and parentheses or spaces break link syntax. When such an
 * address appears, the response is to drop the image, not to invent an escape. Our media addresses
 * never take this shape, so a value that fails here signals that the rule has changed.
 */
const MARKDOWN_SAFE_URL = /^[^\s()|<>[\]]+$/;

export interface RuntimeAssetHoverContent {
	/** The creator's vocabulary. The title on screen is always this name. */
	path: string;
	/** `640 × 640 · WebP`. */
	detail: string;
	/**
	 * Thumbnail. `null` means text only, which happens when the dimensions are damaged or no address
	 * can be built.
	 *
	 * The media identity lives only inside this address; the string is never written on screen.
	 */
	image: { url: string; width: number; height: number } | null;
	/** Range to highlight, inside the quotes. */
	start: number;
	end: number;
}

export function runtimeAssetHoverContent(
	entry: RuntimeAssetEditorEntry,
	mediaUrl: (mediaId: string) => string,
	range: { start: number; end: number },
): RuntimeAssetHoverContent {
	const url = mediaUrl(entry.mediaId);
	/**
	 * Sound has no thumbnail, so nothing is drawn.
	 *
	 * The slot is not filled with an audio tag, because the hover is a surface that is read. If merely
	 * brushing the mouse over a name started playback, that would be playback the creator never asked
	 * for, and this layer would own its lifecycle: where it stops, and what happens when the cursor
	 * moves to another name. Sound is played from the asset list instead.
	 */
	const box =
		entry.kind === "image"
			? runtimeAssetThumbnailBox(entry.width ?? 0, entry.height ?? 0)
			: null;
	return {
		path: entry.path,
		detail: runtimeAssetDetail(entry),
		image:
			url.length > 0 && MARKDOWN_SAFE_URL.test(url) && box !== null
				? { url, ...box }
				: null,
		start: range.start,
		end: range.end,
	};
}

/** What is under the cursor. Returns `null` unless the name is a bound logical name. */
export function planRuntimeAssetHover(
	catalog: RuntimeAssetEditorCatalog,
	source: string,
	offset: number,
): RuntimeAssetHoverContent | null {
	const reference = runtimeAssetReferenceAt(source, offset);
	if (reference === null) return null;
	const entry = catalog.byPath.get(reference.path);
	if (entry === undefined) return null;
	return runtimeAssetHoverContent(entry, catalog.mediaUrl, reference);
}

/**
 * Markdown for the hover, with no command links and no raw HTML.
 *
 * `isTrusted` is not set, so only text and images can be produced here, which is enough. The name
 * is wrapped in a code span because the value is a string written in code, not a sentence.
 */
export function runtimeAssetHoverMarkdown(
	content: RuntimeAssetHoverContent,
): string {
	const lines = [`\`${content.path}\``];
	if (content.image !== null)
		lines.push(
			`![${content.path}](${content.image.url}|width=${content.image.width},height=${content.image.height})`,
		);
	if (content.detail.length > 0) lines.push(content.detail);
	return lines.join("\n\n");
}

export function createRuntimeAssetHoverProvider(): monaco.languages.HoverProvider {
	return {
		provideHover(model, position) {
			const catalog = runtimeAssetCatalogFor(model);
			if (catalog === null) return null;

			const content = planRuntimeAssetHover(
				catalog,
				model.getValue(),
				model.getOffsetAt(position),
			);
			if (content === null) return null;

			const from = model.getPositionAt(content.start);
			const to = model.getPositionAt(content.end);
			return {
				range: {
					startLineNumber: from.lineNumber,
					startColumn: from.column,
					endLineNumber: to.lineNumber,
					endColumn: to.column,
				},
				/**
				 * Records `isTrusted: false`. That is the default, but this is the only place where a
				 * creator-written value becomes markdown, so the choice should be visible in the source.
				 */
				contents: [
					{ value: runtimeAssetHoverMarkdown(content), isTrusted: false },
				],
			};
		},
	};
}
