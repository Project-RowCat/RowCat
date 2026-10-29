import { describe, expect, it } from "vitest";
import { streamOf } from "../../test/byo-fetch.ts";
import { parseSseData, readSse } from "./sse.ts";

/**
 * SSE framing — **chunk boundaries have nothing to do with frame boundaries.**
 *
 * The failures this file guards against are hard to reproduce: "the response occasionally loses a
 * character", "JSON parsing fails only on long responses". Both happen when one delta spans two
 * chunks, and that becomes more common the slower the network.
 */

const collect = async (chunks: readonly string[]) => {
	const frames: { event: string; data: string }[] = [];
	for await (const frame of readSse(streamOf(chunks))) frames.push(frame);
	return frames;
};

describe("frame boundaries", () => {
	it("a blank line separates frames", async () => {
		expect(await collect(["data: one\n\ndata: two\n\n"])).toEqual([
			{ event: "", data: "one" },
			{ event: "", data: "two" },
		]);
	});

	/** This check is the reason this file exists: one frame arrives across three chunks. */
	it("frames assemble intact even when a chunk breaks mid-frame", async () => {
		expect(await collect(['data: {"a"', ":1}\n", "\n"])).toEqual([
			{ event: "", data: '{"a":1}' },
		]);
	});

	it("several frames in one chunk come out in order", async () => {
		expect(await collect(["data: 1\n\ndata: 2\n\ndata: 3\n\n"])).toEqual([
			{ event: "", data: "1" },
			{ event: "", data: "2" },
			{ event: "", data: "3" },
		]);
	});

	/**
	 * A final frame may end without a blank line. Dropping it would lose a terminal event and record a
	 * normal completion as truncated.
	 */
	it("a last frame ending without a blank line comes out too", async () => {
		expect(await collect(["data: last\n"])).toEqual([
			{ event: "", data: "last" },
		]);
	});

	it("reads event lines", async () => {
		expect(await collect(["event: message_stop\ndata: {}\n\n"])).toEqual([
			{ event: "message_stop", data: "{}" },
		]);
	});

	/** Some implementations send CRLF. Leaving the `\r` in would break `JSON.parse`. */
	it("removes CRLF", async () => {
		expect(await collect(['data: {"a":1}\r\n\r\n'])).toEqual([
			{ event: "", data: '{"a":1}' },
		]);
	});

	/**
	 * **Gemini BYO was entirely broken for a while without this check.**
	 *
	 * The single-frame checks above pass even when boundary detection is wrong, because at stream end
	 * the leftover buffer is read as one final frame. Once there are two frames, that path
	 * concatenates them into one string, which fails in `JSON.parse`; the adapter then gets neither
	 * deltas nor a terminal event and ends with `provider_error`. Google sends this format.
	 */
	it("several CRLF frames each come out", async () => {
		expect(
			await collect(['data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n']),
		).toEqual([
			{ event: "", data: '{"a":1}' },
			{ event: "", data: '{"a":2}' },
		]);
	});

	/** A chunk split inside a CRLF (after `\r`) still gives the same boundaries. */
	it("frames split even when a chunk breaks between CR and LF", async () => {
		expect(await collect(["data: one\r\n\r", "\ndata: two\r\n\r\n"])).toEqual([
			{ event: "", data: "one" },
			{ event: "", data: "two" },
		]);
	});

	/** The spec also accepts a lone CR as a line ending. */
	it("CR alone ends lines and frames too", async () => {
		expect(await collect(["data: one\r\rdata: two\r\r"])).toEqual([
			{ event: "", data: "one" },
			{ event: "", data: "two" },
		]);
	});

	it("joins multiple data lines with newlines", async () => {
		expect(await collect(["data: up\ndata: down\n\n"])).toEqual([
			{ event: "", data: "up\ndown" },
		]);
	});

	/** A block without `data:` is not a frame (keep-alives, comments). */
	it("blocks without data don't stream", async () => {
		expect(await collect([": ping\n\ndata: real\n\n"])).toEqual([
			{ event: "", data: "real" },
		]);
	});

	/** Multi-byte characters split across chunk boundaries must still decode intact (streaming decoder). */
	it("Hangul cut at a byte boundary stays intact", async () => {
		const encoder = new TextEncoder();
		const bytes = encoder.encode("data: \uc548\ub155\ud558\uc138\uc694\n\n");
		const head = bytes.slice(0, 9);
		const tail = bytes.slice(9);
		const frames: { event: string; data: string }[] = [];
		let index = 0;
		const parts = [head, tail];
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (index >= parts.length) {
					controller.close();
					return;
				}
				const part = parts[index];
				index += 1;
				if (part) controller.enqueue(part);
			},
		});
		for await (const frame of readSse(stream)) frames.push(frame);
		expect(frames).toEqual([
			{ event: "", data: "\uc548\ub155\ud558\uc138\uc694" },
		]);
	});
});

describe("data parsing", () => {
	it("reads JSON", () => {
		expect(parseSseData<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
	});

	/**
	 * **Does not throw on broken lines.** Non-spec lines a provider emits are outside our control, and
	 * throwing would end a healthy generation for someone else's reason.
	 */
	it("skips broken JSON", () => {
		expect(parseSseData("{not json")).toBeNull();
		expect(parseSseData("")).toBeNull();
		expect(parseSseData("[DONE]")).toBeNull();
	});
});
