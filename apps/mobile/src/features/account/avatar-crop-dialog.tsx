import { AVATAR_LIMITS, AVATAR_STORED_EDGE } from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	type AvatarCropView,
	avatarCropOutputEdge,
	avatarCropPanScale,
	avatarCropRect,
	clampAvatarCropView,
	initialAvatarCropView,
	isAvatarCroppable,
} from "@rowcat/domain";
import {
	Button,
	Dialog,
	DialogActions,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import {
	Image,
	PanResponder,
	type PanResponderInstance,
	StyleSheet,
	View,
} from "react-native";
import {
	type CroppedImage,
	type CropSourceImage,
	cropImageToSquare,
} from "../../lib/image-crop.ts";
import {
	AVATAR_CROP_FAILED,
	AVATAR_CROP_HINT,
	AVATAR_CROP_SUBMIT,
	AVATAR_CROP_SUBMITTING,
	AVATAR_CROP_TITLE,
	AVATAR_CROP_TOO_SMALL,
	AVATAR_CROP_ZOOM_IN,
	AVATAR_CROP_ZOOM_OUT,
} from "./avatar-file.ts";

/**
 * Lets the user crop an over-limit photo before upload; native counterpart of web
 * `avatar-crop-dialog.tsx`.
 *
 * - Opens only when the photo exceeds the limit. It replaces the former rejection ("pick a
 *   smaller file"), which the user had no way to follow from inside this app; it is not an extra
 *   step for every picked photo.
 * - Confirming untouched gives the old result: the initial rectangle equals the server's centre
 *   crop (`initialAvatarCropView`). The only new thing is choosing where the crop lands.
 * - Geometry is shared with web, the gesture handler is not. `@rowcat/domain` decides what is
 *   cut; if the same drag cropped differently per device the only symptom would be "my face got cut
 *   off", and it would not reproduce. What remains here is moving a finger to that value.
 * - The container is `Dialog size="full"` with scrolling off: the crop surface takes its height
 *   from its parent, so a scrolling parent gives it unbounded height and it vanishes (see the
 *   `Dialog` `scroll` comment).
 * - Fingers are not the only path: two buttons stand beside pinch zoom. With pinch alone this
 *   becomes an unrecoverable centre crop for one-handed users and switch-control / VoiceOver users.
 */

/** Minimum source pixels; read from the contract rather than re-written here. */
const MIN_EDGE = AVATAR_LIMITS.minDimension;

/** Zoom factor per button press: coarser than a finger but reachable anywhere. */
const ZOOM_STEP = 1.25;

/** Scale of the shade outside the circle; must exceed 1 to reach the corners of the square viewport. */
const SHADE_SCALE = 3;

/** Same value as the web layer (`opacity-70`): cover, but keep what is cropped away visible. */
const SHADE_OPACITY = 0.7;

type Gesture = { lastX: number; lastY: number; lastDistance: number };

export function AvatarCropDialog({
	source,
	onCancel,
	onConfirm,
}: {
	source: CropSourceImage;
	onCancel: () => void;
	/**
	 * The cropped result. Uploading and failure copy belong to the caller (the photo field). Bytes and
	 * address are given together for the preview: RN `Image` takes only an address, and previewing the
	 * original would show a picture different from the one uploaded.
	 */
	onConfirm: (image: CroppedImage) => void;
}) {
	const { colors } = useTheme();
	const croppable = isAvatarCroppable(source, MIN_EDGE);
	const [view, setView] = useState<AvatarCropView>(() =>
		initialAvatarCropView(source),
	);
	/** Side of the crop surface in dp. 0 before measuring, when fingers move nothing. */
	const [edge, setEdge] = useState(0);
	const [rendering, setRendering] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * Values that live only during gestures. As state they would re-render this dialog on every finger
	 * move, and `PanResponder` is created once so its closures go stale; hence all updates are
	 * functional and the handler reads refs.
	 */
	const gesture = useRef<Gesture>({ lastX: 0, lastY: 0, lastDistance: 0 });
	const edgeRef = useRef(0);
	/**
	 * Whether a crop is being produced; a synchronous copy. The button's `busy` applies from the next
	 * render, so state alone does not stop a double press in the same tick (same axis as `pickingRef`
	 * in `avatar-field.tsx`).
	 */
	const renderingRef = useRef(false);

	const move = (dx: number, dy: number) => {
		setView((current) => {
			const scale = avatarCropPanScale(current, source, edgeRef.current);
			return clampAvatarCropView(
				{
					...current,
					centerX: current.centerX - dx * scale,
					centerY: current.centerY - dy * scale,
				},
				source,
				MIN_EDGE,
			);
		});
	};

	const zoomBy = (factor: number) => {
		setView((current) =>
			clampAvatarCropView(
				{ ...current, zoom: current.zoom * factor },
				source,
				MIN_EDGE,
			),
		);
	};

	/**
	 * Create the responder once. `useRef(PanResponder.create(...))` evaluates the argument every
	 * render and leaves discarded objects holding stale closures, making the next reader work out
	 * which one actually runs.
	 */
	const responderRef = useRef<PanResponderInstance | null>(null);
	if (!responderRef.current)
		responderRef.current = PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderGrant: () => {
				gesture.current = { lastX: 0, lastY: 0, lastDistance: 0 };
			},
			onPanResponderMove: (event, state) => {
				const touches = event.nativeEvent.touches;
				const [first, second] = touches;
				if (touches.length >= 2 && first && second) {
					const distance = Math.hypot(
						first.pageX - second.pageX,
						first.pageY - second.pageY,
					);
					if (gesture.current.lastDistance > 0 && distance > 0)
						zoomBy(distance / gesture.current.lastDistance);
					gesture.current.lastDistance = distance;
					/**
					 * While zooming, also move the drag anchor; otherwise releasing one finger applies the
					 * accumulated `dx` at once and the picture jumps.
					 */
					gesture.current.lastX = state.dx;
					gesture.current.lastY = state.dy;
					return;
				}
				gesture.current.lastDistance = 0;
				move(
					state.dx - gesture.current.lastX,
					state.dy - gesture.current.lastY,
				);
				gesture.current.lastX = state.dx;
				gesture.current.lastY = state.dy;
			},
		});
	const responder = responderRef.current;

	/**
	 * Builds the crop and hands it to the parent. The name matches the web counterpart: there
	 * `confirm(` reads as asking a destructive action through the browser's native dialog and trips a
	 * static scan, which this app lacks; the same name just spares someone comparing the two screens
	 * from hunting for the reason they differ.
	 */
	const applyCrop = async () => {
		if (renderingRef.current) return;
		renderingRef.current = true;
		setRendering(true);
		setError(null);
		try {
			const rect = avatarCropRect(view, source, MIN_EDGE);
			onConfirm(
				await cropImageToSquare(
					source,
					rect,
					avatarCropOutputEdge(rect, AVATAR_STORED_EDGE),
				),
			);
		} catch {
			setError(AVATAR_CROP_FAILED);
		} finally {
			renderingRef.current = false;
			setRendering(false);
		}
	};

	return (
		<Dialog
			title={AVATAR_CROP_TITLE}
			description={croppable ? AVATAR_CROP_HINT : undefined}
			open
			size="full"
			/** The crop surface takes its height from its parent; if scrolled it collapses to height 0. */
			scroll={false}
			onOpenChange={(open) => {
				if (!open && !rendering) onCancel();
			}}
		>
			<View style={crop.body}>
				{croppable ? (
					<>
						<View
							style={[crop.viewport, { backgroundColor: colors.muted }]}
							onLayout={(event) => {
								const width = event.nativeEvent.layout.width;
								edgeRef.current = width;
								setEdge(width);
							}}
							{...responder.panHandlers}
						>
							{edge > 0 ? (
								<CropSurface
									source={source}
									view={view}
									edge={edge}
									shade={colors.background}
								/>
							) : null}
						</View>

						<View style={crop.zoom}>
							<Button
								label={AVATAR_CROP_ZOOM_OUT}
								variant="outline"
								size="sm"
								disabled={rendering}
								onPress={() => zoomBy(1 / ZOOM_STEP)}
							/>
							<Button
								label={AVATAR_CROP_ZOOM_IN}
								variant="outline"
								size="sm"
								disabled={rendering}
								onPress={() => zoomBy(ZOOM_STEP)}
							/>
						</View>

						{error ? (
							<Text
								accessibilityRole="alert"
								variant="label"
								tone="destructive"
							>
								{error}
							</Text>
						) : null}
					</>
				) : (
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{AVATAR_CROP_TOO_SMALL}
					</Text>
				)}

				<DialogActions>
					<Button
						label="Cancel"
						variant="outline"
						size="sm"
						disabled={rendering}
						onPress={onCancel}
					/>
					{/* Not drawn for a picture that cannot be cropped: a disabled button reads as "usable later",
					    but this photo never will be; the user should pick another photo, not wait (same as
					    web). */}
					{croppable ? (
						<Button
							label={rendering ? AVATAR_CROP_SUBMITTING : AVATAR_CROP_SUBMIT}
							size="sm"
							busy={rendering}
							onPress={() => void applyCrop()}
						/>
					) : null}
				</DialogActions>
			</View>
		</Dialog>
	);
}

