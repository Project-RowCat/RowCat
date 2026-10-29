import type { ByoFetch, ByoResponse } from "../lib/generation/byo.ts";

/**
 * Test implementation of the transport the BYO adapters use. It runs over a real stream.
 *
 * `expo/fetch` is not mocked. What the adapter actually does is read SSE frames and turn them into
 * events, and that only gets hard when bytes arrive in several pieces. A mock that returns the
 * whole response as one string hides exactly that difficulty.
 *
 * So this builds a real `ReadableStream`, and the caller decides the chunk boundaries.
 */

export interface RecordedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
}

export interface FakeFetch {
	fetch: ByoFetch;
	/** Every request sent through this transport, body included. */
	calls: RecordedRequest[];
}

/** A stream that emits the chunks in order. The chunk boundaries are what the checks target. */
export function streamOf(
	chunks: readonly string[],
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}
			const chunk = chunks[index];
			index += 1;
			controller.enqueue(encoder.encode(chunk ?? ""));
		},
	});
}

/** Builds one SSE frame. The `event:` line is optional. */
export const sseFrame = (data: string, event?: string): string =>
	`${event ? `event: ${event}\n` : ""}data: ${data}\n\n`;

export interface FakeResponseInit {
	ok?: boolean;
	status?: number;
	headers?: Record<string, string>;
	body?: ReadableStream<Uint8Array> | null;
}

export const fakeResponse = (init: FakeResponseInit = {}): ByoResponse => ({
	ok: init.ok ?? true,
	status: init.status ?? 200,
	headers: new Headers(init.headers ?? {}),
	body: init.body ?? null,
});

/**
 * A transport that returns one response per call.
 *
 * `respond` is a function because of order: a check that the adapter does not retry must be able to
 * answer the second call differently.
 */
export function fakeFetch(
	respond: (request: RecordedRequest) => ByoResponse | Promise<ByoResponse>,
): FakeFetch {
	const calls: RecordedRequest[] = [];
	return {
		calls,
		fetch: async (url, init) => {
			const record: RecordedRequest = {
				url,
				method: init.method,
				headers: init.headers,
				body: init.body,
			};
			calls.push(record);
			// Called with a signal that is already aborted, it throws the way a real transport does.
			if (init.signal.aborted) {
				const error = new Error("Aborted");
				error.name = "AbortError";
				throw error;
			}
			return respond(record);
		},
	};
}

/** A transport that always returns the same response. Most journeys use this. */
export const respondWith = (response: ByoResponse): FakeFetch =>
	fakeFetch(() => response);
