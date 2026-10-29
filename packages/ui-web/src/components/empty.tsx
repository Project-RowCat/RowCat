import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@rowcat/ui-web/lib/utils"

/*
  Deviation from the generated component, and the third one in this package (the
  other two are the motion wiring and the toast surface's `z-60`): the inset is
  `p-6` until `sm`, not a flat `p-12`.

  The generated value assumes a desktop canvas. On a 320px screen this box gets
  288px, and `p-12` takes 96 of them — the copy is then laid out in 192px, which
  is narrow enough that Korean breaks mid-word (`You don't follow any creators yet`,
  measured in the browser). At `p-6` the same title fits one line (28px tall
  instead of 56px). The vertical half matters too: 96px of padding on a 568px-tall
  phone is a sixth of the screen spent on nothing.

  Applying it here rather than at the call sites is deliberate — there are 18 of
  them and they all pass `className="border"`, so a per-site copy would drift the
  first time someone adds the nineteenth.
*/
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg border-dashed p-6 text-center text-balance sm:p-12",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "text-lg font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

/**
 * The description paragraph.
 *
 * **`<p>` departs from the generated output, and the reason is this whole comment** (the file's
 * only departure). The generated component took props as `React.ComponentProps<"p">` while rendering
 * a `<div>`: the public type said paragraph and the DOM said generic division.
 *
 * That mismatch is silent. The screen looks the same, types pass (paragraph attributes are mostly
 * valid HTML on a `<div>` too), and no value is lost. Instead assistive technology gets prose with no
 * paragraph, and callers trust the paragraph vocabulary the type allows while no element keeps that
 * promise.
 *
 * The fix does not go the other way because of the consumers. Everything placed here is one block of
 * prose, and what needs block structure already has `EmptyContent`. Widening the type to `"div"`
 * would open that boundary, and lists and forms would start arriving here.
 */
function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
