import { describe, expect, it } from "vitest";
import { type CreatorStackFrame, parseCreatorStack } from "./errors.ts";

/**
 * The stack string is the creator's: any thrown object can carry its own `stack`, clipped only to
 * 16 KiB. Parsing it runs on the host after the VM call returned, where no interrupt reaches, so the
 * parser has to be linear in the line it reads.
 */

/**
 * The regular expressions the parser used to run. They are the reference for what a line means; the
 * parser no longer runs them because both backtrack quadratically on one long line.
 */
function referenceParse(stack: string): CreatorStackFrame[] {
	const frames: CreatorStackFrame[] = [];
	for (const raw of stack.split("\n")) {
		if (frames.length >= 64) break;
		const line = raw.trim();
		if (line.length === 0) continue;
		const located = /^at\s+(.*?)\s*\((.+?):(\d+):(\d+)\)$/.exec(line);
		if (located) {
			const [, fn, moduleId, ln, col] = located;
			if (moduleId?.startsWith("<")) continue;
			frames.push({
				functionName: fn && fn.length > 0 ? fn : null,
				moduleId: moduleId ?? null,
				line: Number(ln),
				column: Number(col),
			});
			continue;
		}
		const bare =
			/^at\s+(.*?)\s*\((.+?)\)$/.exec(line) ?? /^at\s+(.*)$/.exec(line);
		if (!bare) continue;
		const moduleId = bare[2] ?? null;
		if (moduleId?.startsWith("<")) continue;
		frames.push({
			functionName: bare[1] && bare[1].length > 0 ? bare[1] : null,
			moduleId,
			line: null,
			column: null,
		});
	}
	return frames;
}

/** A small deterministic generator, so a failure names the input that produced it. */
function lines(seed: number, count: number): string[] {
	const alphabet = ["a", "t", " ", "\t", "(", ")", ":", "1", "9", "<", "x"];
	let state = seed;
	const next = () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state;
	};
	const out: string[] = [];
	for (let i = 0; i < count; i += 1) {
		const length = next() % 14;
		let line = next() % 3 === 0 ? "at " : "";
		for (let j = 0; j < length; j += 1)
			line += alphabet[next() % alphabet.length];
		if (next() % 2 === 0) line += `:${next() % 50}:${next() % 50})`;
		out.push(line);
	}
	return out;
}

describe("creator stack parsing", () => {
	it("reads the frames the engine writes", () => {
		expect(
			parseCreatorStack(
				"    at boom (src/main.tsx:4:35)\n    at <anonymous> (src/a (b).ts:1:2)\n    at run (native)\n    at tail\n    at (src/x.ts:7:8)",
			),
		).toEqual([
			{ functionName: "boom", moduleId: "src/main.tsx", line: 4, column: 35 },
			{
				functionName: "<anonymous>",
				moduleId: "src/a (b).ts",
				line: 1,
				column: 2,
			},
			{ functionName: "run", moduleId: "native", line: null, column: null },
			{ functionName: "tail", moduleId: null, line: null, column: null },
			{ functionName: null, moduleId: "src/x.ts", line: 7, column: 8 },
		]);
	});

	it("means what the regular expressions meant, line for line", () => {
		for (let seed = 1; seed <= 200; seed += 1) {
			const stack = lines(seed, 40).join("\n");
			expect(parseCreatorStack(stack), `seed ${seed}`).toEqual(
				referenceParse(stack),
			);
		}
	});

	/**
	 * `at ` followed by thousands of ` (`: each regular expression tried every `(` as the opening of
	 * the module and then every split after it, about 175 ms per line on desktop V8, twice per line,
	 * on every failing execution. The budget never saw it.
	 *
	 * The check is the growth, not a time: a line four times as long takes about four times as long to
	 * read if the reading is linear, and about sixteen times if it is quadratic. Each side is the
	 * fastest of several interleaved runs, so load on the machine slows both sides alike instead of
	 * inflating the ratio, and an oversubscribed CI runner is not a reason for this to fail. The bound
	 * sits at 12, midway between the two: under heavy load a linear run was measured as high as 8.7,
	 * and the quadratic parser stays near 16.
	 */
	it("stays linear on one long hostile line", () => {
		const hostile = (pairs: number) => `at ${" (".repeat(pairs)}`;
		expect(growthOnFourfoldLine(parseCreatorStack, hostile)).toBeLessThan(12);
		expect(parseCreatorStack(hostile(2_000))).toEqual(
			referenceParse(hostile(2_000)),
		);
	});
});

/**
 * How much longer `parse` takes on `line(4n)` than on `line(n)`. A run repeats the parse until the
 * short line takes a couple of milliseconds, so timer resolution and call overhead do not decide it.
 */
function growthOnFourfoldLine(
	parse: (stack: string) => unknown,
	line: (size: number) => string,
): number {
	const short = line(2_000);
	const long = line(8_000);
	let repeats = 1;
	const timed = (input: string): number => {
		const started = performance.now();
		for (let i = 0; i < repeats; i += 1) parse(input);
		return performance.now() - started;
	};
	while (timed(short) < 2 && repeats < 1_000_000) repeats *= 2;
	let fastestShort = Number.POSITIVE_INFINITY;
	let fastestLong = Number.POSITIVE_INFINITY;
	for (let run = 0; run < 7; run += 1) {
		fastestShort = Math.min(fastestShort, timed(short));
		fastestLong = Math.min(fastestLong, timed(long));
	}
	return fastestLong / fastestShort;
}
