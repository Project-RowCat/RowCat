import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { pageEnterAnimate, pageEnterInitial } from "./page-enter.ts";
import { enterTransition } from "./transitions.ts";

/**
 * The only page transition: the destination's entrance.
 *
 * - No exit choreography (clicks would wait on it) and no presence keyed by path on the router
 *   outlet — re-creating route identity shakes scroll restoration, focus and local state.
 * - It wraps only what changes per screen; the shell stays outside and stays still.
 * - It stands outside `QueryState`, so placeholders get no entrance (that doubles the wait).
 * - It takes no key: it runs on mount, and keying by location or search would remount the page on
 *   every filter keystroke.
 * - Reduced motion is handled globally by `MotionConfig reducedMotion="user"`.
 */
export function PageEnter({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<m.div
			className={className}
			initial={pageEnterInitial}
			animate={pageEnterAnimate}
			transition={enterTransition}
		>
			{children}
		</m.div>
	);
}
