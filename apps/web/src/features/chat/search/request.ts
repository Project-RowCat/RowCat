import { useEffect, useRef } from "react";

/**
 * A one-way "open search" signal from the header trigger to the canvas.
 *
 * The trigger lives in the header's context slot, while the search panel lives in the canvas.
 * Picking a result must jump to the transcript, and the virtualized list that holds the messages is
 * in the canvas, so the request flows header → canvas. Only this signal crosses the boundary: no
 * query, no preview, no message id. The narrower the path for private values, the better.
 *
 * Listeners are keyed by room id, so a late click cannot open another room's search. A request with
 * no listener (a click before hydration) is dropped rather than kept, since a kept request would
 * open a panel the user never asked for once the screen mounts.
 *
 * This is deliberately not a context provider: the only place that could hold one is the app layout
 * route, and that shell must not own a feature's state. Nothing is stored here, so nothing needs
 * clearing when the room or account changes.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Called by the header trigger. Does nothing when no listener is mounted for the room. */
export function requestChatSearch(roomId: string): void {
	for (const listener of listeners.get(roomId) ?? []) listener();
}

/**
 * Listens for open requests for this room. Only the conversation screen calls it.
 *
 * The callback is kept in a ref so the subscription is not re-attached on every render;
 * re-attaching would drop a request that arrives in the gap between removal and re-registration.
 */
export function useChatSearchRequests(roomId: string, onRequest: () => void) {
	const handler = useRef(onRequest);
	handler.current = onRequest;

	useEffect(() => {
		const listener = () => handler.current();
		const room = listeners.get(roomId) ?? new Set<Listener>();
		room.add(listener);
		listeners.set(roomId, room);
		return () => {
			room.delete(listener);
			// Drop empty sets so rooms that were visited do not accumulate for the life of the tab.
			if (room.size === 0) listeners.delete(roomId);
		};
	}, [roomId]);
}
