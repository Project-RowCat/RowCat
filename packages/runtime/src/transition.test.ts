import { describe, expect, it } from "vitest";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";
import { normalizeHostProps } from "./internal/host-props.ts";
import {
	checkRuntimeScale,
	checkRuntimeTranslate,
	classifyRuntimeTransition,
	RUNTIME_EASING_BEZIER,
	RUNTIME_EASINGS,
	RUNTIME_MOTION_NEUTRAL,
	RUNTIME_SCALE_LIMIT,
	RUNTIME_TRANSITION_DEFAULT_DURATION_MS,
	RUNTIME_TRANSITION_DEFAULT_EASING,
	RUNTIME_TRANSITION_MAX_DURATION_MS,
	RUNTIME_TRANSLATE_LIMIT,
} from "./transition.ts";

/**
 * The contract for transitions, and what the VM boundary rejects in practice. Types are not the
 * boundary. Every invalid value below passes the type checker when built with `as` or computation,
 * so rejection must be checked at runtime.
 */

describe("classifyRuntimeTransition", () => {
	it("an empty object is filled with defaults", () => {
		const verdict = classifyRuntimeTransition({});
		expect(verdict).toEqual({
			ok: true,
			transition: {
				durationMs: RUNTIME_TRANSITION_DEFAULT_DURATION_MS,
				easing: RUNTIME_TRANSITION_DEFAULT_EASING,
			},
		});
	});

	it("written values beat the defaults", () => {
		expect(
			classifyRuntimeTransition({ duration: 180, easing: "ease-out" }),
		).toEqual({
			ok: true,
			transition: { durationMs: 180, easing: "ease-out" },
		});
	});

	it("0 is valid: it means immediate, not an invalid value", () => {
		const verdict = classifyRuntimeTransition({ duration: 0 });
		expect(verdict.ok).toBe(true);
		expect(verdict.ok && verdict.transition.durationMs).toBe(0);
	});

	it("accepts all five easings", () => {
		for (const easing of RUNTIME_EASINGS)
			expect(classifyRuntimeTransition({ easing }).ok).toBe(true);
	});

	/**
	 * Invalid values are rejected, not silently clamped. Clamping would make creators believe the
	 * value they wrote is in effect, and the mistake would appear only in code that computes values.
	 */
	it.each([
		["negative", { duration: -1 }],
		["NaN", { duration: Number.NaN }],
		["Infinity", { duration: Number.POSITIVE_INFINITY }],
		["over the cap", { duration: RUNTIME_TRANSITION_MAX_DURATION_MS + 1 }],
		["non-numeric duration", { duration: "200" }],
		["easing off the vocabulary", { easing: "spring" }],
		["CSS bezier string", { easing: "cubic-bezier(0,0,1,1)" }],
		["steps", { easing: "steps(4)" }],
		["unknown key", { delay: 100 }],
		["unknown key alongside valid keys", { duration: 100, repeat: 2 }],
		["not an object", 200],
		["array", []],
		["null", null],
	])("%s is refused", (_label, value) => {
		expect(classifyRuntimeTransition(value).ok).toBe(false);
	});

	/** Reasons are returned as values, so the two renderers and the VM produce the same message. */
	it("refusals carry a reason", () => {
		const verdict = classifyRuntimeTransition({ easing: "spring" });
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.reason).toContain("easing");
	});

	it("an undefined value is the same as a missing key", () => {
		expect(
			classifyRuntimeTransition({ duration: undefined, easing: undefined }),
		).toEqual({
			ok: true,
			transition: {
				durationMs: RUNTIME_TRANSITION_DEFAULT_DURATION_MS,
				easing: RUNTIME_TRANSITION_DEFAULT_EASING,
			},
		});
	});
});

describe("the easing's source is one control point table", () => {
	it("all five words have control points", () => {
		for (const easing of RUNTIME_EASINGS)
			expect(RUNTIME_EASING_BEZIER[easing]).toHaveLength(4);
	});

	/**
	 * Checks the real curves of the CSS keywords. If these values drift, the web and native platforms
	 * draw different curves under the same name. This table exists because React Native's
	 * `Easing.ease` is not CSS's `ease`.
	 */
	it("matches the curves of the CSS keywords", () => {
		expect(RUNTIME_EASING_BEZIER.linear).toEqual([0, 0, 1, 1]);
		expect(RUNTIME_EASING_BEZIER.ease).toEqual([0.25, 0.1, 0.25, 1]);
		expect(RUNTIME_EASING_BEZIER["ease-in"]).toEqual([0.42, 0, 1, 1]);
		expect(RUNTIME_EASING_BEZIER["ease-out"]).toEqual([0, 0, 0.58, 1]);
		expect(RUNTIME_EASING_BEZIER["ease-in-out"]).toEqual([0.42, 0, 0.58, 1]);
	});
});

