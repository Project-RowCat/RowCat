import { describe, expect, it } from "vitest";
import {
	createInteractionRecorder,
	summarizeInteractionLatency,
} from "./metrics.ts";

describe("Summary", () => {
	it("discards the warm-up", () => {
		const samples = [100, 100, 100, 10, 20, 30];
		expect(summarizeInteractionLatency(samples, 3)).toEqual({
			samples: 3,
			medianMs: 20,
			p95Ms: 30,
			p99Ms: 30,
			minMs: 10,
			maxMs: 30,
		});
	});

	it("without samples it doesn't invent numbers", () => {
		expect(summarizeInteractionLatency([], 0)).toBeNull();
		expect(summarizeInteractionLatency([1, 2], 5)).toBeNull();
	});

	it("percentiles don't interpolate", () => {
		const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const summary = summarizeInteractionLatency(samples, 0);
		/** Nearest rank: a value that was not in the samples never becomes the answer. */
		expect(summary?.medianMs).toBe(5);
		expect(summary?.p95Ms).toBe(10);
		expect(samples).toContain(summary?.p95Ms);
	});
});

describe("pairing", () => {
	it("commits with no waiting event aren't counted", () => {
		const recorder = createInteractionRecorder();
		/** A commit made by a creator's `setState` chain: it belongs to no event. */
		recorder.commit(10);
		expect(recorder.samples).toEqual([]);
		recorder.begin(100);
		recorder.commit(112);
		expect(recorder.samples).toEqual([12]);
		/** A second commit for the same event is not counted either. */
		recorder.commit(200);
		expect(recorder.samples).toEqual([12]);
	});

	it("discarded events don't become samples", () => {
		const recorder = createInteractionRecorder();
		recorder.begin(0);
		recorder.abandon();
		recorder.commit(50);
		expect(recorder.samples).toEqual([]);
	});
});
