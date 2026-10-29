/**
 * Haptic pattern values: what fires, and with what texture.
 *
 * This file is pure data. It imports neither Pulsar nor React Native, so it enters the test graph
 * and the rules on the values (length and amplitude ceilings) can be checked without a device.
 *
 * Values live in JS so that tuning is a Fast Refresh away instead of a native rebuild.
 *
 * The cue vocabulary is closed. Feature code names a `HapticCue` and does not choose amplitude or
 * length, because per-screen values would make the same event feel different on each screen, and
 * that mismatch shows up only as "something feels cheap". `HAPTIC_PATTERNS` is a `Record`, so
 * adding a cue without a pattern does not compile.
 *
 * System patterns whose meaning the OS has already taught (such as `selection`) are not here;
 * `index.ts` calls those directly. This table holds only moments specific to this product.
 */

/** Time is milliseconds from the start of the pattern. Amplitude and frequency are in 0–1. */
export interface HapticPattern {
	discretePattern: { time: number; amplitude: number; frequency: number }[];
	continuousPattern: {
		amplitude: { time: number; value: number }[];
		frequency: { time: number; value: number }[];
	};
}

export type HapticCue = "generationDone";

/**
 * Longest total length of one pattern. Most of the quality comes from brevity: a long buzz feels
 * like a toy, and if another action starts within it the two events read as one. Raise this only
 * with a written reason here.
 */
export const HAPTIC_PATTERN_MAX_MS = 150;

/**
 * Strongest single point. Haptics here confirm rather than alert, so this stays quieter than the
 * system's `notificationSuccess`.
 */
export const HAPTIC_PATTERN_MAX_AMPLITUDE = 0.6;

export const HAPTIC_PATTERNS: Record<HapticCue, HapticPattern> = {
	/**
	 * A response arrived and was saved: a landing.
	 *
	 * A soft continuous swell (80ms) ends in one round point. The low sharpness is the point: a high
	 * one reads as a "tick", which acknowledges a press rather than announcing that the wait is over.
	 * The continuous curve drops to 0 just before the point, because overlapping them blurs the end.
	 */
	generationDone: {
		discretePattern: [{ time: 90, amplitude: 0.5, frequency: 0.3 }],
		continuousPattern: {
			amplitude: [
				{ time: 0, value: 0 },
				{ time: 80, value: 0.3 },
				{ time: 88, value: 0 },
			],
			frequency: [
				{ time: 0, value: 0.15 },
				{ time: 88, value: 0.15 },
			],
		},
	},
};

/**
 * Whether the pattern is within this app's rules. Returns one sentence per violation, or an empty
 * array. Tuning often overshoots a limit, so the message names the point that did.
 */
export function checkHapticPattern(pattern: HapticPattern): string[] {
	const issues: string[] = [];
	const unit = (label: string, value: number) => {
		if (!(value >= 0 && value <= 1))
			issues.push(`${label} is outside 0–1: ${value}`);
	};
	const moment = (label: string, time: number) => {
		if (!(time >= 0 && time <= HAPTIC_PATTERN_MAX_MS))
			issues.push(
				`${label}'s time is outside 0–${HAPTIC_PATTERN_MAX_MS}ms: ${time}`,
			);
	};
	const loud = (label: string, value: number) => {
		if (value > HAPTIC_PATTERN_MAX_AMPLITUDE)
			issues.push(
				`${label} exceeds the cap ${HAPTIC_PATTERN_MAX_AMPLITUDE}: ${value}`,
			);
	};
	const ordered = (label: string, points: { time: number }[]) => {
		for (let index = 1; index < points.length; index++)
			if ((points[index]?.time ?? 0) < (points[index - 1]?.time ?? 0))
				issues.push(`${label}'s time goes backwards`);
	};

	for (const [index, point] of pattern.discretePattern.entries()) {
		moment(`point ${index}`, point.time);
		unit(`point ${index} intensity`, point.amplitude);
		unit(`point ${index} sharpness`, point.frequency);
		loud(`point ${index} intensity`, point.amplitude);
	}
	for (const [index, point] of pattern.continuousPattern.amplitude.entries()) {
		moment(`continuous intensity ${index}`, point.time);
		unit(`continuous intensity ${index}`, point.value);
		loud(`continuous intensity ${index}`, point.value);
	}
	for (const [index, point] of pattern.continuousPattern.frequency.entries()) {
		moment(`continuous sharpness ${index}`, point.time);
		unit(`continuous sharpness ${index}`, point.value);
	}
	ordered("points", pattern.discretePattern);
	ordered("continuous intensity", pattern.continuousPattern.amplitude);
	ordered("continuous sharpness", pattern.continuousPattern.frequency);
	return issues;
}
