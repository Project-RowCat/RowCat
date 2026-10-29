import { Loader2Icon } from "lucide-react"

import { cn } from "@rowcat/ui-web/lib/utils"

/**
 * The spinner that says "working right now". There is **one** in this repository.
 *
 * For a while each screen hand-wrote `<Loader2 className="animate-spin" />`, and none of those
 * sixteen places respected reduced motion. In this repository that setting means one thing:
 * *transforms stop and opacity flows* (the reduced motion section of `docs/motion/ARCHITECTURE.md`).
 * Rotation is a transform, so screens kept spinning for people who had turned that setting on.
 *
 * So under reduced motion it **pulses instead of spinning** (`motion-reduce:animate-pulse`). It does
 * not stop (`animate-none`) because this glyph is state, not decoration: a still arc also reads as
 * "done" or "broken". That is where it splits from `Skeleton`, which stops under that setting: a
 * placeholder still says "not content yet" when still, while a stopped spinner says nothing.
 *
 * **It has no name.** It is `aria-hidden` by default. Every spinner in this repository stands beside
 * a button or a sentence, and what is in progress is already said by that button's name
 * (`Publishing…`) or the sentence beside it. A spinner with its own name would read the same fact
 * twice. A place where a spinner stands alone puts `role="status"` and a sentence there together.
 */
function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      aria-hidden="true"
      className={cn("animate-spin motion-reduce:animate-pulse", className)}
      {...props}
    />
  )
}

export { Spinner }
