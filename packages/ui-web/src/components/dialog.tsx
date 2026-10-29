import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { useMediaQuery } from "@base-ui/react/unstable-use-media-query"
import type { HTMLMotionProps } from "motion/react"
import * as m from "motion/react-m"

import { cn } from "@rowcat/ui-web/lib/utils"
import {
  backdropMotion,
  DIALOG_WIDE_QUERY,
  dialogMotion,
  type DialogPlacement,
  resolveDialogPlacement,
} from "@rowcat/ui-web/lib/primitive-motion"
import { Button } from "@rowcat/ui-web/components/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
      render={(htmlProps, state) => (
        <m.div
          {...(htmlProps as HTMLMotionProps<"div">)}
          {...backdropMotion(state.open)}
        />
      )}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeButtonDisabled = false,
  placement = "center",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /**
   * Whether the top-right close button is **currently unavailable**.
   *
   * This is a different question from `showCloseButton`. That one asks *does this surface have the
   * control*; this one asks *can the existing control be pressed now*. While an operation is in
   * progress the button stays in place disabled rather than disappearing (if a target vanished the
   * moment an operation started, the layout would shift and the user would not know what they lost).
   *
   * This value is **display, not policy.** What may close the window is decided by the app
   * (`apps/web/src/lib/dialog/dismiss.ts`); this answers only the state of the one control it draws.
   * That is why it is not called `busy` or `pending` (this component does not own operation state).
   * Both boundaries receiving the same boolean separately is intended.
   */
  closeButtonDisabled?: boolean
  /**
   * Where this surface stands: a box in the middle of the screen by default,
   * `adaptive` for a sheet that sticks to the bottom on narrow screens, `left` for
   * a full-height drawer against the left edge.
   *
   * Geometry is a prop because of the motion. A centered box walks back half its
   * own size to sit in the middle (`-50%`), and Motion now owns that offset as part
   * of its `transform` — so a class cannot override it, which is what the drawer
   * used to do with `translate-x-0` and the sheet with `translate-y-0`. Naming the
   * placement gives each of the three its own movement instead.
   */
  placement?: DialogPlacement
}) {
  /*
    Measuring the viewport is part of the same story: the vertical offset an
    `adaptive` dialog needs is a transform rather than CSS, so a `sm:` class cannot
    express it. This is the only place that reads the width, and the decision it
    feeds is a pure function (`resolveDialogPlacement`).

    `noSsr` because this surface is portalled and never rendered on the server —
    there is no markup to match on a second pass.
  */
  const wide = useMediaQuery(DIALOG_WIDE_QUERY, { noSsr: true })
  const resolved = resolveDialogPlacement(placement, wide)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-placement={resolved}
        className={cn(
          "fixed z-50 grid w-full max-w-[calc(100%-2rem)] gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-md",
          placement === "center" && "top-1/2 left-1/2",
          placement === "adaptive" && "left-1/2",
          className
        )}
        {...props}
        render={(htmlProps, state) => (
          <m.div
            {...(htmlProps as HTMLMotionProps<"div">)}
            {...dialogMotion(resolved, state.open)}
          />
        )}
      >
        {children}
        {showCloseButton && (
          /*
            `disabled` is set on the primitive, not on the rendered `Button`.

            Base UI's `Close` resolves that value through its own `useButton`, passing the native
            `disabled` attribute to the rendered element **and** short-circuiting its own `onClick`
            (the handler that issues the close request). So a disabled X does not create an invalid
            close reason for the policy to swallow; it **never issues the request at all**.

            That difference is why we do not imitate it with `onClick={(e) => e.preventDefault()}`.
            That shape is still a pressable button to assistive technology and the keyboard, and it
            looks active too.
          */
          <DialogPrimitive.Close
            data-slot="dialog-close"
            disabled={closeButtonDisabled}
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