describe("transform axis ranges", () => {
	it("finite numbers pass", () => {
		expect(checkRuntimeTranslate(0)).toBeNull();
		expect(checkRuntimeTranslate(-12.5)).toBeNull();
		expect(checkRuntimeScale(0)).toBeNull();
		expect(checkRuntimeScale(1)).toBeNull();
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		"10px",
		null,
	])("offset %s is refused", (value) => {
		expect(checkRuntimeTranslate(value)).not.toBeNull();
	});

	it("offsets past the cap are refused", () => {
		expect(checkRuntimeTranslate(RUNTIME_TRANSLATE_LIMIT + 1)).not.toBeNull();
		expect(checkRuntimeTranslate(-RUNTIME_TRANSLATE_LIMIT - 1)).not.toBeNull();
	});

	/**
	 * A negative scale is rejected because flipping is not part of this version's vocabulary. A scale
	 * above the limit is rejected too.
	 */
	it("negative and over-cap scales are refused", () => {
		expect(checkRuntimeScale(-1)).not.toBeNull();
		expect(checkRuntimeScale(RUNTIME_SCALE_LIMIT + 1)).not.toBeNull();
		expect(checkRuntimeScale(Number.NaN)).not.toBeNull();
	});

	/**
	 * An axis that is not written takes its neutral value (translate 0, scale 1, opacity 1), not the
	 * current value. Both renderers read these values together.
	 */
	it("neutral values are offset 0 · scale 1 · opacity 1", () => {
		expect(RUNTIME_MOTION_NEUTRAL).toEqual({
			opacity: 1,
			translateX: 0,
			translateY: 0,
			scale: 1,
		});
	});
});

/* VM boundary: values, not types, enforce these rules. */

const normalize = (
	kind: Parameters<typeof normalizeHostProps>[1],
	props: Record<string, unknown>,
) => normalizeHostProps(props, kind);

const rejects = (
	kind: Parameters<typeof normalizeHostProps>[1],
	props: Record<string, unknown>,
): void => {
	let error: unknown = null;
	try {
		normalize(kind, props);
	} catch (thrown) {
		error = thrown;
	}
	expect(error).toBeInstanceOf(RuntimeError);
	expect((error as RuntimeError).code).toBe(RUNTIME_ERROR_CODE.invalidHostProp);
};

describe("the VM boundary refuses transitions", () => {
	it("valid transitions ride as is", () => {
		const { values } = normalize("view", {
			transition: { duration: 180, easing: "ease-out" },
		});
		expect(values.transition).toEqual({ duration: 180, easing: "ease-out" });
	});

	it.each([
		["negative duration", { duration: -1 }],
		["Infinity", { duration: Number.POSITIVE_INFINITY }],
		["NaN", { duration: Number.NaN }],
		["over the cap", { duration: RUNTIME_TRANSITION_MAX_DURATION_MS + 1 }],
		["easing off the vocabulary", { easing: "spring" }],
		["unknown key", { delay: 10 }],
	])("%s is runtime_invalid_host_prop", (_label, transition) => {
		rejects("view", { transition });
	});

	/**
	 * `Infinity` is caught by the normalization step, which rejects non-finite numbers. The rejection
	 * still goes through the same code path. Creators should receive the same class of error whichever
	 * check fires.
	 */
	it("out-of-range transform values are refused", () => {
		rejects("view", { style: { translateX: Number.POSITIVE_INFINITY } });
		rejects("view", { style: { translateY: Number.NaN } });
		rejects("view", { style: { scale: -1 } });
		rejects("view", { style: { scale: 1e9 } });
		rejects("view", { style: { translateX: RUNTIME_TRANSLATE_LIMIT + 1 } });
	});

	it("in-range transforms ride as is", () => {
		const { values } = normalize("stack", {
			style: { translateX: 8, translateY: -4, scale: 0.96 },
		});
		expect(values.style).toEqual({
			translateX: 8,
			translateY: -4,
			scale: 0.96,
		});
	});

	/**
	 * Every kind whose `style` is `RuntimeStyle` goes through the same check. Testing only one kind
	 * would let an invalid value reach the renderer from the others, and then the whole bundle would
	 * fail.
	 */
	it.each([
		"view",
		"stack",
		"row",
		"scroll",
		"image",
		"pressable",
		"text-input",
		"text-area",
	] as const)("%s passes the same check too", (kind) => {
		rejects(kind, { transition: { easing: "spring" } });
		rejects(kind, { style: { scale: -1 } });
	});
});
