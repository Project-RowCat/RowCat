import { cn } from "@rowcat/ui-web/lib/utils";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import {
	type CountRollCadence,
	countRollCells,
	countRollDirection,
	countRollHasTime,
	countRollIn,
	countRollOut,
} from "./count-roll.ts";

/**
 * Rolls only the digits that changed. It does not know what is counted or why the value changed.
 * - Takes the already-formatted string, so callers own formatting and units. Separators and
 *   colons never roll.
 * - The stored state is the last drawn value, not a total. The query cache stays the single
 *   source of truth, and optimistic updates and their rollbacks both arrive as a value change.
 * - State uses render-time adjustment, not useRef. Under StrictMode a discarded render would
 *   overwrite the previous value, so the first change would not roll.
 * - Screen readers hear only the sr-only copy. Visible cells are aria-hidden and select-none, so
 *   copying does not duplicate digits.
 * - Does not roll in hidden tabs. rAF stops there and framer-motion advances at most 40ms per
 *   frame, so the value would stay one transition off. The new value is shown directly.
 * - A nested AnimatePresence with initial undefined breaks the initial:false context inherited
 *   from the gallery grid, so mounts inside it can animate.
 */
export function AnimatedCount({
	value,
	cadence = "default",
	className,
}: {
	/** The exact characters to draw. Callers insert any digit separators before passing the value. */
	value: string;
	/**
	 * How often this value changes (CountRollCadence in count-roll.ts). The default exists because
	 * most consumers report something that happened once. Only values that tick every second or every
	 * keystroke pass 'continuous' explicitly. Unlike the pure layer, where the argument is required, a
	 * missing value here means 'does not change that often', which is the safe answer.
	 */
	cadence?: CountRollCadence;
	className?: string;
}) {
	/**
	 * On mount the previous value equals the current one, so no cell changes. When a saved item's
	 * total first renders in a list it must not appear as if just pressed (same as the heart with
	 * initial={false}).
	 */
	const [shown, setShown] = useState({
		value,
		previous: value,
		/** When the value last changed. Mounting is not a change, so it starts at negative infinity. */
		changedAt: Number.NEGATIVE_INFINITY,
	});
	if (shown.value !== value) {
		/**
		 * In a hidden tab the previous value is not kept. Keeping it would mark the cell as changed and
		 * start a transition whose first frame never arrives, leaving the old glyph opaque until the tab
		 * is shown again. Reading document during render is safe: it runs only in the render where the
		 * value changed, so there is no window for it to tear. Subscribing with useSyncExternalStore
		 * would re-render every number on each tab switch for no benefit.
		 */
		const hidden = typeof document !== "undefined" && document.hidden;
		/**
		 * Bursts of changes (dragging a slider, holding an arrow key) are not rolled. The next value
		 * would arrive before the digit finished, leaving the ones digit transparent (see the header of
		 * countRollHasTime). The clock is read here for the same reason as document above: this render is
		 * the only moment the value has changed.
		 */
		const now = Date.now();
		const hasTime = countRollHasTime(now - shown.changedAt, cadence);
		setShown({
			value,
			previous: hidden || !hasTime ? value : shown.value,
			changedAt: now,
		});
	}

	const direction = countRollDirection(shown.previous, shown.value);
	const cells = countRollCells(shown.previous, shown.value);
	const roll = {
		in: countRollIn(direction, cadence),
		out: countRollOut(direction, cadence),
	};

	return (
		<span className={cn("inline-flex items-center tabular-nums", className)}>
			{/*
			 * There is one child with a fixed key, so nothing exits here. This presence only provides a new
			 * context
			 * value (see the header).
			 * presenceAffectsLayout is off: when on, a new context object is created every render, re-rendering
			 * every
			 * digit. No sibling competes for position here.
			 */}
			<AnimatePresence presenceAffectsLayout={false}>
				<span
					key="digits"
					aria-hidden="true"
					className="inline-flex select-none"
				>
					{cells.map((cell) => (
						/**
						 * Each cell clips its own glyph. Clipping the whole number once would change the box width
						 * when the digit count changes, and the clip edge would move while rolling.
						 */
						<span
							key={cell.key}
							className="relative inline-block overflow-hidden"
						>
							{/*
							 * The outgoing glyph is taken out of flow, so the incoming glyph alone sets the width. With both in
							 * flow
							 * the cell would double. tabular-nums makes both glyphs the same width, so overlapping does not
							 * misalign.
							 * A new digit position (the leading 1 in 9 to 10) has no outgoing glyph.
							 * The key being the character is the whole wiring: only changed cells remount, and Motion applies
							 * initial
							 * only on mount, so unchanged cells never roll.
							 */}
							{cell.changed && cell.previous !== "" && (
								<m.span
									key={`out:${cell.previous}`}
									className="absolute inset-0"
									initial={roll.out.initial}
									animate={roll.out.animate}
									transition={roll.out.transition}
								>
									{cell.previous}
								</m.span>
							)}
							<m.span
								key={`in:${cell.character}`}
								className="inline-block"
								initial={cell.changed ? roll.in.initial : false}
								animate={roll.in.animate}
								transition={roll.in.transition}
							>
								{cell.character}
							</m.span>
						</span>
					))}
				</span>
			</AnimatePresence>
			<span className="sr-only">{shown.value}</span>
		</span>
	);
}
