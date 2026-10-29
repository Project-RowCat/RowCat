import { describe, expect, it } from "vitest";
import {
	AVATAR_CROP_MAX_ZOOM,
	AVATAR_CROP_SOURCE_HEADROOM,
	avatarCropMaxZoom,
	avatarCropOutputEdge,
	avatarCropPanScale,
	avatarCropRect,
	clampAvatarCropView,
	initialAvatarCropView,
	isAvatarCroppable,
} from "./avatar-crop.ts";

/**
 * Geometry of profile-photo cropping. The test guards that the web and mobile apps produce the same
 * crop rectangle. Input and drawing differ per platform, but these functions decide the rectangle.
 * If they diverge, the symptom is 'cropped differently per device', which is not reproducible.
 * - Confirming without changes must match the server's center crop.
 * - The rectangle must never leave the source; a single rounded pixel can make the manipulator
 *   fail.
 * - The zoom ceiling is set by the floor: zooming past it leaves a piece the server always
 *   rejects.
 */

/** Contract value. This package does not import the contract, so tests pass in the real numbers. */
const MIN_EDGE = 64;
const STORED_EDGE = 512;

const landscape = { width: 4000, height: 3000 };
const portrait = { width: 1080, height: 1920 };
const square = { width: 800, height: 800 };

describe("can it be cropped", () => {
	it("croppable when the short side meets the floor", () => {
		expect(isAvatarCroppable(landscape, MIN_EDGE)).toBe(true);
		expect(isAvatarCroppable({ width: 4000, height: 64 }, MIN_EDGE)).toBe(true);
	});

	it("a strip-like image cannot be cropped", () => {
		expect(isAvatarCroppable({ width: 4000, height: 63 }, MIN_EDGE)).toBe(
			false,
		);
	});
});

describe("on first open", () => {
	/**
	 * This test is the slice's compatibility promise: the rectangle must match the server's former
	 * center crop, so a user who confirms without touching anything gets the same result as before
	 * cropping existed.
	 */
	it("the largest centered square, the same as the server's center crop", () => {
		expect(
			avatarCropRect(initialAvatarCropView(landscape), landscape, MIN_EDGE),
		).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
		expect(
			avatarCropRect(initialAvatarCropView(portrait), portrait, MIN_EDGE),
		).toEqual({ x: 0, y: 420, width: 1080, height: 1080 });
		expect(
			avatarCropRect(initialAvatarCropView(square), square, MIN_EDGE),
		).toEqual({ x: 0, y: 0, width: 800, height: 800 });
	});
});

describe("zoom cap", () => {
	it("a large photo hits the fixed cap", () => {
		expect(avatarCropMaxZoom(landscape, MIN_EDGE)).toBe(AVATAR_CROP_MAX_ZOOM);
	});

	it("for a small photo the floor sets the cap", () => {
		/** Short edge 256px; zooming to the 64px minimum allows 4x. */
		expect(avatarCropMaxZoom({ width: 400, height: 256 }, MIN_EDGE)).toBe(4);
	});

	it("never below 1 even for an image smaller than the floor", () => {
		expect(avatarCropMaxZoom({ width: 40, height: 32 }, MIN_EDGE)).toBe(1);
	});

	/**
	 * Even at maximum zoom the remaining piece must be at least the minimum, or the server would
	 * always reject a gesture the screen allows.
	 */
	it("zooming to the cap still leaves a size the server accepts", () => {
		for (const source of [
			landscape,
			portrait,
			square,
			{ width: 400, height: 256 },
		]) {
			const zoom = avatarCropMaxZoom(source, MIN_EDGE);
			const rect = avatarCropRect(
				{ zoom, centerX: source.width / 2, centerY: source.height / 2 },
				source,
				MIN_EDGE,
			);
			expect(rect.width).toBeGreaterThanOrEqual(MIN_EDGE);
		}
	});
});

