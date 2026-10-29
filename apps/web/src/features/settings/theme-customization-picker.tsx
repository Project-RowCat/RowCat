import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { cn } from "@rowcat/ui-web/lib/utils";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useId,
	useRef,
	useState,
} from "react";
import { translator } from "#/lib/i18n/current.ts";
import {
	clampHue,
	clampUnit,
	type HsvColor,
	normalizeHue,
} from "./theme-customization-color.ts";
import {
	huePosition,
	openThemeColorPicker,
	pointToHue,
	pointToSv,
	svPosition,
	type ThemeColorPickerState,
	themeColorPickerColor,
	themeColorPickerWithHex,
	themeColorPickerWithHsv,
} from "./theme-customization-picker-state.ts";
import {
	normalizedThemeDraftValue,
	themeInvalidValueNote,
	themePickerCurrentLabel,
	themePickerHexLabel,
	themePickerHueLabel,
	themePickerSurfaceLabel,
	themeSlotPresetLabel,
} from "./theme-customization-state.ts";

/**
 * - Does not open the browser's native color input. The dialog's wording, look, color space and
 *   recent-colors list are outside the product's control and vary by device. The dialog also sits
 *   outside the popover, so it cannot follow the preview.
 * - Three controls only: a saturation (x) and brightness (y) plane, a hue slider from 0 to 360,
 *   and a hex field. The hex field is canonical because it matches the stored value. RGB/HSL tabs,
 *   eyedropper, swatches and wheels are intentionally absent. Each added control would need a
 *   sentence explaining what it paints.
 * - Does not apply colors. Dragging changes the parent draft, which only affects the preview box
 *   in this section. The global document and platform shell change only after the server confirms
 *   the save (see features/theme/account-theme-bridge.tsx).
 * - Two non-overlapping state owners. The parent (ThemeEditor) holds the background, surface and
 *   primary drafts. This component holds the HSV axes and hex text of the open popover. HSV never
 *   leaves: the parent only receives #rrggbb. Closing the popover discards the axes.
 * - Pure rules live in theme-customization-picker-state.ts, because web tests have no React
 *   rendering and rules inside the hook could only be checked by hand.
 */

/**
 * Arrow-key step size. Saturation and brightness steps are ratios (0.01 is 1 percent). Hue steps
 * are degrees.
 */
const UNIT_STEP = 0.01;
const UNIT_STEP_LARGE = 0.1;
const HUE_STEP = 1;
const HUE_STEP_LARGE = 10;

/**
 * Hue strip: the six stops are computed, not hand-written. A hand-written list of colors would read
 * as a palette, and someone would eventually use one of them as a product color. This is a hue
 * scale, not a palette.
 */
const HUE_GRADIENT = `linear-gradient(to right, ${[
	0, 60, 120, 180, 240, 300, 360,
]
	.map((hue) => `hsl(${hue} 100% 50%)`)
	.join(", ")})`;

/**
 * Handle style: white border plus dark ring, so it stays visible on both light and dark
 * backgrounds.
 */
const HANDLE_CLASS =
	"pointer-events-none absolute size-4 rounded-full border-2 border-white ring-1 ring-black/50";

/**
 * Drag uses pointer capture instead of document-level listeners. Document listeners would be a
 * cleanup hazard: a leaked handler keeps running after the popover closes. They would also collide
 * with the popover's outside-press detection. Capture keeps events on the element, so a finger that
 * leaves the surface does not close the popover.
 *
 * Mouse, touch and pen share one path on purpose. Separate implementations tend to skip boundary
 * handling for touch.
 */
function usePointerTrack(
	onPoint: (event: ReactPointerEvent<HTMLElement>) => void,
) {
	const dragging = useRef(false);

	const stop = (event: ReactPointerEvent<HTMLElement>) => {
		if (!dragging.current) return;
		dragging.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	};

	return {
		onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
			/**
			 * The right mouse button does not start a drag, so the context menu is not turned into a color
			 * picker.
			 */
			if (event.pointerType === "mouse" && event.button !== 0) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			event.currentTarget.focus();
			dragging.current = true;
			onPoint(event);
		},
		onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
			if (dragging.current) onPoint(event);
		},
		onPointerUp: stop,
		onPointerCancel: stop,
	};
}

