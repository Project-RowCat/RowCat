import * as m from "motion/react-m";
import { layoutTransition } from "./transitions.ts";

/**
 * One active background that moves between siblings.
 * - Two places share this meaning: the global navigation in the sidebar (`Discover`, `Conversations`, `Create`) and
 *   the rooms in the recent-chats list below. Both mean "the sibling that is here now" and both
 *   show it with a background layer. Sharing the value is correct; if the same action moved at
 *   different speeds on different screens, it would not be one app.
 * - This component owns only the moving decoration. Links, aria-current, text, and routes all
 *   stay with the parent. That boundary is the whole file. If `to` or `label` entered here, this
 *   would become a navigation component and branch the markup of two lists in one place.
 * - It does not state active status. If motion fails (slow device, dropped frames,
 *   reduce-motion), the background disappears. So the parent keeps aria-current and the static text
 *   style, and the background is an overlay on top of them. It is aria-hidden for the same reason:
 *   there is nothing to read.
 * - group is required. layoutId is a global string. With a fixed name, the global navigation's
 *   indicator and the recent-chat indicator would treat each other as siblings and fly across the
 *   sidebar, even though both are normally on at once (in a chat room, the `Conversations` item and that
 *   room's row light up together). The fixed sidebar and the mobile drawer have the same issue, so
 *   their containers add a namespace layer (LayoutGroup). Requiring the caller to name it makes
 *   that mistake a compile-time error.
 */
export function MotionActiveIndicator({
	group,
	className,
}: {
	/**
	 * The range of siblings this indicator can move among, named by surface, such as
	 * `app-sidebar-primary` and `app-sidebar-recent-chat`. Do not put domain ids (room ids, draft ids)
	 * here. This argument says which list, not which item. A name per item would stop the indicator
	 * from moving between items, and each would appear and disappear on its own, so the reason for a
	 * shared layout would be gone.
	 */
	group: string;
	/**
	 * The background's appearance. The corner and color of the spot where it is drawn are set by the
	 * surface.
	 */
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
