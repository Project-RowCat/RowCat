import { ROW_ENTER_Y } from "@rowcat/design";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";
import { enterTransition, exitTransition, rowLayout } from "./transitions.ts";

/**
 * The rhythm for lines that carry an identity; the same values as web's `list-motion.ts`.
 *
 * ```text
 * enter     opacity 0 → 1 · translateY 4 → 0 · normal · enter
 * exit      opacity → 0 · **no movement** · fast · exit
 * reflow    remaining lines slide into their new places · normal · standard
 * ```
 *
 * Each list owns its choreography. There is deliberately no shared `<AnimatedEntityLibrary>`: such
 * a component would also take rendering, empty states, sorting, movement and management menus, and
 * conversations and authoring would then share a component just because both are "lists".
 *
 * The rhythm attaches where identity-carrying lines actually appear and disappear: conversation
 * lists, draft lists, sessions, passkeys, personas, and recent conversations in the sidebar. Where
 * it does not attach matters more:
 *
 * - Virtualized conversation lines: the virtualizer owns their geometry (see the boundary below).
 * - Lists that grow with "load more": twenty appended lines each rising in turn would read as a
 *   list just created.
 * - Grids (gallery, works): reflow there is a query result, not a user action.
 * - Placeholders: animating the entrance of an "empty" state doubles the waiting.
 *
 * No stagger. Web rejected it for the same reason: the list reads late, and ordinary data arrival
 * becomes choreography. Neither this file nor the callers build `delay(index * …)`.
 *
 * Boundary: `MessageList` lines are measured by the virtualizer, which uses those heights to hold
 * the scroll position. Adding `entering`, `exiting` or `layout` here fights that measurement, and
 * the symptom is a scroll that jumps. `apps/mobile/src/lib/motion/motion-boundaries.test.ts` pins
 * the absence by value.
 */

const rowEnter = () => {
	"worklet";
	return {
		initialValues: { opacity: 0, transform: [{ translateY: ROW_ENTER_Y }] },
		animations: {
			opacity: withTiming(1, enterTransition.opacity),
			transform: [{ translateY: withTiming(0, enterTransition.transform) }],
		},
	};
};

/**
 * A removed line: no movement.
 *
 * A moving exit would mix direction with the siblings flowing into its space, and it becomes
 * unclear what disappeared and what moved. The disappearing line only fades; the line that fills
 * the gap is the only one that moves.
 */
const rowExit = () => {
	"worklet";
	return {
		initialValues: { opacity: 1 },
		animations: { opacity: withTiming(0, exitTransition.opacity) },
	};
};

/**
 * One line in a list.
 *
 * `entering` can be turned off (`enter={false}`). The editor's child cards (characters, lore, start
 * scenes) need this: when the order changes, a card moving downward would replay its entrance and
 * look like a different card appeared. That screen treats reordering as a real action and keeps
 * object permanence; web made the same call.
 *
 * ## `exiting` can be turned off too: **it matters when the list is about to become empty**
 *
 * This axis came from an overlap seen on a device. When the library had **only one** line and it
 * was deleted, that line's exit (120ms fade) ran while the empty-state text entered at the same
 * spot, so two messages overlapped for a few frames.
 *
 * **Web does not have this frame, and the reason is structural.** There the list and the empty
 * state are **two branches of one presence**, and the exit branch has no `exit`
 * (`persona-library-content.tsx`). Deleting the last line removes the whole list **immediately**
 * and the empty state fades in alone. The line's exit sits **inside** that presence, so it unmounts
 * with the branch change.
 *
 * Reanimated has no equivalent of "the whole inner presence is removed": a leaving view runs its
 * own `exiting` to completion whatever the parent does. So the same result comes from a fact the
 * caller knows: if this line is the last in the list, it gets no exit (`exit={rows.length > 1}`).
 *
 * The fact has to be in the last render, because Reanimated reads `exiting` from the render
 * **before** the view leaves; deciding after the delete is too late. The line must already be
 * rendered this way while it is the only one.
 *
 * **Product state does not wait for this axis.** The delete commits in the pressed frame; the only
 * thing that differs here is the disappearing graphic.
 *
 * **No press guard here.** Web blocks presses on an exiting line with `useExitGuard()`, because in
 * a background browser tab an exit can take **indefinitely** long. Reanimated's exit runs on the UI
 * thread, and when the app goes to the background the screen takes no interaction at all, so that
 * window does not exist on this platform. No device is built for a problem that is not there.
 */
export function MotionRow({
	children,
	style,
	enter = true,
	exit = true,
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
	enter?: boolean;
	/**
	 * Whether this line animates out when it leaves. **There is one place to set it false:** this line
	 * is leaving and the list becomes empty, so the empty state takes its spot (see the header).
	 * Keeping the exit then would overlap the outgoing line with the incoming text.
	 */
	exit?: boolean;
}) {
	return (
		<Animated.View
			style={style}
			entering={enter ? rowEnter : undefined}
			exiting={exit ? rowExit : undefined}
			layout={rowLayout}
		>
			{children}
		</Animated.View>
	);
}