const percent = (value: number): number => Math.round(value * 100);

export function ThemeColorPicker({
	label,
	value,
	fallbackColor,
	valid,
	onChange,
}: {
	/** Field label (`Background`, `Surface`, `Accent`). It also builds the control's accessible name. */
	label: string;
	/** The draft value as typed. An empty string means 'use the preset color'. */
	value: string;
	/** Color the picker starts from when the value is empty: the selected preset's color. */
	fallbackColor: string;
	valid: boolean;
	onChange: (value: string) => void;
}) {
	const id = useId();
	const hexId = `${id}-hex`;
	const hexErrorId = `${id}-hex-error`;

	/**
	 * Created once when the popover opens, and deliberately not re-derived afterward. The closed
	 * popover's content is not mounted (the portal does this), so mounting is opening. An effect that
	 * re-derived the axes from the incoming value would fire on every drag frame, because the emitted
	 * value becomes the next prop. The hue would also vanish when the color passes through gray.
	 */
	const [state, setState] = useState<ThemeColorPickerState>(() =>
		openThemeColorPicker(value, fallbackColor),
	);

	/** Pushes the outgoing value to the draft and updates the local display state in one step. */
	const commit = (next: ThemeColorPickerState) => {
		setState(next);
		onChange(next.rawHex);
	};

	const setHsv = (hsv: HsvColor) => commit(themeColorPickerWithHsv(hsv));

	const color = themeColorPickerColor(state);
	const handle = svPosition(state.hsv);
	const hue = clampHue(state.hsv.h);
	const saturation = percent(state.hsv.s);
	const brightness = percent(state.hsv.v);

	const surfaceTrack = usePointerTrack((event) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const { s, v } = pointToSv(event, rect);
		setHsv({ ...state.hsv, s, v });
	});

	const hueTrack = usePointerTrack((event) => {
		const rect = event.currentTarget.getBoundingClientRect();
		setHsv({ ...state.hsv, h: pointToHue(event.clientX, rect) });
	});

	/**
	 * Keyboard support, so the picker is not pointer-only. With the native picker removed, missing
	 * arrow-key handling would be a regression for keyboard users. The old control had keyboard
	 * operation provided by the OS.
	 */
	const onSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		const step = event.shiftKey ? UNIT_STEP_LARGE : UNIT_STEP;
		const { s, v } = state.hsv;
		switch (event.key) {
			case "ArrowLeft":
				setHsv({ ...state.hsv, s: clampUnit(s - step) });
				break;
			case "ArrowRight":
				setHsv({ ...state.hsv, s: clampUnit(s + step) });
				break;
			case "ArrowDown":
				setHsv({ ...state.hsv, v: clampUnit(v - step) });
				break;
			case "ArrowUp":
				setHsv({ ...state.hsv, v: clampUnit(v + step) });
				break;
			default:
				return;
		}
		/**
		 * Arrow keys would otherwise scroll the page and move the grabbed control off-screen, so the
		 * default is prevented.
		 */
		event.preventDefault();
	};

	const onHueKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		const step = event.shiftKey ? HUE_STEP_LARGE : HUE_STEP;
		switch (event.key) {
			case "ArrowLeft":
			case "ArrowDown":
				setHsv({ ...state.hsv, h: clampHue(hue - step) });
				break;
			case "ArrowRight":
			case "ArrowUp":
				setHsv({ ...state.hsv, h: clampHue(hue + step) });
				break;
			case "Home":
				setHsv({ ...state.hsv, h: 0 });
				break;
			case "End":
				setHsv({ ...state.hsv, h: 360 });
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	return (
		<div className="flex flex-col gap-3">
			{/*
			 * Saturation and brightness area, built from three stacked layers: the current hue at full
			 * strength, white fading in from the left, and black fading in from the bottom.
			 * CSS gradients are used instead of a canvas. There are no pixels to paint manually, CSS
			 * follows device resolution, and no redraw is needed when the hue changes.
			 * The 2D control is announced as one slider. aria-valuenow is the horizontal (saturation)
			 * axis, and aria-valuetext conveys both axes.
			 */}
			<div
				role="slider"
				tabIndex={0}
				aria-label={`${label} ${themePickerSurfaceLabel()}`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={saturation}
				aria-valuetext={translator("settings")("picker.surfaceValue", {
					saturation,
					brightness,
				})}
				className="relative h-36 w-full cursor-crosshair touch-none rounded-md border outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
				style={{
					backgroundColor: `hsl(${normalizeHue(hue)} 100% 50%)`,
					backgroundImage:
						"linear-gradient(to top, rgb(0 0 0), rgb(0 0 0 / 0)), linear-gradient(to right, rgb(255 255 255), rgb(255 255 255 / 0))",
				}}
				onKeyDown={onSurfaceKeyDown}
				{...surfaceTrack}
			>
				<span
					aria-hidden
					className={cn(HANDLE_CLASS, "-translate-x-1/2 -translate-y-1/2")}
					style={{
						left: `${handle.left}%`,
						top: `${handle.top}%`,
						backgroundColor: color,
					}}
				/>
			</div>

			{/*
			 * Hue track: the visible tick is 12px, but the hit target is 28px, so fingers do not need to
			 * hit a 4px line.
			 */}
			<div
				role="slider"
				tabIndex={0}
				aria-label={`${label} ${themePickerHueLabel()}`}
				aria-valuemin={0}
				aria-valuemax={360}
				aria-valuenow={Math.round(hue)}
				aria-valuetext={translator("settings")("picker.hueValue", {
					degrees: Math.round(hue),
				})}
				className="relative h-7 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				onKeyDown={onHueKeyDown}
				{...hueTrack}
			>
				<span
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full border"
					style={{ backgroundImage: HUE_GRADIENT }}
				/>
				<span
					aria-hidden
					className={cn(
						HANDLE_CLASS,
						"top-1/2 -translate-x-1/2 -translate-y-1/2",
					)}
					style={{
						left: `${huePosition(hue)}%`,
						backgroundColor: `hsl(${normalizeHue(hue)} 100% 50%)`,
					}}
				/>
			</div>

			{/* Current color: the last valid color. A half-typed input does not clear this swatch. */}
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">
					{themePickerCurrentLabel()}
				</span>
				<span
					aria-hidden
					className="size-6 shrink-0 rounded-md border shadow-xs"
					style={{ backgroundColor: color }}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor={hexId} className="text-xs text-muted-foreground">
					{themePickerHexLabel()}
				</label>
				<Input
					id={hexId}
					value={state.rawHex}
					placeholder="#rrggbb"
					spellCheck={false}
					autoComplete="off"
					aria-invalid={!valid || undefined}
					/*
					 * The invalid state is announced with its reason, not only aria-invalid. Without the reason,
					 * screen-reader users would know a field is wrong but not what is wrong. The explanation is
					 * rendered directly below the field.
					 */
					aria-describedby={valid ? undefined : hexErrorId}
					onChange={(event) =>
						commit(
							themeColorPickerWithHex(state, event.target.value, fallbackColor),
						)
					}
					/*
					 * Normalizes to the canonical form (#9A83FF becomes #9a83ff) only when the field loses focus.
					 * Normalizing while typing would move the caret, and someone typing mixed case would watch
					 * their characters change. Values that are not valid syntax are kept as typed. Silently
					 * reverting would hide why saving is locked.
					 */
					onBlur={() => {
						const normalized = normalizedThemeDraftValue(state.rawHex);
						if (normalized === state.rawHex || !valid) return;
						commit({ ...state, rawHex: normalized });
					}}
					className="font-mono"
				/>
				{/*
				 * Invalid syntax is not silently discarded. A warning shows and saving is locked
				 * (themeRequestFrom returns null).
				 * Discarding it and saving anyway would make replace semantics reset that slot to the preset
				 * color.
				 */}
				{!valid && (
					<p id={hexErrorId} className="text-xs text-destructive" role="alert">
						{themeInvalidValueNote()}
					</p>
				)}
			</div>

			{/*
			 * Resets one slot. It changes only the local draft and makes no server call.
			 * The picker also restarts from the preset color. If the handle stayed at its old position,
			 * the screen could not show what was picked.
			 */}
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => commit(openThemeColorPicker("", fallbackColor))}
			>
				{themeSlotPresetLabel()}
			</Button>
		</div>
	);
}
