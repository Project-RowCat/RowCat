import type { ChatToolFetch } from "@rowcat/chat";
import { signalWithDeadline } from "./abort-signal.ts";

/**
 * The network port of `http` custom tools (`ChatCustomToolPorts.fetch` in `@rowcat/chat`).
 *
 * `@rowcat/chat` holds no clock, so the deadline lives here, in the app's port. A tool call runs
 * inside a turn the user is watching: an endpoint that never answers would hold the whole reply
 * (and the model's next round trip) until the user stops it, and stopping would drop the reply too.
 * Past the deadline the call is aborted, the loop turns the throw into its fixed error sentence
 * (`chatToolErrorText`), and the model answers without that result.
 *
 * ## Why not `nativeStreamingFetch`
 *
 * A tool result is one string the loop reads whole, so streaming buys nothing, and the BYO port's
 * shape (`ByoFetch`) hands out a body stream rather than `text()`. The global `fetch` (Expo's
 * implementation by default, React Native's polyfill otherwise) reads a text body either way.
 *
 * ## What it guarantees
 *
 * - **One deadline over the whole call**, headers and body. The body is read here, inside the
 *   deadline, so a server that sends headers and then trickles bytes is cut too.
 * - **The error body is never read.** A non-2xx answer returns an empty text; the loop throws on
 *   `!ok` without reading it anyway, and an error page could carry anything the endpoint printed.
 * - **No cookies.** The endpoint is a third party the user named; this device's cookie jar is not
 *   theirs to receive (`native-fetch.ts` made the same call for providers).
 * - No retry. A tool call can have effects at the endpoint, and a retry would repeat them.
 */

/** How long one tool call may take, headers and body together. */
export const CHAT_TOOL_FETCH_TIMEOUT_MS = 15_000;

/** The part of `fetch` this port uses; the global `fetch` satisfies it. Injected for tests. */
export type ChatToolBaseFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body?: string;
		signal: AbortSignal;
		credentials: "omit";
	},
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function createChatToolFetch(
	base: ChatToolBaseFetch,
	timeoutMs: number = CHAT_TOOL_FETCH_TIMEOUT_MS,
): ChatToolFetch {
	return async (url, init) => {
		const bounded = signalWithDeadline(init.signal, timeoutMs);
		try {
			const response = await base(url, {
				method: init.method,
				headers: init.headers,
				...(init.body === undefined ? {} : { body: init.body }),
				signal: bounded.signal,
				credentials: "omit",
			});
			if (!response.ok)
				return { ok: false, status: response.status, text: async () => "" };
			const body = await response.text();
			return { ok: true, status: response.status, text: async () => body };
		} finally {
			bounded.dispose();
		}
	};
}

/** The device's tool port: the global `fetch` under the deadline. */
export const chatToolFetch: ChatToolFetch = createChatToolFetch((url, init) =>
	fetch(url, init),
);
