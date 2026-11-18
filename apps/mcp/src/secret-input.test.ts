import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { readSecret } from "./secret-input.ts";

describe("readSecret", () => {
	/**
	 * A readline question asked before the secret (the API address, which `ask()` reads) closes
	 * readline, and `close()` pauses the input, so without resuming the stream the value never
	 * arrives (a silent exit 0 in a real process — the order the old email-then-password sign-in
	 * followed when this was found).
	 */
	test("reads even from input readline paused", async () => {
		const input = new PassThrough();
		const rl = createInterface({ input, output: new PassThrough() });
		const asked = rl.question("RowCat API address: ");
		input.write("https://api.rowcat.test/v2\n");
		expect(await asked).toBe("https://api.rowcat.test/v2");
		rl.close();
		expect(input.isPaused()).toBe(true);

		const secret = readSecret(input);
		input.write("s3cret\r");
		expect(await secret).toEqual({ kind: "value", value: "s3cret" });
	});

	test("collects UTF-8 input character for character, even when cut at chunk boundaries", async () => {
		const input = new PassThrough();
		const secret = readSecret(input);
		const bytes = Buffer.from("\ube44\ubc00\ubc88\ud6381\r", "utf8");
		input.write(bytes.subarray(0, 2));
		input.write(bytes.subarray(2));
		expect(await secret).toEqual({
			kind: "value",
			value: "\ube44\ubc00\ubc88\ud6381",
		});
	});

	test("backspace removes the last character, not a byte", async () => {
		const input = new PassThrough();
		const secret = readSecret(input);
		input.write(Buffer.from("\uac00\ub098\u007f\ub2e4\r", "utf8"));
		expect(await secret).toEqual({ kind: "value", value: "\uac00\ub2e4" });
	});

	test("Ctrl+C is not a value", async () => {
		const input = new PassThrough();
		const secret = readSecret(input);
		input.write("ab");
		expect(await secret).toEqual({ kind: "interrupted" });
	});

	test("returns the collected value when input ends without a line break", async () => {
		const input = new PassThrough();
		const secret = readSecret(input);
		input.end("tail");
		expect(await secret).toEqual({ kind: "value", value: "tail" });
	});
});
