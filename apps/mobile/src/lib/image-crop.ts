import type { AvatarCropRect } from "@rowcat/domain";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

/**
 * The boundary that turns the chosen rectangle into real bytes. The only place that knows
 * `expo-image-manipulator`.
 *
 * Same judgement as the picker boundary (`image-picker.ts`). If the screen held the manipulator's
 * types, its shape would spread through the feature folder, and cropping would have a second place
 * to happen. What leaves here is one value in the shape the SDK takes (`Blob`).
 *
 * ## What is cropped is not decided here
 *
 * The rectangle comes from the pure geometry in `@rowcat/domain` (`avatarCropRect`), because the
 * web's same screen draws with a completely different manipulator and must produce the same
 * rectangle. This file only moves those coordinates into the manipulator's coordinate system.
 *
 * ## Why coordinates are moved — the easiest place to get this wrong
 *
 * The screen computed geometry using the size the picker reported, and the image the manipulator
 * actually opens can differ in size (iOS points vs. pixels, or a re-encoded copy from the picker).
 * Passing the coordinates through unchanged crops the wrong region, and the symptom appears only to
 * the person who uploaded that photo. So we first open the image to read the size the manipulator
 * sees, scale the rectangle into that, and clamp it inside.
 *
 * ## Saved as JPEG
 *
 * `SaveFormat.WEBP` exists in the enum, but platform support varies. What is needed here is one
 * format that every platform produces and the server accepts. The cropped result is already much
 * smaller than the original, so there is no reason to save more bytes with the format.
 */

/** Compression quality. The crop is already small, so there is no reason to reduce fidelity further. */
const QUALITY = 0.92;

/** The source to crop, with only the axes this app knows. */
export interface CropSourceImage {
	uri: string;
	width: number;
	height: number;
}

/**
 * The cropped result, with the bytes **and an address for those bytes**.
 *
 * This differs from the web. A browser can build a preview from a `Blob` alone (an object URL), but
 * RN's `Image` takes only an address. If the screen previewed the original address, the picture
 * being uploaded and the picture shown would differ, and that difference would appear only after
 * the server answered.
 */
export interface CroppedImage {
	blob: Blob;
	uri: string;
}

/**
 * Image size, asked **only when the picker did not report it**.
 *
 * The picker's reported size is preferred because it matches what `<Image>` draws. `Image.getSize`
 * answers in the same coordinate system (with EXIF orientation applied). Any difference from the
 * size the manipulator opens is folded in by ratio just before cropping (`mapRectInto`).
 */
export function measureImage(
	uri: string,
): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		Image.getSize(
			uri,
			(width, height) => resolve({ width, height }),
			(error) => reject(error),
		);
	});
}

const clamp = (value: number, low: number, high: number): number =>
	Math.min(high, Math.max(low, value));

/**
 * Chosen rectangle → bytes to upload.
 *
 * `outputEdge` is passed in because the geometry decides that value too (`avatarCropOutputEdge`).
 * Writing 512 here by hand would upscale every cropped upload, and only those, the day the server's
 * stored edge goes up.
 */
export async function cropImageToSquare(
	source: CropSourceImage,
	rect: AvatarCropRect,
	outputEdge: number,
): Promise<CroppedImage> {
	// Decode once. The reference returned here is the source for the second manipulation context, so
	// the large photo is not opened twice just to check its size.
	const opened = await ImageManipulator.manipulate(source.uri).renderAsync();
	const mapped = mapRectInto(rect, source, opened);

	const cropped = await ImageManipulator.manipulate(opened)
		.crop(mapped)
		.resize({ width: outputEdge, height: outputEdge })
		.renderAsync();
	const saved = await cropped.saveAsync({
		format: SaveFormat.JPEG,
		compress: QUALITY,
	});

	// Converting a local file to a Blob is one `fetch` in RN. This `fetch` reads this device's file,
	// not the network. It lives in lib for the same reason as in `image-picker.ts`.
	const response = await fetch(saved.uri);
	const blob = await response.blob();
	// We know the format. The SDK sends it as `Content-Type`, and RN's file `fetch` may set a
	// platform-dependent or empty type. The server judges by bytes anyway, but there is no reason to
	// discard what we know.
	return {
		blob:
			blob.type === "image/jpeg"
				? blob
				: blob.slice(0, blob.size, "image/jpeg"),
		uri: saved.uri,
	};
}

/**
 * Moves a rectangle from the screen's coordinate system into the one the manipulator opens.
 *
 * When the two sizes match (the common case), nothing happens. When they differ, scale by ratio and
 * **always clamp inside**: a single rounding step pushing one pixel outside makes the manipulator
 * fail entirely.
 */
function mapRectInto(
	rect: AvatarCropRect,
	source: { width: number; height: number },
	actual: { width: number; height: number },
): { originX: number; originY: number; width: number; height: number } {
	const ratioX = source.width > 0 ? actual.width / source.width : 1;
	const ratioY = source.height > 0 ? actual.height / source.height : 1;
	// Keep the square, so use **one** scale. If the two axes were scaled differently (should not
	// happen, but we cannot check), taking the smaller one keeps the rectangle inside the image.
	const ratio = Math.min(ratioX, ratioY);
	const edge = clamp(
		Math.round(rect.width * ratio),
		1,
		Math.min(actual.width, actual.height),
	);
	return {
		originX: clamp(Math.round(rect.x * ratio), 0, actual.width - edge),
		originY: clamp(Math.round(rect.y * ratio), 0, actual.height - edge),
		width: edge,
		height: edge,
	};
}
