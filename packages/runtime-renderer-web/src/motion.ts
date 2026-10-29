import {
	classifyRuntimeTransition,
	RUNTIME_EASING_BEZIER,
	type RuntimeResolvedTransition,
} from "@rowcat/runtime/transition";
import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { rendererError, WEB_RENDERER_ERROR_CODE } from "./errors.ts";

/**
 * Transitions: the browser interpolates; this renderer only decides when it is allowed to.
 *
 * - No requestAnimationFrame and no interpolation math live here. CSS transitions are used
 *   because interruption is free: if the target of a running transition changes, the browser moves
 *   from the value currently on screen to the new target. A hand-written interpolator would have to
 *   rebuild that behavior, and usually does not.
 * - Transition declarations are not part of record.css. Style sync (syncInlineCss) makes inline
 *   declarations match a target set and removes anything outside it. A transition is a separate
 *   axis, like object-fit in fit: it is set directly on the element, and style sync does not touch
 *   it.
 * - transition-property names only two properties, which cover the contract's four. It does not
 *   use "all": that would also animate width, padding, background-color and border-radius. Those
 *   trigger layout, and the native renderer does not move them, so the same work would move
 *   differently on each platform.
 */

/** The properties this renderer interpolates. The contract's four properties map onto these two. */
export const WEB_TRANSITION_PROPERTY = "opacity, transform";

const TRANSITION_DECLARATIONS = [
	"transition-property",
	"transition-duration",
	"transition-timing-function",
] as const;

/** Transition state for one node. The registry record in `nodes.ts` holds this shape. */
export interface WebNodeMotion {
	/** The policy as the author wrote it. Null means the node has no transition. */
	transition: RuntimeResolvedTransition | null;
	/**
	 * Whether the node has completed one batch. Its initial value must not animate, so having a
	 * transition does not by itself make an entrance animate. Creating the node, setting its props,
	 * and inserting it all happen in one batch. Arming at the end of that batch lets those assignments
	 * pass without transition declarations.
	 *
	 * RequestAnimationFrame or a forced reflow could also skip the first frame, but both depend on
	 * timing and behave differently in tabs that receive no frames. The batch end is an observable
	 * event instead.
	 */
	armed: boolean;
}

export const newNodeMotion = (): WebNodeMotion => ({
	transition: null,
	armed: false,
});

/**
 * Maps an easing name to a CSS timing function. The source is the control-point table in
 * `@rowcat/runtime`.
 */
export function easingCss(easing: keyof typeof RUNTIME_EASING_BEZIER): string {
	const [x1, y1, x2, y2] = RUNTIME_EASING_BEZIER[easing];
	/**
	 * Only `linear` becomes a keyword. Its bezier is a straight line, and the keyword is easier to
	 * read.
	 */
	return x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1
		? "linear"
		: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/**
 * Maps a host value to a resolved transition. Anything outside the contract is a contract error.
 *
 * The VM already rejects the same input with the same function, but this realm is the final
 * authority here too. Corrupted bundles and old artifacts reach this boundary, and silently folding
 * them would draw the screen differently from what the author wrote.
 */
export function readTransition(
	value: RuntimeHostValue,
): RuntimeResolvedTransition {
	const verdict = classifyRuntimeTransition(value);
	if (!verdict.ok)
		throw rendererError(
			WEB_RENDERER_ERROR_CODE.contract,
			`transition: ${verdict.reason}`,
		);
	return verdict.transition;
}

/**
 * Whether this node should transition right now. All three conditions must hold.
 *
 * A durationMs of 0 counts as no transition. Setting a declaration then would make the browser
 * start and immediately finish a zero-length transition, emitting transitionend. The screen looks
 * the same, but an extra state exists that nothing uses.
 */
export const transitionActive = (
	motion: WebNodeMotion,
	reducedMotion: boolean,
): boolean =>
	motion.armed &&
	motion.transition !== null &&
	motion.transition.durationMs > 0 &&
	!reducedMotion;

/**
 * Syncs the transition declarations on the element to the node's policy.
 *
 * When reduced motion is on, the declarations are removed. A transition in progress ends at once
 * and the browser draws the target value, so no node is left stuck partway. When reduced motion
 * turns off again, values already reached stay put and only the next change animates.
 */
export function applyTransitionCss(
	element: HTMLElement,
	motion: WebNodeMotion,
	reducedMotion: boolean,
): void {
	if (!transitionActive(motion, reducedMotion)) {
		for (const property of TRANSITION_DECLARATIONS)
			element.style.removeProperty(property);
		return;
	}
	const transition = motion.transition as RuntimeResolvedTransition;
	element.style.setProperty("transition-property", WEB_TRANSITION_PROPERTY);
	element.style.setProperty(
		"transition-duration",
		`${transition.durationMs}ms`,
	);
	element.style.setProperty(
		"transition-timing-function",
		easingCss(transition.easing),
	);
}
