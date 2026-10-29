/**
 * SSE frame reader. Pulls `text/event-stream` events one at a time from a byte stream.
 *
 * - Lives beside `ndjson.ts` because the framing differs. NDJSON is one line per value; SSE is
 *   several field lines followed by a blank line per event. Imitating one with the other (stripping
 *   `data:` and feeding an NDJSON parser) would silently drop comments, multiple `data` lines, and
 *   event names. The stream would still claim to be SSE without following the SSE spec.
 * - The native `EventSource` is not used. See the `wakeStream` comment in `sync.ts`.
 * - Chunk boundaries have nothing to do with frame boundaries. TextDecoder with `{ stream: true
 *   }` joins multibyte characters, and a line buffer joins frames.
 * - Deliberately not implemented: automatic reconnection and `retry:` handling. Reconnecting is
 *   the caller's lifecycle, not the parser's job; the value is passed along and the caller decides
 *   when to reconnect. `Last-Event-ID` replay is also left out. Durable cursors solve the same
 *   problem more precisely, so the server keeps no event log to rewind.
 */

/**
 * A complete event. Per the spec, events with empty `data` are not dispatched, so they never arrive
 * here.
 */
export interface SseFrame {
	/** The `event:` field. Defaults to the spec value `message` when absent. */
	event: string;
	/** `data:` lines joined with `\n`. The trailing newline is removed per the spec. */
	data: string;
	/** The `id:` field. Empty string when absent. */
	id: string;
	/** The `retry:` field in ms. Per the spec, non-integers are ignored, so they never arrive here. */
	retry?: number;
}

/**
 * Byte stream to SSE events.
 *
 * Does not validate value shape. Callers (each resource) know what they expect; this layer handles
 * framing only. `data` is passed as a string and is not JSON-parsed.
 */
export async function* readSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	let event = "";
	let data: string[] = [];
	let id = "";
	let retry: number | undefined;
	let sawField = false;

	const reset = (): void => {
		event = "";
		data = [];
		id = "";
		retry = undefined;
		sawField = false;
	};

	/**
	 * A blank line dispatches the event. Per the spec, an event with no `data` is discarded. A blank
	 * line after a heartbeat, or a frame holding only `event:`, therefore never leaks out as an empty
	 * event.
	 */
	const dispatch = (): SseFrame | null => {
		if (data.length === 0) {
			reset();
			return null;
		}
		const frame: SseFrame = {
			event: event || "message",
			data: data.join("\n"),
			id,
			...(retry !== undefined ? { retry } : {}),
		};
		reset();
		return frame;
	};

	/** Reads one line as a field. A return value means that line completed the event. */
	const takeLine = (line: string): SseFrame | null => {
		if (line === "") return sawField ? dispatch() : null;
		// A line starting with `:` is a comment. Heartbeats such as `: ping` disappear here silently.
		if (line.startsWith(":")) return null;

		sawField = true;
		const colon = line.indexOf(":");
		// A line with no colon is a field name with an empty value (spec 4.2). It is not discarded.
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? "" : line.slice(colon + 1);
		// Only one space after the colon is consumed. If there are two, the second is part of the value.
		if (value.startsWith(" ")) value = value.slice(1);

		switch (field) {
			case "event":
				event = value;
				break;
			case "data":
				data.push(value);
				break;
			case "id":
				// Per the spec, an id containing NUL is ignored.
				if (!value.includes("\0")) id = value;
				break;
			case "retry":
				// A non-integer is ignored without throwing. Unknown fields are ignored the same way.
				if (/^\d+$/.test(value)) retry = Number(value);
				break;
			default:
				break;
		}
		return null;
	};

	/**
	 * Pulls complete lines from the buffer. All three terminators are accepted: `\r\n`, `\n`, and
	 * `\r`. The server only writes `\n`, but a proxy in between may rewrite line endings, and the spec
	 * allows all three.
	 *
	 * When not final, a `\r` at the end of the buffer is not treated as a complete line. If the next
	 * chunk starts with `\n`, the two form one terminator. Cutting here would create a spurious blank
	 * line and split the event in half. This defect occurs only at chunk boundaries.
	 *
	 * After the stream ends there is no next chunk, so a trailing `\r` is the terminator.
	 */
	const takeFrames = (final: boolean): SseFrame[] => {
		const frames: SseFrame[] = [];
		for (;;) {
			const match = /\r\n|\n|\r/.exec(buffer);
			if (!match) break;
			if (!final && match[0] === "\r" && match.index === buffer.length - 1)
				break;
			const line = buffer.slice(0, match.index);
			buffer = buffer.slice(match.index + match[0].length);
			const frame = takeLine(line);
			if (frame) frames.push(frame);
		}
		return frames;
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			for (const frame of takeFrames(false)) yield frame;
		}

		/**
		 * Flushes bytes left in the decoder. If the stream ends mid-character, a replacement character
		 * appears here, which is better than hiding the truncation.
		 *
		 * Lines that had a terminator are processed here. The last line without a terminator is
		 * discarded. Per the spec, a frame without its terminating blank line is incomplete. Treating it
		 * as complete would turn truncated JSON into an event.
		 */
		buffer += decoder.decode();
		for (const frame of takeFrames(true)) yield frame;
	} finally {
		/**
		 * On exit by break or error, always release the reader.
		 *
		 * Without cancelling, the socket stays open and occupies a browser concurrent-connection slot.
		 * The server also keeps a dead subscription, because unsubscription depends on the connection
		 * closing.
		 *
		 * `cancel()` can reject on an already closed stream. It is swallowed because this is a cleanup
		 * path.
		 */
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
