import { AVATAR_LIMITS } from "@rowcat/contracts";
import {
	type AvatarCropSource,
	type AvatarCropView,
	avatarCropMaxZoom,
	avatarCropPanScale,
	avatarCropRect,
	clampAvatarCropView,
	initialAvatarCropView,
	isAvatarCroppable,
} from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Slider } from "@rowcat/ui-web/components/slider";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	type AvatarCropSourceImage,
	decodeAvatarSource,
	renderAvatarCrop,
} from "./avatar-crop-render.ts";
import {
	avatarCropFailed,
	avatarCropPanLabel,
	avatarCropTooSmall,
} from "./avatar-file.ts";

/**
 * Crops a photo that exceeds the size limit **directly** and then uploads the result.
 *
 * ## The dialog opens only when the limit is exceeded
 *
 * Not every chosen photo gets an extra confirmation step. Photos within the limit still upload
 * straight away on `Upload photo`; making that two steps would be a cost this slice never asked for. What
 * this dialog replaces is **the rejection**: before, "choose a smaller file" was the end, and the
 * only way to follow that advice was outside this app.
 *
 * ## An untouched confirmation gives the same result as before
 *
 * The rectangle that opens first is the **same center crop the server used to do**
 * (`initialAvatarCropView`). So the only thing this dialog changes is "you can choose where to
 * crop"; for someone who does not choose, nothing changes.
 *
 * ## The geometry is not this file's
 *
 * `@rowcat/domain` decides what gets cropped, because the mobile version of this screen draws with
 * a **completely different manipulator** and must produce the same rectangle. What remains here is
 * moving pointer, wheel and keyboard input into those values, and calling the canvas.
 *
 * ## Server validation does not loosen by a character
 *
 * The bytes produced here are decoded and judged again by the server. Having passed the crop is not
 * grounds to skip any check.
 */

/** Minimum source edge in pixels, taken from the contract rather than restated here. */
const MIN_EDGE = AVATAR_LIMITS.minDimension;

/** Zoom slider step. Zoom is continuous, so the steps are fine. */
const ZOOM_STEP = 0.01;

/** Screen distance (px) that one arrow key press moves: slower than a finger, but precise. */
const KEY_PAN = 12;

/** Zoom factor for one wheel notch. Applied exponentially so zoom in and out are symmetric. */
const WHEEL_ZOOM = 0.0015;

type Stage =
	| { kind: "decoding" }
	| { kind: "failed"; message: string }
	| { kind: "ready"; source: AvatarCropSourceImage };

