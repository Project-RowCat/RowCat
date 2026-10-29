import {
	type NativeRuntimeFromVm,
	type NativeRuntimeToVm,
	parseRuntimeMessage,
} from "./protocol.ts";

/**
 * One bridge. It knows nothing about the platform.
 *
 * The session sends into this object. This object passes strings to the view (the Android port or
 * the iOS injection), and the WebView receives them.
 *
 * This file has no `Platform.OS`, WebView or Expo module. The platform part is one function that
 * carries strings (the `sender` that `open` takes), and the view fills it in. That lets this layer
 * be tested without a simulator, which fits the app's rule that tests do not render screens.
 *
 * ## One queue, here
 *
 * Messages sent before the channel opens are queued, not dropped. A second queue on the native side
 * would make two orders, and they diverge on restart races. The Android module's `send` silently
 * dropping messages is the counterpart of this decision.
 *
 * ## Readiness is stated by the document, and it can be asked
 *
 * Channel open and harness set-up are different facts. The native side knows the first. The
 * document reports the second with `{ type: "ready" }`. Sending on channel open alone would deliver
 * the first message to a document with no handler yet, and that message would vanish without an
 * error.
 *
 * But the greeting is emitted once, when the document loads. When the bridge is rebuilt and the
 * document stays (Fast Refresh in development, or a session swap), that one greeting has already
 * passed and the new bridge never becomes ready. So `open` sends `hello` directly, bypassing the
 * queue. An answer means ready. If the document is not there yet, the greeting is lost, but loading
 * the document emits `ready` on its own.
 *
 * ## Failure is not a message
 *
 * A renderer process death or a failure to set up the bridge is not something the VM can report,
 * because the VM is already gone. So subscribers get two branches. Transport failure carries no
 * generation; attaching one is the session's job.
 */

export type NativeRuntimeBridgeKind =
	| "android-webmessage"
	| "ios-webview"
	| "unavailable";

export type NativeRuntimeTransportEvent =
	| { type: "message"; message: NativeRuntimeFromVm }
	| { type: "transport-failed"; reason: string };

export interface NativeRuntimeTransport {
	readonly bridge: NativeRuntimeBridgeKind;
	/** Whether the harness is up. Sends before this are queued. */
	readonly ready: boolean;
	readonly closed: boolean;
	send(message: NativeRuntimeToVm): void;
	subscribe(listener: (event: NativeRuntimeTransportEvent) => void): () => void;
	/** The view opens the channel, passing a function that carries one string. */
	open(sender: (json: string) => void): void;
	/** A raw string from the view. Malformed strings are silently dropped. */
	receive(raw: string): void;
	/** Renderer or bridge process failure. Nothing is sent after this. */
	fail(reason: string): void;
	close(): void;
}

/** The only message that skips the queue. Opening the queue is this message's job. */
const HELLO = JSON.stringify({ type: "hello" } satisfies NativeRuntimeToVm);

export function createNativeRuntimeTransport(
	bridge: NativeRuntimeBridgeKind,
): NativeRuntimeTransport {
	const listeners = new Set<(event: NativeRuntimeTransportEvent) => void>();
	const queue: string[] = [];
	let sender: ((json: string) => void) | null = null;
	let ready = false;
	let closed = false;

	const emit = (event: NativeRuntimeTransportEvent): void => {
		for (const listener of [...listeners]) listener(event);
	};

	const flush = (): void => {
		if (sender === null || !ready) return;
		while (queue.length > 0) {
			const next = queue.shift();
			if (next !== undefined) sender(next);
		}
	};

	return {
		bridge,
		get ready() {
			return ready;
		},
		get closed() {
			return closed;
		},
		send(message) {
			if (closed) return;
			queue.push(JSON.stringify(message));
			flush();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		open(next) {
			if (closed) return;
			sender = next;
			if (!ready) next(HELLO);
			flush();
		},
		receive(raw) {
			if (closed) return;
			const message = parseRuntimeMessage(raw);
			if (message === null) return;
			if (message.type === "ready") {
				/** A second `ready` is the second bridge of the same document (Android's port arrives late). */
				if (ready) return;
				ready = true;
				flush();
			}
			emit({ type: "message", message });
		},
		fail(reason) {
			if (closed) return;
			closed = true;
			sender = null;
			queue.length = 0;
			emit({ type: "transport-failed", reason });
		},
		close() {
			if (closed) return;
			closed = true;
			sender = null;
			queue.length = 0;
			listeners.clear();
		},
	};
}
