import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { switchRhythm } from "@rowcat/ui-web/lib/primitive-motion"
import { cn } from "@rowcat/ui-web/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      /*
        The rhythm comes from `lib/primitive-motion.ts` on both elements — the thumb's
        slide and the track's colour are one answer to one press. A bare `transition-*`
        class would now fall back to the theme default (`--default-transition-*`, also
        primitive · standard), so dropping this line would change nothing *today* — which
        is exactly why the name stays: the day the switch's rhythm must differ from every
        hover in the app, this is the one place to change. The property lists stay in the
        class layer so `motion-reduce:` can narrow them.
      */
      style={switchRhythm}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/*
        The thumb's only animated property is its transform, so `motion-reduce` drops
        the transition entirely: the slide snaps, and the state stays legible through
        the track colour — the same thing `MotionConfig reducedMotion="user"` does to
        Motion-driven transforms.
      */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        style={switchRhythm}
        className="pointer-events-none block rounded-full bg-background ring-0 transition-transform motion-reduce:transition-none group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
