import { describe, expect, it } from "vitest";
import {
	GENERATION_HAPTIC_MIN_WAIT_MS,
	signalsGenerationDone,
} from "./completion-haptic.ts";

const waited = {
	end: "completed" as const,
	saved: true,
	startedAt: 1_000,
	endedAt: 1_000 + GENERATION_HAPTIC_MIN_WAIT_MS,
	focused: true,
	foreground: true,
};

describe("signalsGenerationDone", () => {
	it("buzzes when a normal reply was saved after waiting", () => {
		expect(signalsGenerationDone(waited)).toBe(true);
	});

	it("the boundary is inclusive — waiting exactly that long buzzes", () => {
		expect(
			signalsGenerationDone({
				...waited,
				endedAt: waited.startedAt + GENERATION_HAPTIC_MIN_WAIT_MS,
			}),
		).toBe(true);
		expect(
			signalsGenerationDone({
				...waited,
				endedAt: waited.startedAt + GENERATION_HAPTIC_MIN_WAIT_MS - 1,
			}),
		).toBe(false);
	});

	it("stopping doesn't buzz — the user already knows", () => {
		expect(signalsGenerationDone({ ...waited, end: "stopped" })).toBe(false);
	});

	it("failure doesn't buzz — failure has its own indicator", () => {
		expect(signalsGenerationDone({ ...waited, end: "failed" })).toBe(false);
	});

	it("an unsaved turn doesn't buzz — an empty body or lost ownership", () => {
		expect(signalsGenerationDone({ ...waited, saved: false })).toBe(false);
	});

	it("doesn't buzz when that conversation isn't being viewed", () => {
		expect(signalsGenerationDone({ ...waited, focused: false })).toBe(false);
	});

	it("doesn't buzz when the app is in the background", () => {
		expect(signalsGenerationDone({ ...waited, foreground: false })).toBe(false);
	});
});
