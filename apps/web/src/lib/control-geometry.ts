/**
 * Height of the `Select` trigger: 36px on narrow screens, 32px from `sm` up.
 *
 * `data-[size=sm]:` is required. The primitive defines `data-[size=sm]:h-8`, and a plain `h-9`
 * loses to it because an attribute selector raises specificity. The result is that only the control
 * sits at 32px on narrow screens while the placeholder in the same spot is 36px, so the row jumps
 * by 4px when the value arrives. Every other control in the app is one step larger on narrow
 * screens, so this one has no reason to be an exception.
 *
 * The value lives in one constant because the same string had been written in four screens
 * (response length, reasoning steps, generation target, brightness). Fixing the 4px jump would
 * otherwise touch only the file where it was reported, and the other three would keep jumping. The
 * `@rowcat/ui-web` primitive (shadcn output) is not modified.
 */
export const SELECT_TRIGGER_HEIGHT =
	"h-9 data-[size=sm]:h-9 sm:h-8 sm:data-[size=sm]:h-8";
