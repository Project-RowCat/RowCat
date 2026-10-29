import { launchImageLibraryAsync } from "expo-image-picker";

/**
 * The boundary that picks one image from the device library. The only place that knows
 * `expo-image-picker`.
 *
 * If the screen held the picker library's types directly, the asset object's shape would spread
 * through the feature folder, and every screen would need changing when the library changes. Only
 * the axes this app actually reads are copied here. That there are four is itself the statement of
 * what the validation judges on (the same judgement as `ViewerQuerySnapshot` in
 * `session-state.ts`).
 *
 * ## Cancelling is not a failure
 *
 * Closing without choosing is normal use, so it folds to `null`. Making it an error would show
 * "failed" on screen, and the person would doubt their device.
 *
 * ## Unknown values are not invented
 *
 * Some platforms and paths really do omit `fileSize` or `mimeType`. Then this module returns
 * `null`, and the pre-check (`features/account/avatar-file.ts`) does not block on the unknown axis.
 * The server, which decodes the bytes, has the final say.
 *
 * ## No camera
 *
 * This boundary opens the library only. Capture brings camera permission and its denial screen, a
 * separate decision that one profile photo does not need. Library selection goes through the system
 * picker (PHPicker/Photo Picker), which needs no separate permission.
 *
 * ## Why `fetch(uri)` lives here
 *
 * What is sent to the server is a `Blob` (`client.me.uploadAvatar`), and converting a local file to
 * a Blob in RN is one `fetch`. Feature code cannot call `fetch` (a static scan blocks it, because
 * path rules and sessions would scatter; `lib/boundaries.test.ts`), so this conversion belongs to
 * lib. This `fetch` reads **this device's file**, not the network.
 */

/** A picked image, with only the axes this app reads. */
export interface PickedImage {
	uri: string;
	/** Format reported by the picker. `null` if unknown; never folded into an empty string. */
	mimeType: string | null;
	/** Byte count. `null` if unknown; 0 would mean "empty file", a different fact. */
	byteSize: number | null;
	width: number | null;
	height: number | null;
}

/**
 * Picks one image from the library. Returns `null` on cancel.
 *
 * `allowsEditing` (the platform crop UI) stays off. Square cropping for avatars belongs to server
 * normalization (see `AVATAR_LIMITS`), and a platform editor would upload different bytes for the
 * same file on each device.
 */
export async function pickImageFromLibrary(): Promise<PickedImage | null> {
	const result = await launchImageLibraryAsync({
		mediaTypes: ["images"],
		allowsMultipleSelection: false,
		// Original quality. Compression belongs to server normalization (re-encoding to WebP).
		quality: 1,
		// Location and device metadata are not read at all. The server keeps only ICC and drops the rest.
		exif: false,
	});
	if (result.canceled) return null;

	const asset = result.assets[0];
	if (!asset) return null;

	return {
		uri: asset.uri,
		mimeType: asset.mimeType ?? null,
		byteSize: asset.fileSize ?? null,
		width: asset.width ?? null,
		height: asset.height ?? null,
	};
}

/**
 * The bytes of the picked image, as a Blob for the SDK.
 *
 * The Blob's `type` is overridden with the format the picker reported. RN's file `fetch` sets a
 * type that varies by platform and can be empty, and the SDK sends that value as `Content-Type`.
 * The server judges by bytes anyway, so this is advisory, but there is no reason to discard what we
 * know.
 */
export async function readPickedImage(picked: PickedImage): Promise<Blob> {
	const response = await fetch(picked.uri);
	const blob = await response.blob();
	if (picked.mimeType && blob.type !== picked.mimeType)
		return blob.slice(0, blob.size, picked.mimeType);
	return blob;
}
