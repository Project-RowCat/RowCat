import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";

/**
 * The slot where `Mark all read` appears. The bell popover and the notifications screen both render this
 * same component.
 *
 * It is not rendered when nothing is unread (§98). A disabled button would not explain why it
 * cannot be pressed, so its disappearance after a press is the direct result of the action. It
 * falls in the same moment and rhythm as the bell badge. `ml-auto` sits in this wrapper, so the
 * title beside it stays put when the button leaves. Presence is the right tool because it takes no
 * layout position (see `docs/motion/ARCHITECTURE.md`).
 *
 * Presses are ignored while the slot is exiting. By then the unread count is already 0 and the
 * button has left product state. If it stayed pressable through the exit frames (indefinitely in a
 * hidden tab), a second press would resend an action that already completed. `disabled={isPending}`
 * cannot cover this window, since the exit starts after the mutation finishes, when the button is
 * enabled again. The guard sits on the presence state rather than the exit target (see
 * `lib/motion/exit-guard.ts`). Both screens pass through this one wrapper, so neither can lose the
 * guard alone.
 */
export function MarkAllReadSlot({
	visible,
	className,
	children,
}: {
	/**
	 * Whether any unread items exist. This is the slot's existence condition; presence does not change
	 * it.
	 */
	visible: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<AnimatePresence initial={false}>
			{visible && (
				<MarkAllReadBody className={className}>{children}</MarkAllReadBody>
			)}
		</AnimatePresence>
	);
}

/** `useExitGuard()` is a hook, so the exiting slot must be a component (`exit-guard.ts`). */
function MarkAllReadBody({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	const exiting = useExitGuard();
	return (
		<m.div
			style={exiting}
			className={className}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0, transition: exitTransition }}
			transition={enterTransition}
		>
			{children}
		</m.div>
	);
}
