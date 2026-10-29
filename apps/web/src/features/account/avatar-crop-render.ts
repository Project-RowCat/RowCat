import { AVATAR_STORED_EDGE, MEDIA_INPUT_MIME } from "@rowcat/contracts";
import { type AvatarCropRect, avatarCropOutputEdge } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Where the chosen rectangle becomes actual bytes: a browser-only job.
 *
 * The pure geometry in `@rowcat/domain` decides what gets cropped (`avatarCropRect`); this file
 * only draws that rectangle onto a canvas. They are not kept in one file because mobile uses the
 * same geometry with a **completely different manipulator**, and once the geometry knows about the
 * canvas that sharing breaks.
 *
 * ## This file is not a validation boundary
 *
 * The bytes produced here are decoded and judged again by the server. Passing the crop is no reason
 * to relax server validation, and a format outside the server's list is rejected, so the output
 * format is **checked against the contract's list** rather than guessed.
 *
 * ## We apply EXIF orientation ourselves
 *
 * Server normalization applies EXIF orientation to the **pixels before cropping**. If the browser
 * ignored that orientation while cropping, a portrait photo would be cut 90 degrees away from the
 * place the user chose, and only the person who uploaded it would see the mismatch.
 * `imageOrientation` on `createImageBitmap` is that one line. The result carries no EXIF, so the
 * server has nothing more to do.
 */

/**
 * Formats the canvas may produce, chosen **from the list the server accepts**.
 *
 * WebP comes first because it is much smaller at the same quality. JPEG is second because `toBlob`
 * **silently returns PNG** for a type it does not know, and a photo as PNG exceeds the limit and is
 * rejected. So the result's `type` is checked, and a candidate that does not match the request
 * moves on to the next one.
 */
const OUTPUT_MIME = ["image/webp", "image/jpeg"] as const;

/** A cropped image is already much smaller than the original, so there is no reason to compress further. */
const OUTPUT_QUALITY = 0.92;

/** The picture could not be read, or the canvas could not produce bytes. */
export class AvatarCropRenderError extends Error {}

/** The source to crop: its size and something the canvas can draw. */
export interface AvatarCropSourceImage {
	width: number;
	height: number;
	image: CanvasImageSource;
	/** Address the screen uses as a preview. Must be released when done. */
	previewUrl: string;
	release: () => void;
}

/**
 * Chosen file → something the canvas can draw.
 *
 * In browsers without `createImageBitmap` (or that cannot read this file) this falls back to
 * `<img>`. Both paths give orientation-applied pixels: `image-orientation: from-image` is already
 * the `<img>` default, so the canvas receives those pixels too.
 */
export async function decodeAvatarSource(
	file: Blob,
): Promise<AvatarCropSourceImage> {
	const previewUrl = URL.createObjectURL(file);
	const release = () => URL.revokeObjectURL(previewUrl);

	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file, {
				imageOrientation: "from-image",
			});
			return {
				width: bitmap.width,
				height: bitmap.height,
				image: bitmap,
				previewUrl,
				release: () => {
					bitmap.close();
					release();
				},
			};
		} catch {
			/** Fall through to the fallback. Throwing here would remove the fallback path. */
		}
	}

	try {
		const element = await loadImageElement(previewUrl);
		return {
			width: element.naturalWidth,
			height: element.naturalHeight,
			image: element,
			previewUrl,
			release,
		};
	} catch (error) {
		release();
		throw error;
	}
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const element = new Image();
		element.onload = () => {
			/** Some paths "succeed" with 0×0, and nothing can be drawn from that picture. */
			if (element.naturalWidth > 0 && element.naturalHeight > 0)
				resolve(element);
			else
				reject(
					new AvatarCropRenderError(
						translator("account")("avatarCropRender.emptyImage"),
					),
				);
		};
		element.onerror = () =>
			reject(
				new AvatarCropRenderError(
					translator("account")("avatarCropRender.decodeFailed"),
				),
			);
		element.src = url;
	});
}

/**
 * Cropped rectangle → bytes to upload.
 *
 * The output size comes from the geometry (`avatarCropOutputEdge`): the stored edge is the ceiling,
 * and nothing is upscaled. Downscaling happens in the browser, and the server's libvips normalizes
 * the final output, so the only job here is to avoid losing quality (`imageSmoothingQuality`).
 */
export async function renderAvatarCrop(
	source: AvatarCropSourceImage,
	rect: AvatarCropRect,
): Promise<Blob> {
	const edge = avatarCropOutputEdge(rect, AVATAR_STORED_EDGE);
	const canvas = document.createElement("canvas");
	canvas.width = edge;
	canvas.height = edge;

	const context = canvas.getContext("2d");
	if (!context)
		throw new AvatarCropRenderError(
			translator("account")("avatarCropRender.couldNotOpenTheCanvas"),
		);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(
		source.image,
		rect.x,
		rect.y,
		rect.width,
		rect.height,
		0,
		0,
		edge,
		edge,
	);

	for (const mime of OUTPUT_MIME) {
		const blob = await toBlob(canvas, mime);
		/**
		 * **Check that the requested format came back.** `toBlob` returns PNG instead of an error for an
		 * unknown format, and a photo as PNG exceeds the limit and is rejected by the server. That
		 * failure would arrive after the user has just finished cropping.
		 */
		if (
			blob &&
			MEDIA_INPUT_MIME.includes(blob.type as never) &&
			blob.type === mime
		)
			return blob;
	}
	throw new AvatarCropRenderError(
		translator("account")("avatarCropRender.couldNotCreateTheImage"),
	);
}

function toBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), mime, OUTPUT_QUALITY);
	});
}
