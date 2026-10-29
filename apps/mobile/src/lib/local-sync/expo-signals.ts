import * as Network from "expo-network";
import { AppState } from "react-native";
import type {
	MobileLifecycleSource,
	MobileNetworkSource,
} from "./auto-sync.ts";

/**
 * Native wiring for auto-sync signals, in the same place as `secure-store.ts` and `expo-driver.ts`.
 *
 * It lives in its own file for one reason: `expo-network` is a native module and does not open in
 * Node. All judgment (filtering foreground transitions, offline → online transitions) stays in
 * `auto-sync.ts` on top of the ports. What arrives here is **subscription wiring only**, which
 * keeps the code that tests cannot reach to a minimum.
 *
 * `NetInfo` is not added. `expo-network` already provides the needed signals (current state and
 * change subscription), and this slice adds no native dependency.
 */

export const appStateLifecycleSource: MobileLifecycleSource = {
	current: () => AppState.currentState,
	subscribe(listener) {
		const subscription = AppState.addEventListener("change", listener);
		return () => subscription.remove();
	},
};

/**
 * Only `isConnected === false` counts as offline. `undefined` (unknown) counts as online. The value
 * is a hint, not reachability, and blocking on a missing hint gains nothing (header of
 * `auto-sync.ts`).
 */
const onlineOf = (state: { isConnected?: boolean }): boolean =>
	state.isConnected !== false;

export const expoNetworkSource: MobileNetworkSource = {
	/**
	 * The start-time value is unknown (`null`). The API that asks for current state is async only, and
	 * waiting for it here would tie runtime startup to the network module. It becomes accurate when
	 * the first transition arrives.
	 */
	current: () => null,
	subscribe(listener) {
		const subscription = Network.addNetworkStateListener((state) =>
			listener(onlineOf(state)),
		);
		/**
		 * Also asks for the current state once. Listeners receive transitions only, so an app that starts
		 * offline would otherwise not know it and its retry timer would spin uselessly. Failures are
		 * swallowed (a missing hint is all that happens).
		 */
		void Network.getNetworkStateAsync()
			.then((state) => listener(onlineOf(state)))
			.catch(() => undefined);
		return () => subscription.remove();
	},
};
