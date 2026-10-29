import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether this device has reduce-motion turned on. A trusted platform signal.
 *
 * Not exposed to creators: if creator code could branch on it, the same work would say different
 * things to users with the setting on. It only decides how many milliseconds a transition takes.
 *
 * One module holds the platform subscription and shares snapshots, so a 5,000-node screen still has
 * one listener. The listener is removed when the last subscriber leaves.
 *
 * The first snapshot is false. The platform answer is async, but snapshots are sync. Reading the
 * unknown state as on would drop the first transition for users who did not enable it. The opposite
 * error only ends an in-flight transition at its target.
 */

let enabled = false;
let subscribed: { remove(): void } | null = null;
const listeners = new Set<() => void>();

const publish = (next: boolean): void => {
	if (next === enabled) return;
	enabled = next;
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	if (subscribed === null) {
		subscribed = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			publish,
		);
		void AccessibilityInfo.isReduceMotionEnabled()
			.then(publish)
			.catch(() => {
				/**
				 * If the platform cannot answer, treat reduce-motion as off. This matches the first-snapshot
				 * direction described in the file header.
				 */
			});
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		subscribed?.remove();
		subscribed = null;
	};
};

const snapshot = (): boolean => enabled;

export const useReducedMotion = (): boolean =>
	useSyncExternalStore(subscribe, snapshot, snapshot);
