import { cn } from "@rowcat/ui-web/lib/utils"

/**
 * A block that stands where content will be.
 *
 * Deliberately mechanics-only: no `card` / `avatar` / `text` variants. Fidelity is
 * composition — the component that owns the final geometry owns its placeholder,
 * so a variant here would only be a second place for that geometry to drift to.
 *
 * `motion-reduce:animate-none` is the one policy this primitive carries, and it is
 * the same narrowing `switch`, `checkbox`, `tabs` and `toast` already apply to their
 * CSS-driven motion (the class-layer equivalent of the app's
 * `MotionConfig reducedMotion="user"`). It matters more here than there: the pulse is
 * *infinite*, and on a slow request it is the only thing moving on the screen. Under
 * reduced motion the block stays a static muted rectangle — it still reads as "not
 * content yet", which is the whole job.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
