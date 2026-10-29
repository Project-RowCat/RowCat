/**
 * Crop-screen geometry for profile photos. Pure functions only.
 *
 * Both apps have a crop screen, drawn very differently (web uses pointer events and canvas, mobile
 * uses PanResponder and a native manipulator), but the cropped region must be identical. A
 * divergence would appear as 'my face got cut off' on some devices and be hard to reproduce. Device
 * input and drawing stay in the apps; this module holds the one value they share: which square of
 * the source is shown.
 *
 * All coordinates are source pixels. No CSS px, dp or viewport size enters, since that would make
 * the same gesture yield different rectangles per device density. The only screen-unit conversion
 * is `avatarCropPanScale`.
 *
 * `@rowcat/domain` imports nothing, so the source minimum and stored edge are passed in as
 * arguments; both apps read them from their contract. Files, bytes and canvas are not here:
 * producing the cropped image is platform work, and putting it here would make this package depend
 * on the browser or Expo.
 */

export interface AvatarCropSource {
	width: number;
	height: number;
}

/**
 * The chosen square, in source-pixel coordinates only. At zoom 1 its side is the source's short
 * edge; at zoom 2 half that, at zoom 4 a quarter. Enlarging the picture and shrinking the crop are
 * the same value, so there is one axis.
 */
export interface AvatarCropView {
	zoom: number;
	centerX: number;
	centerY: number;
}

/** Integer pixels, fully inside the source. */
export interface AvatarCropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Zoom ceiling, separate from the floor-derived limit. The floor alone would allow 62x for a 4000px
 * photo, where one millimetre of finger movement spans many source pixels, so the square cannot be
 * placed where wanted, and a 500x500 crop upscaled to 512 looks smeared. The smaller of the two
 * limits is used, because neither outcome is what a user wants.
 */
export const AVATAR_CROP_MAX_ZOOM = 8;

/**
 * How many times the stored edge to produce before sending. Sending exactly the stored size makes
 * the browser the final resampler and skips the server's normalization. At 2x, libvips does the
 * last downscale, which gives slightly better results, and a 1024 square stays a few hundred KB as
 * WebP or JPEG. Never upscales: a smaller crop is sent as-is (`avatarCropOutputEdge`).
 */
export const AVATAR_CROP_SOURCE_HEADROOM = 2;

const clamp = (value: number, low: number, high: number): number =>
	Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;

/** Short edge of the source: the crop square's side at zoom 1. */
const shortEdge = (source: AvatarCropSource): number =>
	Math.min(source.width, source.height);

/**
 * Whether the image can be cropped at all. If its short edge is under the minimum, the server
 * rejects every rectangle, so callers check this before opening the crop screen; the user could not
 * fix it.
 */
export function isAvatarCroppable(
	source: AvatarCropSource,
	minEdge: number,
): boolean {
	return shortEdge(source) >= minEdge;
}

/**
 * Zoom ceiling for this image: the smaller of the floor-derived limit and the fixed ceiling, never
 * below 1. It must answer even for an uncroppable image. Callers check `isAvatarCroppable` first,
 * but this does not rely on that order.
 */
export function avatarCropMaxZoom(
	source: AvatarCropSource,
	minEdge: number,
): number {
	const byMinimum = minEdge > 0 ? shortEdge(source) / minEdge : 1;
	return Math.max(1, Math.min(AVATAR_CROP_MAX_ZOOM, byMinimum));
}

/**
 * Initial view: the largest centered square, matching the server's former center crop.
 * `avatar-crop.test.ts` pins that equivalence.
 */
export function initialAvatarCropView(
	source: AvatarCropSource,
): AvatarCropView {
	return { zoom: 1, centerX: source.width / 2, centerY: source.height / 2 };
}

/**
 * Clamps a gesture's result back inside the source; dragging and zooming both pass through it. If
 * each gesture checked only its own limit, the symptom would be conditional (the rectangle leaves
 * the image only after heavy zoom). Zoom is clamped first, then the center to the margins that the
 * clamped zoom defines. The reverse order leaves the center on stale margins when zoom shrinks.
 */
export function clampAvatarCropView(
	view: AvatarCropView,
	source: AvatarCropSource,
	minEdge: number,
): AvatarCropView {
	const zoom = clamp(view.zoom, 1, avatarCropMaxZoom(source, minEdge));
	const half = shortEdge(source) / zoom / 2;
	return {
		zoom,
		centerX: clamp(view.centerX, half, source.width - half),
		centerY: clamp(view.centerY, half, source.height - half),
	};
}

/**
 * Converts the visible square into the rectangle to cut from the source. Integer folding is the
 * last step: canvas and the native manipulator round fractional pixels differently, which is where
 * the platforms would diverge. The rectangle is pushed back inside the source after folding for the
 * same reason, since one pixel outside causes a black band or a failure.
 */
export function avatarCropRect(
	view: AvatarCropView,
	source: AvatarCropSource,
	minEdge: number,
): AvatarCropRect {
	const clamped = clampAvatarCropView(view, source, minEdge);
	const edge = Math.max(
		1,
		Math.min(
			Math.round(shortEdge(source) / clamped.zoom),
			Math.floor(shortEdge(source)),
		),
	);
	return {
		x: clamp(Math.round(clamped.centerX - edge / 2), 0, source.width - edge),
		y: clamp(Math.round(clamped.centerY - edge / 2), 0, source.height - edge),
		width: edge,
		height: edge,
	};
}

/**
 * Pixel size to send the rectangle at: a multiple of the stored edge, capped. A smaller rectangle
 * is left as is, because enlarging only adds bytes. `storedEdge` is passed in because this package
 * does not know the contract; if the stored size rises, this result rises with it.
 */
export function avatarCropOutputEdge(
	rect: AvatarCropRect,
	storedEdge: number,
): number {
	return Math.max(
		1,
		Math.min(rect.width, Math.round(storedEdge * AVATAR_CROP_SOURCE_HEADROOM)),
	);
}

/**
 * Source pixels per screen unit of finger movement, and the only place this module meets screen
 * units. The visible square (`viewportEdge`) shows `edge` source pixels, so the conversion is that
 * ratio alone. The same movement moves less when zoomed in, which permits fine alignment.
 */
export function avatarCropPanScale(
	view: AvatarCropView,
	source: AvatarCropSource,
	viewportEdge: number,
): number {
	if (!(viewportEdge > 0)) return 0;
	const zoom = Math.max(1, Number.isFinite(view.zoom) ? view.zoom : 1);
	return shortEdge(source) / zoom / viewportEdge;
}
