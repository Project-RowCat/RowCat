/**
 * SSE (text/event-stream) framing, shared by both BYO adapters.
 *
 * Our server writes NDJSON (the reason is in @rowcat/contracts/chat), but calling providers
 * directly means following their format, and both use SSE. Separate parsers per adapter would
 * produce two copies of subtle bugs, such as chunk-boundary handling. The symptom of such a bug is
 * hard to reproduce, for example 'a character of the response occasionally disappears'.
 *
 * This module does framing only. Which event is terminal and which is a delta is protocol
 * knowledge, and each adapter owns it. The SDK's readNdjson and createChatApi are split for the
 * same reason.
 *
 * The full spec is not implemented. Neither provider uses id:, retry:, or comment lines (:), and a
 * half-implemented spec is always wrong somewhere. Add them when they are needed.
 */

export interface SseFrame {
	/** The `event:` line. Empty if absent; Gemini never sends this line. */
	event: string;
	data: string;
}

/**
 * Byte stream to frames.
 *
 * Frame boundaries are blank lines and have nothing to do with chunk boundaries. Values are emitted
 * only for complete frames. Without this, a delta spanning two chunks would parse half a JSON
 * object.
 *
 * Accept all three line endings. A parser that looks only at LF breaks on Gemini.
 *
 * The spec recognizes three line endings: LF, CRLF, and CR. A blank line can arrive with any of
 * them. An earlier version searched for LF LF only, which held for Anthropic alone. Google sends
 * CRLF CRLF. That contains no LF LF (it is LF CR LF), so no boundary matched. The entire remaining
 * buffer was then parsed as one frame at stream end and failed. The symptom was not occasional
 * missing characters. Every Gemini BYO generation ended with provider_error and no deltas.
 *
 * So incoming bytes are first normalized to LF, and below that only LF LF is checked. Raw CR and LF
 * cannot appear inside data lines (they are the line ends themselves), so normalization does not
 * change content. If a chunk ends with CR, that one character is held until the next chunk. Whether
 * it is one line end or two depends on whether an LF follows. Deciding now would make boundaries
 * depend on chunk boundaries.
 *
 * The reader is released in finally. This matters when the caller exits with break (the user's
 * stop) or the signal aborts. The upstream socket must be released too. Otherwise the model keeps
 * generating and the tokens are billed to the user's provider account.
 */
export async function* readSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	/** The previous chunk ended with CR. The next character decides whether that line has ended. */
	let danglingCr = false;

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
		// Line endings are already normalized above; do not strip CR again here.
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
		 * A stream can end without a blank line after the last frame. Dropping the buffer would lose the
		 * terminal event, and a normal completion would be recorded as a truncated stream.
		 */
		feed(decoder.decode());
		// If the stream ended on a CR, that CR terminates the last line.
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
 * Reads frame data as JSON. Malformed lines are skipped; this does not throw.
 *
 * The trust level is the reason. Frames from our server are ours, so a malformed one is a bug.
 * Keep-alives, comments, and non-standard lines from a provider are outside our control. Throwing
 * here would cut a healthy generation short because of someone else's behavior.
 * services/generation/ chat.ts makes the same decision.
 */
export function parseSseData<T>(data: string): T | null {
	if (!data || data === "[DONE]") return null;
	try {
		return JSON.parse(data) as T;
	} catch {
		return null;
	}
}
