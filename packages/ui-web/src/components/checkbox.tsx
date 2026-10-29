"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import {
  checkboxIndicatorRhythm,
  checkboxTickDrawRhythm,
} from "@rowcat/ui-web/lib/primitive-motion"
import { cn } from "@rowcat/ui-web/lib/utils"

/*
  The tick is drawn, so it is our own path rather than lucide's `CheckIcon`. Two facts
  about that glyph decide it: its path starts at the **long** stroke's far end
  (`M20 6 9 17l-5-5`), so drawing it would pull the mark backwards — tip first, crook
  last — and its length is unknown to us, so the dash would have to lean on
  `pathLength`, which older WebKit ignores for `stroke-dasharray` (the mark would then
  sit half-drawn forever, silently). The geometry below is the same tick reversed:
  short stroke first, the way a hand writes it.

  Each length is the path's own length rounded **up**. Dash = gap = that value, and an
  offset of the same value turns the whole path into gap — round caps are drawn only on
  dashes, so not even a dot of cap shows before the stroke starts.
*/
const TICK_PATH = "M4 12l5 5L20 6" // 5√2 + 11√2 ≈ 22.63
const TICK_LENGTH = 24
const DASH_PATH = "M5 12h14"
const DASH_LENGTH = 16

/**
  The length reaches the class layer as a variable so the number lives once, here —
  written into the class as a literal it would be a second copy that nobody updates
  when the path changes, and a too-short dash leaves the far end of the mark missing.
*/
function strokeDraw(length: number): React.CSSProperties {
  return {
    ...checkboxTickDrawRhythm,
    "--stroke-length": length,
  } as React.CSSProperties
}

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-shadow outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary",
        className
      )}
      {...props}
    >
      {/*
        Mixed (`indeterminate`) is filled like checked. Base UI renders the indicator for
        both states but publishes `data-checked` for the first only, so with the fill
        keyed to `data-checked` alone a mixed box was an outline with a
        primary-foreground mark inside it — a near-white glyph on a near-white box.
        No screen in this repository passes `indeterminate` today; the primitive still
        answers it, and the day a "select all" row appears it answers it correctly.
      */}
      {/*
        The tick used to be `transition-none`: the glyph blinked in and out while the
        shell around it kept easing its background and border. That reads as two things
        happening — a box changing colour, and an icon materialising on top of it.

        Base UI already owns this element's lifetime (it mounts on check, and unmounts
        only after `getAnimations()` settles), and it publishes that lifetime as
        `data-starting-style` / `data-ending-style`. Reading those two attributes is
        what makes the transition possible **without a second source of truth** — no
        `useState` mirror of `checked`, no `keepMounted`, no change to the primitive's
        semantics. The checked state stays exactly where it was.

        Only the mark moves. The shell keeps its own CSS state transitions, and its
        `size-4` never changes — scaling the whole control would shove the label beside
        it, and this is a control that lives in a row of text.
      */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        style={checkboxIndicatorRhythm}
        className={cn(
          "group/indicator grid place-content-center text-current [&>svg]:size-3.5",
          /*
            The property list stays in the class layer so `motion-reduce` can narrow it.
            Dropping `scale` there — rather than the whole transition — is exactly what
            the app's `MotionConfig reducedMotion="user"` does to Motion-driven movement:
            the transform snaps, the fade stays, and the state change is still legible.
          */
          "transition-[opacity,scale] motion-reduce:transition-opacity",
          /*
            Entering is the answer to a press, so it carries the deeper scale. Leaving is
            quieter (0.85, not 0.8) — unchecking is not a destructive event, and a mark
            that shrinks away hard reads like one. The two directions can differ at all
            because Base UI hands us two separate attributes; the duration does not
            (`primitive-motion.ts` says why).
          */
          "data-starting-style:scale-80 data-starting-style:opacity-0",
          "data-ending-style:scale-85 data-ending-style:opacity-0"
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/*
            The stroke is drawn **only on the way in.** Base UI marks the first frame of a
            fresh mount with `data-starting-style` and clears it on the next, so the dash
            offset starts at "all gap" there and eases to zero — the same lifetime the
            fade above reads, with no state of ours.

            Four edges, each decided here rather than left to chance:

            - **Unchecking does not un-draw.** `data-ending-style` touches opacity and
              scale only; a stroke rewinding reads as erasing, which is heavier than the
              event. The mark leaves whole.
            - **A box rendered already checked does not draw.** Base UI mounts the
              indicator without `starting` when the root starts checked, so a settings
              page opening on saved values is still — nothing was just pressed.
            - **Re-checking mid-exit does not redraw.** The indicator is still mounted,
              so no new `starting` frame exists; the mark fades back in whole. Drawing it
              again would need a mirror of `checked` in React state — the thing this
              control refuses (`selection-state.test.ts`).
            - **Reduced motion drops the stroke, not the fade.** The draw is spatial
              movement; the indicator's opacity still carries the state change, exactly
              as `MotionConfig reducedMotion="user"` narrows Motion-driven surfaces.

            Unmounting waits on the **indicator's** animations only (Base UI calls
            `element.getAnimations()` without `subtree`), so the longer draw below never
            delays a teardown — and exit does not run it anyway.
          */}
          <path
            d={TICK_PATH}
            style={strokeDraw(TICK_LENGTH)}
            className={cn(
              "[stroke-dasharray:var(--stroke-length)] [stroke-dashoffset:0] transition-[stroke-dashoffset] motion-reduce:transition-none",
              "group-data-starting-style/indicator:[stroke-dashoffset:var(--stroke-length)]",
              "group-data-indeterminate/indicator:hidden"
            )}
          />
          {/*
            Mixed is a dash, not a tick — a tick on a "some are selected" box states
            something false. Switching between mixed and checked while mounted swaps the
            glyph instantly: a path coming out of `display: none` starts no transition,
            and that is the right weight for a change the user did not make on this box.
          */}
          <path
            d={DASH_PATH}
            style={strokeDraw(DASH_LENGTH)}
            className={cn(
              "hidden [stroke-dasharray:var(--stroke-length)] [stroke-dashoffset:0] transition-[stroke-dashoffset] motion-reduce:transition-none",
              "group-data-starting-style/indicator:[stroke-dashoffset:var(--stroke-length)]",
              "group-data-indeterminate/indicator:block"
            )}
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