export function AvatarCropDialog({
	file,
	onCancel,
	onConfirm,
}: {
	file: File;
	onCancel: () => void;
	/** The cropped bytes. Uploading and failure copy belong to the caller (the photo field). */
	onConfirm: (image: Blob) => void;
}) {
	const { t } = useTranslation(["account", "common"]);
	const labelId = useId();
	const [stage, setStage] = useState<Stage>({ kind: "decoding" });
	const [view, setView] = useState<AvatarCropView | null>(null);
	const [rendering, setRendering] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	/**
	 * Whether a render is in progress. This is a **synchronous copy**: the button's `disabled` only
	 * takes effect from the next render, so a confirm pressed twice in the same tick would not be
	 * blocked by state alone.
	 */
	const renderingRef = useRef(false);

	/**
	 * Decoding is tied to this dialog's lifetime. A late decode must not touch the state of a closed
	 * dialog, so it checks `cancelled`; the object URL and bitmap it opened are always released,
	 * because picking several photos would otherwise keep growing the memory this document holds.
	 */
	useEffect(() => {
		let cancelled = false;
		let opened: AvatarCropSourceImage | null = null;

		void (async () => {
			try {
				const source = await decodeAvatarSource(file);
				opened = source;
				if (cancelled) return;
				/**
				 * If the short edge is below the minimum, the server rejects the result **whatever rectangle is
				 * chosen**. Opening the crop screen would ask for something that cannot be fixed.
				 */
				if (!isAvatarCroppable(source, MIN_EDGE)) {
					setStage({ kind: "failed", message: avatarCropTooSmall() });
					return;
				}
				setView(initialAvatarCropView(source));
				setStage({ kind: "ready", source });
			} catch {
				if (!cancelled)
					setStage({ kind: "failed", message: avatarCropFailed() });
			}
		})();

		return () => {
			cancelled = true;
			opened?.release();
		};
	}, [file]);

	const source: AvatarCropSource | null =
		stage.kind === "ready" ? stage.source : null;
	const maxZoom = source ? avatarCropMaxZoom(source, MIN_EDGE) : 1;
	const busy = rendering || stage.kind === "decoding";

	const move = (dx: number, dy: number) => {
		if (!source || !view) return;
		const scale = avatarCropPanScale(
			view,
			source,
			viewportRef.current?.clientWidth ?? 0,
		);
		setView(
			clampAvatarCropView(
				{
					...view,
					centerX: view.centerX - dx * scale,
					centerY: view.centerY - dy * scale,
				},
				source,
				MIN_EDGE,
			),
		);
	};

	const zoomBy = (factor: number) => {
		if (!source || !view) return;
		setView(
			clampAvatarCropView(
				{ ...view, zoom: view.zoom * factor },
				source,
				MIN_EDGE,
			),
		);
	};

	/**
	 * The wheel listens natively. The `wheel` listener React attaches at the root is passive, so
	 * `preventDefault` is ignored and the page behind would scroll along with every zoom.
	 */
	useEffect(() => {
		const element = viewportRef.current;
		if (!element || !source || !view) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			zoomBy(Math.exp(-event.deltaY * WHEEL_ZOOM));
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	});

	/**
	 * Renders the cropped result and hands it to the parent.
	 *
	 * The name is deliberately not `confirm`: a static scan in this screen family reads `confirm(` as
	 * asking about a destructive action through the browser's native dialog, which has no room to say
	 * what remains. The scan is right to flag that, so the name changes, not the scan.
	 */
	const applyCrop = async () => {
		if (stage.kind !== "ready" || !view || renderingRef.current) return;
		renderingRef.current = true;
		setRendering(true);
		setError(null);
		try {
			const image = await renderAvatarCrop(
				stage.source,
				avatarCropRect(view, stage.source, MIN_EDGE),
			);
			onConfirm(image);
		} catch {
			setError(avatarCropFailed());
		} finally {
			renderingRef.current = false;
			setRendering(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, busy)) onCancel();
			}}
		>
			<DialogContent
				closeButtonDisabled={busy}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					<DialogTitle>{t("avatarCropDialog.cropPhoto")}</DialogTitle>
					{/*
					 * The description is omitted for a file that cannot be cropped: there is nothing to drag
					 * or zoom, and the sentence would be instructions that cannot succeed.
					 */}
					{stage.kind !== "failed" && (
						<DialogDescription>
							{t("avatarCropDialog.thePartInsideTheCircle")}
						</DialogDescription>
					)}
				</DialogHeader>

				{stage.kind === "failed" ? (
					<p role="alert" className="text-destructive text-sm">
						{stage.message}
					</p>
				) : (
					<div className="flex flex-col gap-4">
						{/*
						 * The crop surface. `touch-none` keeps a finger drag from leaking into page scrolling;
						 * pointer capture keeps the drag going when a fast finger leaves the box.
						 *
						 * It is reachable by keyboard too: arrow keys move, and the slider zooms. Leaving only
						 * mouse interaction would make this a fixed center crop that keyboard users cannot change.
						 */}
						<div
							ref={viewportRef}
							/*
							 * `role="application"` is needed **because this surface must receive the arrow keys.**
							 * Inside a screen reader's default (reading) mode, arrow keys scroll the document, so key
							 * handling on a box with no role would do **nothing** for that user. `group` is not right
							 * here: it means a `<fieldset>`, and this box holds a single picture to drag, not a group of
							 * controls.
							 *
							 * This role is expensive (the AT conventions inside it are all turned off), so what goes
							 * inside is narrowed to one thing: the zoom slider stays **outside** this box as an ordinary
							 * control.
							 */
							role="application"
							aria-label={avatarCropPanLabel()}
							tabIndex={source ? 0 : -1}
							className="relative aspect-square w-full touch-none overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onPointerDown={(event) => {
								if (!source) return;
								event.currentTarget.setPointerCapture(event.pointerId);
							}}
							onPointerMove={(event) => {
								if (!event.currentTarget.hasPointerCapture(event.pointerId))
									return;
								move(event.movementX, event.movementY);
							}}
							onKeyDown={(event) => {
								const step: Record<string, [number, number]> = {
									ArrowLeft: [KEY_PAN, 0],
									ArrowRight: [-KEY_PAN, 0],
									ArrowUp: [0, KEY_PAN],
									ArrowDown: [0, -KEY_PAN],
								};
								const delta = step[event.key];
								if (!delta) return;
								event.preventDefault();
								move(delta[0], delta[1]);
							}}
						>
							{stage.kind === "ready" && view ? (
								<CropSurface
									url={stage.source.previewUrl}
									source={stage.source}
									view={view}
								/>
							) : (
								<Skeleton className="absolute inset-0 rounded-none" />
							)}
						</div>

						<div className="flex items-center gap-3">
							{/* Without `shrink-0` the two-character label wraps vertically; value confirmed in the browser. */}
							<span
								id={labelId}
								className="shrink-0 text-muted-foreground text-xs"
							>
								{t("avatarCropDialog.zoom")}
							</span>
							<Slider
								value={[view?.zoom ?? 1]}
								min={1}
								max={maxZoom}
								step={ZOOM_STEP}
								disabled={!source || busy}
								aria-labelledby={labelId}
								onValueChange={(next) => {
									if (!source || !view) return;
									const zoom = Array.isArray(next) ? (next[0] ?? 1) : next;
									setView(
										clampAvatarCropView({ ...view, zoom }, source, MIN_EDGE),
									);
								}}
							/>
						</div>

						{error && (
							<p role="alert" className="text-destructive text-sm">
								{error}
							</p>
						)}
					</div>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						disabled={busy}
					>
						{t("avatarCropDialog.cancel")}
					</Button>
					{/*
					 * Not drawn for an uncroppable file. A disabled button reads as "usable later", but this file
					 * can never be used: the person's next step is to choose a different photo, not to wait
					 * (mobile is the same).
					 */}
					{stage.kind !== "failed" && (
						<Button
							type="button"
							onClick={() => void applyCrop()}
							disabled={stage.kind !== "ready" || busy}
						>
							{rendering
								? t("avatarCropDialog.creating")
								: t("avatarCropDialog.useThisArea")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Draws the rectangle currently selected. **It only derives from the geometry and never decides for
 * itself.**
 *
 * If the displayed values were computed separately from the manipulation state (zoom and center),
 * the screen and the rectangle actually cropped could diverge, and that mismatch would show only as
 * the result **after** confirm is pressed. So this places exactly the rectangle `avatarCropRect`
 * returned, by scaling and offsetting the image to match it.
 */
function CropSurface({
	url,
	source,
	view,
}: {
	url: string;
	source: AvatarCropSource;
	view: AvatarCropView;
}) {
	const rect = avatarCropRect(view, source, MIN_EDGE);
	/** How many percent of the surface one source pixel covers; the visible surface fills one side of the rectangle. */
	const factor = 100 / rect.width;

	return (
		<>
			<img
				src={url}
				alt=""
				draggable={false}
				className="absolute max-w-none origin-top-left select-none"
				style={{
					width: `${source.width * factor}%`,
					height: `${source.height * factor}%`,
					left: `${-rect.x * factor}%`,
					top: `${-rect.y * factor}%`,
				}}
			/>
			{/*
			 * The shade outside the circle. A very large outward box-shadow is used instead of stacking another
			 * element, because this layer must not take pointer input: with `pointer-events-none` the drag reaches
			 * the surface below.
			 *
			 * The color is the **app background**, not black. Outside the circle means "not the photo" rather than
			 * a darkened photo, and that meaning must read in opposite directions in the two themes. The mobile
			 * counterpart uses the same token (its color literals are blocked by a static scan, so the rule is
			 * enforced structurally there).
			 */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-full opacity-70 shadow-[0_0_0_9999px_var(--background)]"
			/>
		</>
	);
}
