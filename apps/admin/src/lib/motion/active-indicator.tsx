import * as m from "motion/react-m";
import { layoutTransition } from "./transitions.ts";

/**
 * One active background that slides between siblings. It owns only the moving decoration; links,
 * `aria-current`, text and routes belong to the parent (taking `to` or `label` would make this a
 * navigation component branching the wide sidebar and the compact row in one place).
 *
 * - It does not state active state. When motion fails (slow device, dropped frames, reduced
 *   motion) the background is gone, so the parent keeps `aria-current` and static text styling;
 *   that is also why this is `aria-hidden`.
 * - The namespace is required. `layoutId` is a global string, and this app draws the same nav
 *   list twice (wide sidebar and compact row, both in the DOM). A fixed name would make the two
 *   treat each other as siblings and the indicator would fly across the screen.
 */
export function MotionActiveIndicator({
	group,
	className,
}: {
	/**
	 * The surface the indicator moves within (`admin-nav-wide`, `admin-nav-compact`), never a
	 * destination path: a name per item would make it pop in and out instead of moving.
	 */
	group: string;
	/** The surface decides the corners and colour of the slot it is drawn in. */
	className?: string;
}) {
	return (
		<m.span
			aria-hidden="true"
			layoutId={`active-indicator:${group}`}
			className={className}
			transition={layoutTransition}
		/>
	);
}
