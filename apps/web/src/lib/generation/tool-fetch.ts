import type { ChatToolFetch } from "@rowcat/chat";

/**
 * The browser's network port for `http` custom tools (`ChatCustomToolPorts.fetch`).
 *
 * The tool layer in @rowcat/chat holds no clock, so the timeout lives here. Without one, an
 * endpoint that accepts the connection and never answers would hold the turn open until the user
 * gave up: the turn's own abort signal only fires when the person presses stop, and the model's
 * round trip is waiting on this call.
 *
 * What the request deliberately does not carry, whatever the endpoint is:
 * - **Cookies** (`credentials: "omit"`). The URL is the user's choice and may be this app's own
 *   origin, where the default (`same-origin`) would attach the RowCat session to a body the model
 *   wrote from the conversation.
 * - **The referrer** (`referrerPolicy: "no-referrer"`). The page address names the room, and an
 *   endpoint has no use for which conversation called it.
 *
 * A timeout and a user abort are both thrown as the fetch's own abort error. The loop turns any
 * throw into one fixed sentence (`chatToolErrorText`), so telling the two apart here would buy
 * nothing the model reads.
 */

/** Long enough for a slow serverless cold start, short enough that a dead endpoint costs one wait. */
export const TOOL_FETCH_TIMEOUT_MS = 15_000;

/** The slice of `fetch` this port calls. The global `fetch` satisfies it; tests pass a fake. */
export type ToolFetchImpl = (
	url: string,
	init: RequestInit,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function createToolFetch(
	impl: ToolFetchImpl = (url, init) => globalThis.fetch(url, init),
	timeoutMs: number = TOOL_FETCH_TIMEOUT_MS,
): ChatToolFetch {
	return async (url, init) => {
		/*
		 * One controller per call, linked to the turn's signal. `AbortSignal.any` would be shorter, but
		 * it is recent (2024 in Safari), and a missing method here would fail every http tool on an
		 * older browser instead of only losing the timeout. The timer is also cleared on completion,
		 * which a bare `AbortSignal.timeout` cannot do.
		 */
		const controller = new AbortController();
		const forward = (): void => controller.abort(init.signal.reason);
		if (init.signal.aborted) forward();
		else init.signal.addEventListener("abort", forward, { once: true });
		const timer = setTimeout(
			() =>
				controller.abort(
					new DOMException(
						"The tool endpoint did not answer in time.",
						"TimeoutError",
					),
				),
			timeoutMs,
		);
		try {
			const response = await impl(url, {
				method: init.method,
				headers: init.headers,
				...(init.body === undefined ? {} : { body: init.body }),
				signal: controller.signal,
				credentials: "omit",
				referrerPolicy: "no-referrer",
			});
			/*
			 * The body is read inside the timer as well. Headers can arrive promptly while the body
			 * trickles forever; reading it after clearing the timer would reopen exactly that wait.
			 */
			const text = await response.text();
			return {
				ok: response.ok,
				status: response.status,
				text: async () => text,
			};
		} finally {
			clearTimeout(timer);
			init.signal.removeEventListener("abort", forward);
		}
	};
}