/**
 * Draws the chosen rectangle: derived from geometry, never decided here. Computing the drawn value
 * separately from gesture state could diverge from what is actually cropped, visible only after
 * confirming. So the rectangle `avatarCropRect` answered is placed as-is (same rule as the web
 * component).
 */
function CropSurface({
	source,
	view,
	edge,
	shade,
}: {
	source: CropSourceImage;
	view: AvatarCropView;
	edge: number;
	/**
	 * Colour covering outside the circle: the app background. Outside is "not the photo" rather than
	 * "darkened photo", and that meaning must draw in opposite directions in the two themes (web uses
	 * the same token). Colour literals are forbidden in this app anyway.
	 */
	shade: string;
}) {
	const rect = avatarCropRect(view, source, MIN_EDGE);
	/** dp per source pixel, so the visible surface exactly fills one side of the rectangle. */
	const factor = edge / rect.width;
	const ring = edge * SHADE_SCALE;
	/**
	 * Shade outside the circle. The inner radius is outer radius minus border width, so a width of
	 * `(3E - E) / 2 = E` punches out a circle of exactly diameter E. RN has no other way to punch
	 * through a shade, and four split elements would leave square corners.
	 */
	const border = (ring - edge) / 2;

	return (
		<>
			<Image
				source={{ uri: source.uri }}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					position: "absolute",
					width: source.width * factor,
					height: source.height * factor,
					left: -rect.x * factor,
					top: -rect.y * factor,
				}}
			/>
			<View
				pointerEvents="none"
				style={{
					position: "absolute",
					left: -border,
					top: -border,
					width: ring,
					height: ring,
					borderRadius: ring / 2,
					borderWidth: border,
					borderColor: shade,
					opacity: SHADE_OPACITY,
				}}
			/>
		</>
	);
}

const crop = StyleSheet.create({
	body: { gap: space.md },
	/**
	 * Square and clips overflow: the original is drawn far larger than this box, so without `hidden`
	 * the photo would cover the whole dialog.
	 */
	viewport: {
		aspectRatio: 1,
		borderRadius: space.sm,
		overflow: "hidden",
		width: "100%",
	},
	zoom: { flexDirection: "row", gap: space.sm, justifyContent: "center" },
});
