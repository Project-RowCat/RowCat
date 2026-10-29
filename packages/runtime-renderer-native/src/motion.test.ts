import { RUNTIME_MOTION_ABSENT } from "@rowcat/runtime/transition";
import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import { NativeRuntimeRendererError } from "./errors.ts";
import {
	axisTarget,
	motionTargetOf,
	planNativeMotion,
	transitionOf,
} from "./motion.ts";
import { resolveProps } from "./props.ts";
import { boxStyleOf } from "./styles.ts";

/**
 * Transition rules, tested as values. These are the same questions the web renderer's
 * motion.test.ts asks, answered differently: the web checks when the CSS declaration is applied,
 * while here we check which steps the plan contains. If the two answers diverge, the same work
 * moves differently on each platform.
 */

const props = (
	kind: Parameters<typeof resolveProps>[0],
	entries: Record<string, RuntimeHostValue>,
) => resolveProps(kind, new Map(Object.entries(entries)));

const target = (style: Record<string, RuntimeHostValue>) =>
	motionTargetOf(style as RuntimeHostValue);

const timing = { durationMs: 200, easing: "ease-out" } as const;

describe("motionTargetOf", () => {
	it("absent axes are null: a different fact from the neutral value", () => {
		expect(motionTargetOf(null)).toEqual(RUNTIME_MOTION_ABSENT);
		expect(target({ padding: 8 })).toEqual(RUNTIME_MOTION_ABSENT);
	});

	it("takes out only the axes written", () => {
		expect(target({ opacity: 0.5, translateY: 12, padding: 8 })).toEqual({
			opacity: 0.5,
			translateX: null,
			translateY: 12,
			scale: null,
		});
	});

	it("opacity folds to 0 to 1: the same rule as boxStyleOf", () => {
		expect(target({ opacity: 5 }).opacity).toBe(1);
		expect(target({ opacity: -1 }).opacity).toBe(0);
	});

	it("an absent axis's real target is the neutral value", () => {
		const value = target({ translateY: 12 });
		expect(axisTarget(value, "translateX")).toBe(0);
		expect(axisTarget(value, "scale")).toBe(1);
		expect(axisTarget(value, "opacity")).toBe(1);
		expect(axisTarget(value, "translateY")).toBe(12);
	});

	it.each([
		["string offset", { translateX: "10px" }],
		["Infinity", { translateY: Number.POSITIVE_INFINITY }],
		["negative scale", { scale: -1 }],
		["NaN opacity", { opacity: Number.NaN }],
	])("%s is a contract error", (_label, style) => {
		expect(() => target(style as Record<string, RuntimeHostValue>)).toThrow(
			NativeRuntimeRendererError,
		);
	});
});

describe("transitionOf", () => {
	it("defaults are filled in", () => {
		expect(transitionOf({} as RuntimeHostValue)).toEqual({
			durationMs: 200,
			easing: "ease",
		});
	});

	it.each([
		["string", "200ms"],
		["invalid easing", { easing: "spring" }],
		["negative duration", { duration: -1 }],
		["unknown key", { delay: 10 }],
	])("%s is a contract error", (_label, value) => {
		expect(() => transitionOf(value as RuntimeHostValue)).toThrow(
			NativeRuntimeRendererError,
		);
	});
});

