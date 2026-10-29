import { invalidStreamFrame } from "./errors.ts";

/**
 * Reads JSON values one at a time from a byte stream.
 *
 * Stream chunks do not align with frames. One chunk can hold several events, one JSON value can
 * span several chunks, and a multibyte character (for example Korean) can be cut in half at a chunk
 * boundary. A parser that assumes one chunk per event works locally and silently corrupts text on
 * real networks.
 *
 * Two layers handle this. TextDecoder with `{ stream: true }` joins split multibyte characters, and
 * a line buffer joins split frames. Parsing happens only on complete lines, because a partial line
 * may be truncated JSON.
 */

/**
 * Byte stream to JSON values.
 *
 * Does not validate value shape. Callers (each resource) know what they expect; this layer handles
 * only the one-JSON-per-line framing.
 *
 * A broken line is thrown, not skipped. Skipping silently would make a half-received stream look
 * like a normal end, and the screen would show a truncated response as complete.
 */
export async function* readNdjson(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	/**
	 * A complete line becomes a value. Empty lines are not frames; CRLF endings and the trailing
	 * newline produce them.
	 */
	const parseLine = (line: string): { value: unknown } | null => {
		const text = line.trim();
		if (!text) return null;
		try {
			return { value: JSON.parse(text) };
		} catch {
			throw invalidStreamFrame();
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				const parsed = parseLine(line);
				if (parsed) yield parsed.value;
			}
		}
		/**
		 * Flushes bytes left in the decoder. If the stream ends in the middle of a multibyte character, a
		 * replacement character appears here. It is better for the truncation to be visible.
		 */
		buffer += decoder.decode();
		// A last line closed without a trailing newline is still a complete frame. Dropping it would lose
		// the `done` event.
		const last = parseLine(buffer);
		if (last) yield last.value;
	} finally {
		/**
		 * On exit by break or error, always release the reader.
		 *
		 * `for await` with break, or an exception, calls the generator's return(), which runs this block.
		 * Without cancelling here, the socket stays open, the model keeps generating (the token cost is
		 * still incurred), and a browser's concurrent-connection slot stays occupied.
		 *
		 * `cancel()` can reject on an already closed stream. It is swallowed because this is a cleanup
		 * path.
		 */
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