describe("the rectangle stays within the original", () => {
	/**
	 * Feeds in every extreme value a gesture can produce. One pixel outside the source can cause a
	 * black band or a failure (see `avatarCropRect`).
	 */
	it("no input leaves the original", () => {
		for (const source of [
			landscape,
			portrait,
			square,
			{ width: 999, height: 501 },
		])
			for (const zoom of [
				-3,
				0,
				0.5,
				1,
				1.37,
				3,
				8,
				40,
				Number.NaN,
				Number.POSITIVE_INFINITY,
			])
				for (const centerX of [
					-1000,
					0,
					1,
					source.width / 3,
					source.width,
					1e9,
				])
					for (const centerY of [
						-1000,
						0,
						source.height / 7,
						source.height,
						1e9,
					]) {
						const rect = avatarCropRect(
							{ zoom, centerX, centerY },
							source,
							MIN_EDGE,
						);
						expect(Number.isInteger(rect.x)).toBe(true);
						expect(Number.isInteger(rect.y)).toBe(true);
						expect(Number.isInteger(rect.width)).toBe(true);
						expect(rect.width).toBe(rect.height);
						expect(rect.width).toBeGreaterThan(0);
						expect(rect.x).toBeGreaterThanOrEqual(0);
						expect(rect.y).toBeGreaterThanOrEqual(0);
						expect(rect.x + rect.width).toBeLessThanOrEqual(source.width);
						expect(rect.y + rect.height).toBeLessThanOrEqual(source.height);
					}
	});

	/** Zoom cannot go below 1: outside the short edge there is nothing to crop. */
	it("zooming out stops at the short side", () => {
		expect(
			clampAvatarCropView(
				{ zoom: 0.2, centerX: 0, centerY: 0 },
				landscape,
				MIN_EDGE,
			).zoom,
		).toBe(1);
	});
});

describe("folds the zoom first, then the center", () => {
	it("when an over-cap zoom folds, the center follows the new margin", () => {
		const view = clampAvatarCropView(
			{ zoom: 999, centerX: 0, centerY: 0 },
			square,
			MIN_EDGE,
		);
		const half = 800 / view.zoom / 2;
		expect(view.zoom).toBe(AVATAR_CROP_MAX_ZOOM);
		expect(view.centerX).toBe(half);
		expect(view.centerY).toBe(half);
	});
});

describe("output size", () => {
	it("a large rectangle stops at a multiple of the stored size", () => {
		expect(
			avatarCropOutputEdge(
				{ x: 0, y: 0, width: 3000, height: 3000 },
				STORED_EDGE,
			),
		).toBe(STORED_EDGE * AVATAR_CROP_SOURCE_HEADROOM);
	});

	it("a small rectangle is sent as is", () => {
		expect(
			avatarCropOutputEdge(
				{ x: 0, y: 0, width: 300, height: 300 },
				STORED_EDGE,
			),
		).toBe(300);
	});

	it("derives from the stored size", () => {
		expect(
			avatarCropOutputEdge({ x: 0, y: 0, width: 9000, height: 9000 }, 1024),
		).toBe(1024 * AVATAR_CROP_SOURCE_HEADROOM);
	});
});

describe("converting finger movement", () => {
	it("the more zoom, the less the original pixels move", () => {
		const wide = avatarCropPanScale(
			{ zoom: 1, centerX: 0, centerY: 0 },
			landscape,
			300,
		);
		const tight = avatarCropPanScale(
			{ zoom: 4, centerX: 0, centerY: 0 },
			landscape,
			300,
		);
		expect(wide).toBe(3000 / 300);
		expect(tight).toBe(wide / 4);
	});

	/**
	 * Answers even before the screen is measured (0), which is the value the first render actually
	 * receives.
	 */
	it("0 when the screen size is unknown", () => {
		expect(
			avatarCropPanScale({ zoom: 1, centerX: 0, centerY: 0 }, landscape, 0),
		).toBe(0);
	});
});