describe("plan: when it is immediate and when it moves", () => {
	/**
	 * First application. Having a transition does not make the node animate on arrival: all four axes
	 * go to their targets with zero duration. This is the same rule and answer as the web, where
	 * arming happens at the end of the batch.
	 */
	it("the first application is immediate on all four", () => {
		const steps = planNativeMotion({
			previous: null,
			next: target({ opacity: 0, translateY: 8 }),
			transition: timing,
			reducedMotion: false,
		});
		expect(steps).toHaveLength(4);
		for (const step of steps) expect(step.durationMs).toBe(0);
	});

	it("only changed axes enter the plan", () => {
		const steps = planNativeMotion({
			previous: target({ opacity: 0, translateY: 8 }),
			next: target({ opacity: 1, translateY: 8 }),
			transition: timing,
			reducedMotion: false,
		});
		expect(steps).toEqual([
			{ axis: "opacity", to: 1, durationMs: 200, easing: "ease-out" },
		]);
	});

	/**
	 * Section 17 and 18. A commit that changes only the policy yields an empty plan when the target is
	 * unchanged, so a running animation is unaffected. The new policy applies from the next target
	 * change.
	 */
	it("the plan is empty when targets stay the same, even if only the policy changed", () => {
		const same = target({ opacity: 1 });
		expect(
			planNativeMotion({
				previous: same,
				next: target({ opacity: 1 }),
				transition: { durationMs: 400, easing: "linear" },
				reducedMotion: false,
			}),
		).toEqual([]);
	});

	it("immediate without a transition", () => {
		const steps = planNativeMotion({
			previous: target({ opacity: 0 }),
			next: target({ opacity: 1 }),
			transition: null,
			reducedMotion: false,
		});
		expect(steps).toEqual([
			{ axis: "opacity", to: 1, durationMs: 0, easing: "ease" },
		]);
	});

	it("duration 0 is the same as no transition", () => {
		const steps = planNativeMotion({
			previous: target({ opacity: 0 }),
			next: target({ opacity: 1 }),
			transition: { durationMs: 0, easing: "ease" },
			reducedMotion: false,
		});
		expect(steps[0]?.durationMs).toBe(0);
	});

	it("immediate when reduced motion is on: the target stays", () => {
		const steps = planNativeMotion({
			previous: target({ opacity: 0 }),
			next: target({ opacity: 1 }),
			transition: timing,
			reducedMotion: true,
		});
		expect(steps).toEqual([
			{ axis: "opacity", to: 1, durationMs: 0, easing: "ease-out" },
		]);
	});

	/**
	 * Clearing an axis produces a step that returns it to neutral. Without that step, the last
	 * transform would stay on screen.
	 */
	it("removing an axis returns to neutral", () => {
		const steps = planNativeMotion({
			previous: target({ translateY: 12 }),
			next: target({}),
			transition: timing,
			reducedMotion: false,
		});
		expect(steps).toEqual([
			{ axis: "translateY", to: 0, durationMs: 200, easing: "ease-out" },
		]);
	});

	it("rapid consecutive changes keep only the last target", () => {
		let previous = target({ opacity: 0 });
		let last: number | undefined;
		for (const opacity of [1, 0.2, 0.8]) {
			const next = target({ opacity });
			const steps = planNativeMotion({
				previous,
				next,
				transition: timing,
				reducedMotion: false,
			});
			last = steps[0]?.to;
			previous = next;
		}
		expect(last).toBe(0.8);
	});

	it("three axes changing together make three steps", () => {
		const steps = planNativeMotion({
			previous: target({ opacity: 0.25, translateY: 12, scale: 0.96 }),
			next: target({ opacity: 1, translateY: 0, scale: 1 }),
			transition: timing,
			reducedMotion: false,
		});
		expect(steps.map((step) => step.axis).sort()).toEqual([
			"opacity",
			"scale",
			"translateY",
		]);
	});
});

describe("static style transforms: where it is used without a transition", () => {
	it("three axes become one array, in the same order as the web", () => {
		expect(
			boxStyleOf({ translateX: 8, translateY: -4, scale: 0.96 }).transform,
		).toEqual([{ translateX: 8 }, { translateY: -4 }, { scale: 0.96 }]);
	});

	it("writing one axis leaves the rest neutral", () => {
		expect(boxStyleOf({ translateY: 12 }).transform).toEqual([
			{ translateX: 0 },
			{ translateY: 12 },
			{ scale: 1 },
		]);
	});

	it("no transform axes, no transform", () => {
		expect(boxStyleOf({ padding: 8 }).transform).toBeUndefined();
	});
});

describe("prop boundary", () => {
	it("the transition and the target ride separately", () => {
		const resolved = props("view", {
			style: { opacity: 0.5, translateY: 8 },
			transition: { duration: 180, easing: "ease-out" },
		});
		expect(resolved.transition).toEqual({
			durationMs: 180,
			easing: "ease-out",
		});
		expect(resolved.motion).toEqual({
			opacity: 0.5,
			translateX: null,
			translateY: 8,
			scale: null,
		});
		/**
		 * The static style holds the same values too. That is what a node without a transition is drawn
		 * with.
		 */
		expect(resolved.boxStyle?.opacity).toBe(0.5);
		expect(resolved.boxStyle?.transform).toEqual([
			{ translateX: 0 },
			{ translateY: 8 },
			{ scale: 1 },
		]);
	});

	it("null without a transition", () => {
		expect(props("view", { style: { opacity: 1 } }).transition).toBeNull();
	});

	/** Where `transition` is accepted matches where `style: RuntimeStyle` is accepted. */
	it.each([
		"view",
		"stack",
		"row",
		"scroll",
		"image",
		"pressable",
		"text-input",
		"text-area",
	] as const)("%s takes transition", (kind) => {
		expect(props(kind, { transition: { duration: 100 } }).transition).toEqual({
			durationMs: 100,
			easing: "ease",
		});
	});

	it.each([
		"text",
		"button",
		"progress",
		"screen",
	] as const)("%s does not take transition", (kind) => {
		expect(() => props(kind, { transition: { duration: 100 } })).toThrow(
			NativeRuntimeRendererError,
		);
	});

	it("a transition off contract fails that bundle", () => {
		expect(() => props("view", { transition: { easing: "spring" } })).toThrow(
			NativeRuntimeRendererError,
		);
	});
});
