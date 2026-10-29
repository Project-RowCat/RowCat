import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { tabsIndicatorRhythm } from "@rowcat/ui-web/lib/primitive-motion"
import { cn } from "@rowcat/ui-web/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  /*
    `relative` is what the indicator is positioned against. Base UI reports the active
    tab's offset from this element's padding edge, which is also where an absolutely
    positioned child starts — so the two agree without any arithmetic on our side.
  */
  "group/tabs-list relative inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/**
 * The active marker — **one object that moves**, not a highlight per trigger.
 *
 * Each trigger used to carry its own marker (a background for `default`, an `after`
 * rule whose opacity toggled for `line`). Selecting a tab therefore read as one thing
 * switching off and another switching on, which is not what happened: a single
 * selection moved.
 *
 * Base UI's own `Tabs.Indicator` is what makes the moving version possible without a
 * second source of truth. It measures the active tab and publishes the result as CSS
 * variables (`--active-tab-left`, `--active-tab-width`, …), re-measuring on scroll and
 * resize; `data-active` still decides which tab is active, and this element only
 * follows it. It is `role="presentation"` in the primitive, so the marker never
 * becomes the thing that announces selection.
 *
 * ## The identity problem does not arise here
 *
 * The app's sibling-to-sibling marker (`MotionActiveIndicator`) travels via a global
 * `layoutId`, which is why it demands a namespace: two surfaces sharing a name send the
 * marker flying across the screen. A shared primitive has that problem in a worse form
 * — several `Tabs` can be mounted at once and none of them can be asked to name itself.
 * Scoping by DOM (each indicator reads its own list's context) removes the question
 * instead of answering it, and `default` and `line` cannot bleed into each other for
 * the same reason: a list has exactly one variant.
 *
 * ## First paint does not travel
 *
 * Until the layout settles the primitive renders this element `hidden`, and a CSS
 * transition never runs on the first style an element gets after `display: none`. So
 * the marker simply appears under the active tab on mount and only animates when the
 * selection changes afterwards — the quiet start is structural, not a flag we have to
 * remember to set.
 */
const tabsIndicatorVariants = cva(
  "pointer-events-none absolute top-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) transition-[translate,width,height] motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default:
          "rounded-md shadow-sm bg-background dark:border dark:border-input dark:bg-input/30",
        /*
          The box still tracks the whole tab; the rule is drawn on its edge. Sizing the
          element itself down to the 2px line would mean re-deriving the tab's trailing
          edge from `--active-tab-top` plus `--active-tab-height`, and the offsets here
          (`bottom-[-5px]`, `-right-1`) are the ones the per-trigger `after` already
          used — so the line lands exactly where it did before, and now it slides.
        */
        line: "after:absolute after:bg-foreground group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {/*
        Rendered before the triggers so that it paints under them: both are positioned
        with `z-auto`, and positioned boxes at the same level paint in document order.
        The triggers keep their own `relative`, so their text and icons stay on top
        without a z-index race.
      */}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        style={tabsIndicatorRhythm}
        className={tabsIndicatorVariants({ variant })}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        /*
          What is left here is the part of "active" that belongs to *this* tab: its text
          colour. The surface behind it moved to the indicator, which is why the
          `group-data-[variant=line]` overrides that used to cancel that surface are
          gone too — there is nothing left to cancel.
        */
        "data-active:text-foreground dark:data-active:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  tabsListVariants,
  tabsIndicatorVariants,
}
