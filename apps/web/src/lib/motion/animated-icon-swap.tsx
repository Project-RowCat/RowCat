import { cn } from "@rowcat/ui-web/lib/utils";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { iconSwapIn, iconSwapOut, iconSwapQuietIn } from "./icon-swap.ts";

/**
 * Swaps one glyph inside a control. It holds no state (no useState, useRef, or useEffect). The
 * moment of swap is when stateKey changes, and that value is derived from facts the app already
 * holds.
 * - If motion held product state, it would depend on frames, and an action would never happen in
 *   a tab without frames.
 * - No onAnimationComplete: clipboard writes and stopping generation do not wait for the swap to
 *   finish.
 * - The two glyphs overlap in one grid cell. Absolute positioning or popLayout would need
 *   measurement, which can read 0 off-screen or in hidden tabs.
 * - The box must not change the height the virtualizer measures. Only opacity and transform move.
 * - Mounting does not animate. AnimatePresence initial={false} handles the first render and also
 *   blocks an inherited initial:false context.
 * - The whole box is aria-hidden. While swapping, both glyphs are in the DOM, so a named graphic
 *   would give the control two names. The accessible name is the outer aria-label, which changes in
 *   the same render as the state.
 */
export function AnimatedIconSwap({
	stateKey,
	quiet = false,
	children,
	className,
}: {
	/**
	 * The current glyph, derived from app state (e.g. generating ? 'stop' : 'send'). Each change of
	 * this value is the moment the glyph swaps.
	 */
	stateKey: string;
	/**
	 * Whether this change is not a response to a user action. The copied-indicator reset uses it: the
	 * incoming glyph then fades in quietly (iconSwapQuietIn in icon-swap.ts).
	 */
	quiet?: boolean;
	children: ReactNode;
	className?: string;
}) {
	const swap = quiet ? iconSwapQuietIn : iconSwapIn;

	return (
		<span
			aria-hidden="true"
			className={cn("inline-grid place-items-center", className)}
		>
			{/*
			 * presenceAffectsLayout is off. When on, a new context object is created every render and
			 * everything below
			 * re-renders. The two overlapping glyphs share one grid cell and do not compete for position, the
			 * same
			 * judgment as AnimatedCount.
			 */}
			<AnimatePresence initial={false} presenceAffectsLayout={false}>
				<m.span
					key={stateKey}
					className="col-start-1 row-start-1 inline-flex"
					initial={swap.initial}
					animate={swap.animate}
					exit={iconSwapOut}
					transition={swap.transition}
				>
					{children}
				</m.span>
			</AnimatePresence>
		</span>
	);
}
