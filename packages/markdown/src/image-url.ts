import { STORY_COVER_INPUT_MIME } from "@rowcat/contracts";
import { safeImageUrl } from "./url-policy.ts";

/**
 * Whether a bare URL may be promoted to an image. Explicit `![]()` never goes through this.
 *
 * The extension list derives from the contract's accepted formats so the "no SVG" decision lives in
 * one place. Extensions are a claim, not a fact; a URL that turns out not to be an image is handled
 * by the renderer's load failure, never by fetching here.
 */

/** Must cover every contract MIME (a test checks it). */
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
	"image/jpeg": ["jpg", "jpeg"],
	"image/png": ["png"],
	"image/webp": ["webp"],
	"image/gif": ["gif"],
};

export const MARKDOWN_IMAGE_EXTENSIONS: readonly string[] =
	STORY_COVER_INPUT_MIME.flatMap((mime) => MIME_EXTENSIONS[mime] ?? []);

/** Refused even in explicit image syntax — the repository does not accept SVG (`contracts/media.ts`). */
export const REFUSED_IMAGE_EXTENSIONS = ["svg", "svgz"] as const;

export function imageExtensionOf(url: string): string | null {
	const path = url.split(/[?#]/, 1)[0] ?? "";
	const segment = path.slice(path.lastIndexOf("/") + 1);
	const dot = segment.lastIndexOf(".");
	if (dot <= 0 || dot === segment.length - 1) return null;
	return segment.slice(dot + 1).toLowerCase();
}

export function looksLikeImageUrl(url: string): boolean {
	const safe = safeImageUrl(url);
	if (!safe) return false;
	const extension = imageExtensionOf(safe);
	return extension !== null && MARKDOWN_IMAGE_EXTENSIONS.includes(extension);
}

export function isRefusedImageUrl(url: string): boolean {
	const extension = imageExtensionOf(url);
	return (
		extension !== null &&
		(REFUSED_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
	);
}
