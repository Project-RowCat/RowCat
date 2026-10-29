import * as m from "motion/react-m";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { pageEnterAnimate, pageEnterInitialFor } from "./page-enter.ts";
import { enterTransition } from "./transitions.ts";

/**
 * Asks React directly whether this subtree is hydrating.
 *
 * useSyncExternalStore uses getServerSnapshot during server render and hydration, and getSnapshot
 * afterwards, so this hook answers exactly whether this subtree is receiving server markup right
 * now.
 *
 * A global app flag (set in an effect when hydration ends) cannot know this. Route bodies hydrate
 * after the root has committed, because code-split routes sit under a Suspense boundary. The flag
 * is already on by then, so the first screen plays its entrance and mismatches the server markup.
 * That mistake was made once and reverted.
 *
 * The subscription is an empty function. The value does not listen for changes; React picks it per
 * render kind, so there is nothing to notify.
 */
const subscribeToNothing = () => () => {};
const notHydrating = () => false;
const isHydrating = () => true;

/**
 * Entrance for the destination only. The departing page is not held (that would make clicks wait
 * for the animation), and the route outlet is not keyed by path. Route identity belongs to the
 * router. Rebuilding it as a presence would make scroll restoration, focus, local state and
 * Suspense all shake with it.
 *
 * The wrapped element is the part that differs per screen. Shared frame pieces (header, back
 * button, title, also used by the placeholder) stay outside. So when a placeholder becomes content,
 * the frame stays still and only the arrived content enters.
 *
 * Not applied to placeholders. A placeholder means 'not there yet', and animating its arrival too
 * would add a second wait.
 *
 * No key prop. The entrance runs on mount, and keying by location or search would remount the whole
 * page on every filter keystroke.
 *
 * Reduced motion is not checked here. The global MotionConfig drops transforms and keeps opacity.
 * Checking per screen would read a value that the server render does not have.
 */
export function PageEnter({
	children,
	className,
}: {
	children: ReactNode;
	/** Needed when the wrapper must take part in layout (a flex child or a width constraint). */
	className?: string;
}) {
	const hydrating = useSyncExternalStore(
		subscribeToNothing,
		notHydrating,
		isHydrating,
	);
	/**
	 * Freezes the judgment made at mount. Hydration ends and the value flips; if the initial value
	 * followed, the first screen, already in place, would move once late.
	 */
	const [initial] = useState(() => pageEnterInitialFor(hydrating));

	return (
		<m.div
			className={className}
			initial={initial}
			animate={pageEnterAnimate}
			transition={enterTransition}
		>
			{children}
		</m.div>
	);
}
