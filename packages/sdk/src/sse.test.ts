import { describe, expect, it } from "vitest";
import { readSse, type SseFrame } from "./sse.ts";

/**
 * SSE parser. Repeatedly checks that chunks are not frames.
 *
 * Every test in this file uses deliberately odd chunk splits. Locally, one chunk carrying one event
 * is a coincidence. On real networks an event spans three chunks, one chunk holds five events, or a
 * multibyte character is cut in half. A parser that assumes one chunk per event works perfectly
 * until that moment.
 */

const encoder = new TextEncoder();

/** Emits the given byte pieces with their boundaries intact, so each piece is one chunk. */
const streamOf = (
	chunks: Array<string | Uint8Array>,
): ReadableStream<Uint8Array> =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(
					typeof chunk === "string" ? encoder.encode(chunk) : chunk,
				);
			controller.close();
		},
	});

const collect = async (
	chunks: Array<string | Uint8Array>,
): Promise<SseFrame[]> => {
	const frames: SseFrame[] = [];
	for await (const frame of readSse(streamOf(chunks))) frames.push(frame);
	return frames;
};

describe("framing", () => {
	it("reads named events", async () => {
		expect(await collect(['event: sync\ndata: {"cursor":11}\n\n'])).toEqual([
			{ event: "sync", data: '{"cursor":11}', id: "" },
		]);
	});

	it("without `event:` it is the spec default `message`", async () => {
		expect(await collect(["data: hello\n\n"])).toEqual([
			{ event: "message", data: "hello", id: "" },
		]);
	});

	it("extracts every event in one chunk", async () => {
		const frames = await collect([
			'event: sync\ndata: {"cursor":1}\n\nevent: sync\ndata: {"cursor":2}\n\nevent: sync\ndata: {"cursor":3}\n\n',
		]);
		expect(frames.map((frame) => frame.data)).toEqual([
			'{"cursor":1}',
			'{"cursor":2}',
			'{"cursor":3}',
		]);
	});

	it("joins chunks split mid-line", async () => {
		const frames = await collect([
			"event: sy",
			'nc\ndata: {"cur',
			'sor":42}',
			"\n",
			"\n",
		]);
		expect(frames).toEqual([{ event: "sync", data: '{"cursor":42}', id: "" }]);
	});

	/**
	 * A multibyte character is split at a chunk boundary. Without `TextDecoder`'s `{ stream: true }`,
	 * a replacement character appears here. The result is a non-reproducible bug where text sometimes
	 * garbles.
	 */
	it("text does not garble when split mid UTF-8 character", async () => {
		const bytes = encoder.encode("data: \uD55C\uAE00\uC774\uB2E4\n\n");
		const cut = 8; // Lands in the middle of the 3 bytes of U+D55C.
		const frames = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
		expect(frames[0].data).toBe("\uD55C\uAE00\uC774\uB2E4");
	});

	it("multiple `data:` lines join with newlines", async () => {
		expect(await collect(["data: first line\ndata: second line\n\n"])).toEqual([
			{ event: "message", data: "first line\nsecond line", id: "" },
		]);
	});

	it("only **one** space after the colon is consumed", async () => {
		expect((await collect(["data:  two spaces\n\n"]))[0].data).toBe(
			" two spaces",
		);
		expect((await collect(["data:nospace\n\n"]))[0].data).toBe("nospace");
	});

	it("dispatches only on a blank line; a truncated frame is not an event", async () => {
		// The stream ended without a terminating blank line. The frame is incomplete, so it is dropped.
		expect(await collect(['event: sync\ndata: {"cursor":9}\n'])).toEqual([]);
	});

	it("accepts CRLF and CR as line terminators", async () => {
		expect((await collect(["data: crlf\r\n\r\n"]))[0].data).toBe("crlf");
		expect((await collect(["data: cr\r\r"]))[0].data).toBe("cr");
	});

	/**
	 * When `\r` and `\n` fall in different chunks, they form one line terminator, not a blank line.
	 */
	it("a CRLF straddling a chunk boundary is not mistaken for a blank line", async () => {
		const frames = await collect(["data: split\r", "\n\r\n"]);
		expect(frames).toEqual([{ event: "message", data: "split", id: "" }]);
	});

	it("reads `id:` and `retry:` and ignores a non-integer retry", async () => {
		expect(await collect(["id: 7\nretry: 3000\ndata: x\n\n"])).toEqual([
			{ event: "message", data: "x", id: "7", retry: 3000 },
		]);
		expect(await collect(["retry: soon\ndata: x\n\n"])).toEqual([
			{ event: "message", data: "x", id: "" },
		]);
	});

	it("unknown fields are quietly dropped", async () => {
		expect(await collect(["laterfield: value\ndata: x\n\n"])).toEqual([
			{ event: "message", data: "x", id: "" },
		]);
	});

	it("a line without a colon is a field with an empty value", async () => {
		expect((await collect(["data\ndata: second\n\n"]))[0].data).toBe(
			"\nsecond",
		);
	});
});

describe("heartbeats", () => {
	/**
	 * If heartbeats became events, keeping the connection alive would mean synchronizing every 20
	 * seconds. That is the periodic polling this design chose not to build.
	 */
	it("comments make no events", async () => {
		expect(await collect([": ping\n\n"])).toEqual([]);
		expect(await collect([":\n\n"])).toEqual([]);
	});

	it("heartbeats between events do not break frames", async () => {
		const frames = await collect([
			": ping\n\n",
			'event: sync\ndata: {"cursor":5}\n\n',
			": ping\n\n",
			'event: sync\ndata: {"cursor":6}\n\n',
		]);
		expect(frames.map((frame) => frame.data)).toEqual([
			'{"cursor":5}',
			'{"cursor":6}',
		]);
	});

	it("`event:` without `data:` does not dispatch", async () => {
		expect(await collect(["event: sync\n\n"])).toEqual([]);
	});
});

describe("cleanup", () => {
	it("exiting with `break` releases the reader", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("data: 1\n\ndata: 2\n\n"));
			},
			cancel() {
				cancelled = true;
			},
		});

		for await (const frame of readSse(body)) {
			expect(frame.data).toBe("1");
			break;
		}
		expect(cancelled).toBe(true);
	});

	it("when the stream throws it keeps received frames and surfaces the error", async () => {
		let cancelled = false;
		let served = false;
		const body = new ReadableStream<Uint8Array>({
			// Emits one frame first, then disconnects on the next pull. This matches a real socket close.
			pull(controller) {
				if (!served) {
					served = true;
					controller.enqueue(encoder.encode("data: 1\n\n"));
					return;
				}
				controller.error(new Error("the socket dropped"));
			},
			cancel() {
				cancelled = true;
			},
		});

		const frames: SseFrame[] = [];
		await expect(async () => {
			for await (const frame of readSse(body)) frames.push(frame);
		}).rejects.toThrow("the socket dropped");
		expect(frames).toHaveLength(1);
		expect(cancelled).toBe(false);
	});
});
