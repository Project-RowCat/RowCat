/**
 * SSE (`text/event-stream`) framing, shared by both BYO adapters.
 *
 * Our server speaks NDJSON (the reason is in `@rowcat/contracts/chat`), but calls to providers must
 * follow the format they chose, and both of theirs are SSE. Per-adapter parsers would duplicate
 * subtle chunk-boundary bugs, and those bugs look like "the response occasionally loses a
 * character", which is hard to reproduce.
 *
 * This file does **framing only**. Which event terminates and what counts as a delta is protocol
 * knowledge that each adapter owns; this file knows neither Anthropic nor Gemini.
 *
 * It does not implement the full spec. `id:`, `retry:` and comment lines (`:`) are unused by both
 * providers, and a half-implemented spec is always wrong somewhere.
 *
 * ## No native code here
 *
 * The input is a `ReadableStream<Uint8Array>`, and this file does not care who produced it
 * (`expo/fetch` on device, a hand-built stream in tests). That is why the framing rules are
 * verified without a simulator.
 */

/** One frame: the event name and the data body. */
export interface SseFrame {
	/** The `event:` line; empty string when absent (Gemini never sends one). */
	event: string;
	/** The `data:` lines joined with newlines. */
	data: string;
}

/**
 * Byte stream → frames.
 *
 * Frame boundaries are blank lines, independent of chunk boundaries. Only complete frames are
 * yielded; without this, a delta split across two chunks would parse half a JSON object.
 *
 * ## Line endings: all three are accepted
 *
 * The spec treats `\n`, `\r\n` and `\r` as line endings, and blank lines may arrive in any of them.
 * This parser once looked only for `\n\n`, which held for Anthropic alone: Google sends `\r\n\r\n`,
 * which contains no `\n\n` (it is `\n\r\n`). No boundary was found, so the whole remaining buffer
 * was parsed as one frame at stream end, and that failed. The symptom was not occasional lost
 * characters but **every Gemini BYO generation ending in `provider_error` with no deltas**.
 *
 * So incoming bytes are normalized to LF first, and the rest of the code looks only for `\n\n`. Raw
 * CR and LF cannot appear inside a data line (they are line endings), so normalization does not
 * alter content. A chunk ending in `\r` holds that one character until the next chunk: whether it
 * is one line break or two depends on the `\n` that follows, and deciding now would make boundaries
 * depend on where the chunks happened to split.
 *
 * `finally` releases the reader. It must run when the caller breaks out (the user stops) or the
 * signal aborts, so the upstream socket is closed; otherwise the model keeps generating, and
 * **those tokens are billed to the user's provider account.**
 */
export async function* readSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	/** The previous chunk ended in `\r`; whether that line has ended depends on the next character. */
	let danglingCr = false;

	/** Appends newly arrived text to the buffer, normalized to LF. */
	const feed = (text: string): void => {
		let chunk = danglingCr ? `\r${text}` : text;
		danglingCr = false;
		if (chunk.endsWith("\r")) {
			danglingCr = true;
			chunk = chunk.slice(0, -1);
		}
		buffer += chunk.replace(/\r\n?/g, "\n");
	};

	const frameOf = (block: string): SseFrame | null => {
		let event = "";
		const data: string[] = [];
		// Line endings were already normalized above, so `\r` is not stripped again here.
		for (const line of block.split("\n")) {
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
		}
		return data.length > 0 ? { event, data: data.join("\n") } : null;
	};

	const drain = function* (): Generator<SseFrame> {
		let boundary = buffer.indexOf("\n\n");
		while (boundary >= 0) {
			const frame = frameOf(buffer.slice(0, boundary));
			buffer = buffer.slice(boundary + 2);
			boundary = buffer.indexOf("\n\n");
			if (frame) yield frame;
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			feed(decoder.decode(value, { stream: true }));
			yield* drain();
		}
		/**
		 * A final frame may arrive without a trailing blank line, and the stream may simply end. Dropping
		 * it would lose the terminal event and record a normal completion as a truncated stream.
		 */
		feed(decoder.decode());
		// A stream that ends in `\r` ends its line there.
		if (danglingCr) {
			danglingCr = false;
			buffer += "\n";
		}
		yield* drain();
		const tail = frameOf(buffer);
		if (tail) yield tail;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/**
 * Parses frame data as JSON. **Broken lines are skipped, not thrown.** Our own server's frames are
 * our bug if they break, but keep-alives, comments and non-spec lines from providers are outside
 * our control. Throwing here would end a healthy generation for someone else's reason.
 */
export function parseSseData<T>(data: string): T | null {
	if (!data || data === "[DONE]") return null;
	try {
		return JSON.parse(data) as T;
	} catch {
		return null;
	}
}
