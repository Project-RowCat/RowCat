import { cn } from "@rowcat/ui-web/lib/utils";
import { useCallback, useRef } from "react";
import {
	clampRuntimeSize,
	RUNTIME_LAYOUT_LIMITS,
	RUNTIME_RESIZE_STEP,
	type RuntimeLayoutKey,
} from "./layout.ts";

/**
 * The handle between panels works with the keyboard as well as the mouse. A mouse-only resizer
 * removes the operation entirely for keyboard and assistive-technology users (the repo applies the
 * same reasoning to its overflow menu). role=separator with aria-valuenow lets assistive tech read
 * the current width and change it with the arrow keys. The size is not owned by this component. Its
 * value comes in as a prop and changes go out as callbacks. Holding state here would split the
 * saved preference from what is shown, and two resizers would stop knowing each other's values. A
 * double press returns to the default width; a single press does not. The handle is where people
 * press to grab, and a size that jumps on grab reads as broken. The default comes from
 * RUNTIME_LAYOUT_LIMITS[axis].initial, because passing pixels from callers would make three copies.
 * Pointer capture is used. Without setPointerCapture on window, Monaco swallows pointer events when
 * the cursor moves over the editor during a drag, and the size stops although the button is held.
 */
export function RuntimeResizer({
	axis,
	side,
	value,
	label,
	onChange,
	className,
}: {
	/**
	 * Which panel's size this handle controls. Its min and max come from that panel's entry in the
	 * limits table.
	 */
	axis: RuntimeLayoutKey;
	/**
	 * The direction in which dragging increases the value. The explorer widens when dragged right
	 * (end), while the preview and bottom panel widen in the opposite direction (start). If callers
	 * computed the sign, the calculation would appear in three places, and one wrong copy would
	 * reverse that handle.
	 */
	side: "start" | "end";
	value: number;
	label: string;
	onChange: (next: number) => void;
	className?: string;
}) {
	const vertical = axis === "panel";
	const origin = useRef<{ pointer: number; value: number } | null>(null);

	const move = useCallback(
		(delta: number) => onChange(clampRuntimeSize(axis, value + delta)),
		[axis, value, onChange],
	);

	const limits = RUNTIME_LAYOUT_LIMITS[axis];

	return (
		/**
		 * Not an `<hr>`, because this element is operated on. An hr cannot take focus, capture the
		 * pointer, or carry aria-valuenow. What is needed here is a value-bearing handle, not a document
		 * divider.
		 */
		// biome-ignore lint/a11y/useSemanticElements: an interactive separator with a value, not an hr.
		<div
			role="separator"
			tabIndex={0}
			aria-orientation={vertical ? "horizontal" : "vertical"}
			aria-label={label}
			aria-valuenow={value}
			aria-valuemin={limits.min}
			aria-valuemax={limits.max}
			className={cn(
				"shrink-0 bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none",
				vertical ? "h-px w-full cursor-row-resize" : "w-px cursor-col-resize",
				className,
			)}
			/**
			 * The hit area is larger than the visible handle. A 1px line looks right but is too thin to grab
			 * by hand, so the visible line stays as it is and only the grab width is widened.
			 */
			style={
				vertical
					? {
							marginBlock: "-3px",
							paddingBlock: "3px",
							backgroundClip: "content-box",
						}
					: {
							marginInline: "-3px",
							paddingInline: "3px",
							backgroundClip: "content-box",
						}
			}
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				origin.current = {
					pointer: vertical ? event.clientY : event.clientX,
					value,
				};
			}}
			onPointerMove={(event) => {
				const start = origin.current;
				if (!start) return;
				const raw = (vertical ? event.clientY : event.clientX) - start.pointer;
				const delta = side === "end" ? raw : -raw;
				onChange(clampRuntimeSize(axis, start.value + delta));
			}}
			onPointerUp={(event) => {
				origin.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onDoubleClick={() => onChange(limits.initial)}
			onKeyDown={(event) => {
				const grow = side === "end" ? 1 : -1;
				switch (event.key) {
					case vertical ? "ArrowUp" : "ArrowLeft":
						event.preventDefault();
						move(-RUNTIME_RESIZE_STEP * grow);
						return;
					case vertical ? "ArrowDown" : "ArrowRight":
						event.preventDefault();
						move(RUNTIME_RESIZE_STEP * grow);
						return;
					case "Home":
						event.preventDefault();
						onChange(limits.min);
						return;
					case "End":
						event.preventDefault();
						onChange(limits.max);
						return;
				}
			}}
		/>
	);
}
