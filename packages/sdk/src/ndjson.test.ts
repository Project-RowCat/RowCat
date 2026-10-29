import { describe, expect, it } from "vitest";
import { isRowCatApiError } from "./errors.ts";
import { readNdjson } from "./ndjson.ts";

/**
 * Framing tests run without network. A real provider cannot control the chunk boundaries under
 * test, and the risky case (one event split across three chunks) cannot be reproduced that way. The
 * test splits chunks by hand instead.
 */

const encoder = new TextEncoder();

/** Stream that emits the given pieces as-is. Each piece boundary is a chunk boundary. */
function streamOf(
	...chunks: (string | Uint8Array)[]
): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(
					typeof chunk === "string" ? encoder.encode(chunk) : chunk,
				);
			controller.close();
		},
	});
}

const collect = async (
	stream: ReadableStream<Uint8Array>,
): Promise<unknown[]> => {
	const out: unknown[] = [];
	for await (const value of readNdjson(stream)) out.push(value);
	return out;
};

describe("readNdjson", () => {
	it("one event per chunk", async () => {
		expect(await collect(streamOf('{"type":"delta","text":"a"}\n'))).toEqual([
			{ type: "delta", text: "a" },
		]);
	});

	it("several events in one chunk", async () => {
		// A fast provider really delivers several events in one chunk like this.
		expect(await collect(streamOf('{"n":1}\n{"n":2}\n{"n":3}\n'))).toEqual([
			{ n: 1 },
			{ n: 2 },
			{ n: 3 },
		]);
	});

	it("joins one event split across several chunks", async () => {
		expect(
			await collect(streamOf('{"type":"del', 'ta","text":"hel', 'lo"}\n')),
		).toEqual([{ type: "delta", text: "hello" }]);
	});

	it("reads a final frame without a trailing newline", async () => {
		/**
		 * Dropping this usually loses the `done` event. When the server omits the newline after the last
		 * line, every generation looks unfinished.
		 */
		expect(await collect(streamOf('{"a":1}\n{"type":"done"}'))).toEqual([
			{ a: 1 },
			{ type: "done" },
		]);
	});

	it("blank lines and CRLF are not frames", async () => {
		expect(await collect(streamOf('{"a":1}\r\n\n{"b":2}\r\n'))).toEqual([
			{ a: 1 },
			{ b: 2 },
		]);
	});

	it("a multibyte character split at a chunk boundary does not garble", async () => {
		/**
		 * a Hangul syllable (U+D55C) is 3 bytes in UTF-8, and real networks often split a chunk in the middle of a character.
		 * Without a streaming TextDecoder (`{ stream: true }`), the text garbles here.
		 */
		const bytes = encoder.encode('{"text":"\uD55C\uAE00"}\n');
		expect(
			await collect(streamOf(bytes.slice(0, 11), bytes.slice(11))),
		).toEqual([{ text: "\uD55C\uAE00" }]);
	});

	it("broken JSON fails rather than being skipped silently", async () => {
		/**
		 * Skipping would make a response with a missing middle look like a normal finish. A gap in a
		 * stream does not show on screen, so failing here is better.
		 */
		await expect(collect(streamOf('{"a":1}\n{"b":\n'))).rejects.toSatisfy(
			(error: unknown) =>
				isRowCatApiError(error) && error.code === "invalid_stream_frame",
		);
	});

	it("stopping midway releases the reader", async () => {
		/**
		 * If the socket stays open, the model keeps generating and the token cost is still incurred.
		 * Checks that `break` runs the generator's finally block and reaches cancellation.
		 */
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('{"a":1}\n{"a":2}\n'));
			},
			cancel() {
				cancelled = true;
			},
		});

		for await (const _ of readNdjson(stream)) break;
		expect(cancelled).toBe(true);
	});
});
