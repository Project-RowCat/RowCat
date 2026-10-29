// @vitest-environment jsdom
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebRuntimeRendererError } from "./errors.ts";
import {
	applyTransitionCss,
	easingCss,
	transitionActive,
	WEB_TRANSITION_PROPERTY,
} from "./motion.ts";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "./renderer.ts";

/**
 * Tests transitions across the real renderer boundary rather than re-implementing interpolation
 * math. The renderer only decides when the browser may interpolate, so the tests check when the
 * transition declarations are set and removed. jsdom does not paint frames; the browser does the
 * interpolation.
 *
 * The tests apply the commit bundle instead of calling helpers. Checking only transitionCss()
 * values would pass even if nothing calls that function, and that state looks the same as the
 * feature missing.
 */

interface Harness {
	renderer: WebRuntimeRenderer;
	root: HTMLElement;
	revision: number;
	apply(patches: RuntimePatchBatch["patches"]): void;
	node(id: number): HTMLElement;
	failures: WebRuntimeRendererError[];
}

let matches = false;
let listeners: (() => void)[] = [];

function mount(): Harness {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const failures: WebRuntimeRendererError[] = [];
	const renderer = createWebRuntimeRenderer({
		container,
		dispatchEvent: () => {},
		resolveAsset: () => null,
		onFailure: (error) => failures.push(error),
	});
	const root = container.shadowRoot?.querySelector(
		'[data-rc="root"]',
	) as HTMLElement;
	const harness: Harness = {
		renderer,
		root,
		revision: 0,
		failures,
		apply(patches) {
			harness.revision += 1;
			renderer.apply({ revision: harness.revision, patches });
		},
		node(id) {
			return renderer.node(id) as HTMLElement;
		},
	};
	return harness;
}

beforeEach(() => {
	matches = false;
	listeners = [];
	/**
	 * jsdom has no `matchMedia`. The renderer reads that absence as reduced motion being off, so this
	 * stub exists to exercise the settings-change path.
	 */
	vi.stubGlobal("matchMedia", (query: string) => ({
		media: query,
		get matches() {
			return matches;
		},
		addEventListener: (_type: string, listener: () => void) => {
			listeners.push(listener);
		},
		removeEventListener: (_type: string, listener: () => void) => {
			listeners = listeners.filter((entry) => entry !== listener);
		},
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

const setReduced = (next: boolean): void => {
	matches = next;
	for (const listener of [...listeners]) listener();
};

const declarations = (element: HTMLElement) => ({
	property: element.style.getPropertyValue("transition-property"),
	duration: element.style.getPropertyValue("transition-duration"),
	timing: element.style.getPropertyValue("transition-timing-function"),
});

const armed = (element: HTMLElement): boolean =>
	declarations(element).property === WEB_TRANSITION_PROPERTY;

/**
 * Creates a box with a transition: creates it, sets its props, and inserts it. The three steps must
 * stay in one batch, because the node arms when that batch ends (see motion.ts).
 */
function box(
	harness: Harness,
	style: Record<string, unknown> | null,
	transition: Record<string, unknown> | null,
): HTMLElement {
	harness.apply([
		{ op: "create", id: 1, kind: "view" },
		...(transition === null
			? []
			: ([
					{ op: "set-prop", id: 1, name: "transition", value: transition },
				] as const)),
		...(style === null
			? []
			: ([{ op: "set-prop", id: 1, name: "style", value: style }] as const)),
		{ op: "insert", parent: 0, child: 1, index: 0 },
	] as RuntimePatchBatch["patches"]);
	return harness.node(1);
}

describe("does not move when first drawn", () => {
	/**
	 * This rule is the easiest one to break silently. Arming at the point a prop is set, instead of at
	 * the end of the batch, would fade in the whole first screen, which the author never asked for.
	 *
	 * The gate itself is tested as a function: an unarmed node gets no declarations at all.
	 */
	it("no declaration stands on an unarmed node", () => {
		const element = document.createElement("div");
		applyTransitionCss(
			element,
			{ transition: { durationMs: 200, easing: "ease" }, armed: false },
			false,
		);
		expect(declarations(element)).toEqual({
			property: "",
			duration: "",
			timing: "",
		});
		expect(
			transitionActive(
				{ transition: { durationMs: 200, easing: "ease" }, armed: false },
				false,
			),
		).toBe(false);
	});

	it("the declaration stands only after arming", () => {
		const element = document.createElement("div");
		applyTransitionCss(
			element,
			{ transition: { durationMs: 200, easing: "ease" }, armed: true },
			false,
		);
		expect(declarations(element).duration).toBe("200ms");
	});

	/**
	 * Arming happens at the end of the batch. Arming during a batch that fails partway would leave the
	 * node holding its declarations into the next session, even after the renderer has failed.
	 */
	it("a failed bundle arms nothing", () => {
		const harness = mount();
		expect(() =>
			harness.apply([
				{ op: "create", id: 1, kind: "view" },
				{ op: "set-prop", id: 1, name: "transition", value: { duration: 200 } },
				{ op: "insert", parent: 0, child: 1, index: 0 },
				{ op: "set-prop", id: 99, name: "style", value: {} },
			] as RuntimePatchBatch["patches"]),
		).toThrow(WebRuntimeRendererError);
		expect(harness.renderer.failed).toBe(true);
	});

	/**
	 * The node arms when the batch that built it ends, so only value changes in later batches animate.
	 * Together these two rules mean entrances do not animate and changes do.
	 */
	it("changes after the creating bundle take the transition", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0.25 }, { duration: 200 });
		expect(armed(element)).toBe(true);
		harness.apply([
			{ op: "set-prop", id: 1, name: "style", value: { opacity: 1 } },
		] as RuntimePatchBatch["patches"]);
		expect(element.style.opacity).toBe("1");
		expect(declarations(element).duration).toBe("200ms");
	});
});

describe("transition declaration", () => {
	it("no transition, no declaration", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0.5 }, null);
		expect(declarations(element)).toEqual({
			property: "",
			duration: "",
			timing: "",
		});
	});

	it("transitions only opacity and transform, not all", () => {
		const harness = mount();
		const element = box(harness, null, { duration: 200 });
		expect(declarations(element).property).toBe("opacity, transform");
		expect(declarations(element).property).not.toContain("all");
	});

	it("the default is 200ms · ease", () => {
		const harness = mount();
		const element = box(harness, null, {});
		expect(declarations(element).duration).toBe("200ms");
		expect(declarations(element).timing).toBe(easingCss("ease"));
	});

	it("the easing comes from the control point table", () => {
		const harness = mount();
		const element = box(harness, null, { easing: "ease-out" });
		expect(declarations(element).timing).toBe("cubic-bezier(0, 0, 0.58, 1)");
	});

	it("linear is a keyword", () => {
		expect(easingCss("linear")).toBe("linear");
	});

	/**
	 * A duration of 0 must behave the same as no transition; the contract depends on this. Setting a
	 * declaration would make the browser start and immediately finish a zero-length transition and
	 * fire transitionend, creating a state that nothing reads.
	 */
	it("duration 0 is the same as no transition", () => {
		const harness = mount();
		const element = box(harness, { opacity: 1 }, { duration: 0 });
		expect(armed(element)).toBe(false);
	});
});

describe("removing the transition returns to immediate", () => {
	it("remove-prop clears the declaration", () => {
		const harness = mount();
		const element = box(harness, { opacity: 1 }, { duration: 200 });
		expect(armed(element)).toBe(true);
		harness.apply([
			{ op: "remove-prop", id: 1, name: "transition" },
		] as RuntimePatchBatch["patches"]);
		expect(armed(element)).toBe(false);
		expect(declarations(element).duration).toBe("");
	});

	it("value changes after clearing settle without a declaration", () => {
		const harness = mount();
		const element = box(harness, { opacity: 1 }, { duration: 200 });
		harness.apply([
			{ op: "remove-prop", id: 1, name: "transition" },
			{ op: "set-prop", id: 1, name: "style", value: { opacity: 0 } },
		] as RuntimePatchBatch["patches"]);
		expect(armed(element)).toBe(false);
		expect(element.style.opacity).toBe("0");
	});
});

describe("moving axes", () => {
	it("the inline style follows when opacity changes", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0 }, { duration: 200 });
		harness.apply([
			{ op: "set-prop", id: 1, name: "style", value: { opacity: 1 } },
		] as RuntimePatchBatch["patches"]);
		expect(element.style.opacity).toBe("1");
		expect(armed(element)).toBe(true);
	});

	it("three transform axes become one transform, in a fixed order", () => {
		const harness = mount();
		const element = box(
			harness,
			{ translateX: 8, translateY: -4, scale: 0.96 },
			null,
		);
		expect(element.style.transform).toBe(
			"translateX(8px) translateY(-4px) scale(0.96)",
		);
	});

	it("writing one axis fills the rest with neutral values", () => {
		const harness = mount();
		const element = box(harness, { translateY: 12 }, null);
		expect(element.style.transform).toBe(
			"translateX(0px) translateY(12px) scale(1)",
		);
	});

	it("removing the last transform axis removes the transform declaration", () => {
		const harness = mount();
		const element = box(harness, { translateY: 12 }, { duration: 200 });
		harness.apply([
			{ op: "set-prop", id: 1, name: "style", value: {} },
		] as RuntimePatchBatch["patches"]);
		expect(element.style.transform).toBe("");
	});

	/** When the latest target wins, a late-arriving older value cannot linger; the last write wins. */
	it("rapid consecutive changes converge on the last target", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0 }, { duration: 400 });
		for (const opacity of [1, 0.2, 0.8]) {
			harness.apply([
				{ op: "set-prop", id: 1, name: "style", value: { opacity } },
			] as RuntimePatchBatch["patches"]);
		}
		expect(element.style.opacity).toBe("0.8");
		expect(armed(element)).toBe(true);
	});

	/**
	 * Interruption. Reversing the target writes only the new target. The renderer must not write the
	 * old target again in between, because that extra write would make the browser travel to the end
	 * and back.
	 */
	it("a reverted target does not pass through the old one", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0 }, { duration: 400 });
		const written: string[] = [];
		const observer = new MutationObserver(() => {
			written.push(element.style.opacity);
		});
		observer.observe(element, { attributes: true, attributeFilter: ["style"] });
		harness.apply([
			{ op: "set-prop", id: 1, name: "style", value: { opacity: 1 } },
		] as RuntimePatchBatch["patches"]);
		harness.apply([
			{ op: "set-prop", id: 1, name: "style", value: { opacity: 0 } },
		] as RuntimePatchBatch["patches"]);
		observer.disconnect();
		expect(element.style.opacity).toBe("0");
	});
});

describe("policy and value are different axes", () => {
	/**
	 * A commit that changes only the policy does not rewrite the value. Rewriting it would make the
	 * browser start a transition to the same value and rewind an in-progress transition to the new
	 * duration.
	 */
	it("changing only the transition does not change the style declaration", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0.5 }, { duration: 200 });
		const before = element.style.opacity;
		harness.apply([
			{ op: "set-prop", id: 1, name: "transition", value: { duration: 400 } },
		] as RuntimePatchBatch["patches"]);
		expect(element.style.opacity).toBe(before);
		expect(declarations(element).duration).toBe("400ms");
	});
});

describe("reduced motion", () => {
	it("no transition declaration stands when it is on", () => {
		matches = true;
		const harness = mount();
		const element = box(harness, { opacity: 1 }, { duration: 200 });
		expect(armed(element)).toBe(false);
		expect(element.style.opacity).toBe("1");
	});

	/**
	 * Turning reduced motion on mid-transition removes the declarations, so the browser draws the
	 * target value at once. No node is left stuck partway through a transition.
	 */
	it("the declaration vanishes when it turns on midway", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0 }, { duration: 400 });
		harness.apply([
			{ op: "set-prop", id: 1, name: "style", value: { opacity: 1 } },
		] as RuntimePatchBatch["patches"]);
		expect(armed(element)).toBe(true);
		setReduced(true);
		expect(armed(element)).toBe(false);
		expect(element.style.opacity).toBe("1");
	});

	it("turning it off again moves from the next change", () => {
		const harness = mount();
		const element = box(harness, { opacity: 0 }, { duration: 400 });
		setReduced(true);
		expect(armed(element)).toBe(false);
		setReduced(false);
		expect(armed(element)).toBe(true);
	});

	it("every node already standing follows together", () => {
		const harness = mount();
		harness.apply([
			{ op: "create", id: 1, kind: "view" },
			{ op: "set-prop", id: 1, name: "transition", value: { duration: 200 } },
			{ op: "create", id: 2, kind: "stack" },
			{ op: "set-prop", id: 2, name: "transition", value: { duration: 200 } },
			{ op: "insert", parent: 0, child: 1, index: 0 },
			{ op: "insert", parent: 0, child: 2, index: 1 },
		] as RuntimePatchBatch["patches"]);
		expect(armed(harness.node(1))).toBe(true);
		expect(armed(harness.node(2))).toBe(true);
		setReduced(true);
		expect(armed(harness.node(1))).toBe(false);
		expect(armed(harness.node(2))).toBe(false);
	});
});

describe("disposal and reset", () => {
	it("after disposal, setting changes touch no node", () => {
		const harness = mount();
		box(harness, { opacity: 1 }, { duration: 200 });
		harness.renderer.dispose();
		/** A leftover listener would write to a dead element on this call, so the call must not throw. */
		expect(() => setReduced(true)).not.toThrow();
	});

	it("reset empties the transition list", () => {
		const harness = mount();
		box(harness, { opacity: 1 }, { duration: 200 });
		harness.renderer.reset();
		harness.revision = 0;
		expect(() => setReduced(true)).not.toThrow();
		const next = box(harness, { opacity: 1 }, { duration: 200 });
		/**
		 * A node created in a new session reads the current setting. Since reduced motion is on, it is
		 * not armed.
		 */
		expect(armed(next)).toBe(false);
	});

	it("vanished nodes leave the list", () => {
		const harness = mount();
		box(harness, { opacity: 1 }, { duration: 200 });
		harness.apply([{ op: "remove", id: 1 }] as RuntimePatchBatch["patches"]);
		expect(() => setReduced(true)).not.toThrow();
	});
});

describe("values off contract are refused", () => {
	const fails = (patches: RuntimePatchBatch["patches"]): void => {
		const harness = mount();
		expect(() => harness.apply(patches)).toThrow(WebRuntimeRendererError);
		expect(harness.renderer.failed).toBe(true);
	};

	it.each([
		["string transition", "200ms"],
		["invalid easing", { easing: "spring" }],
		["negative duration", { duration: -1 }],
		["unknown key", { delay: 10 }],
	])("%s", (_label, value) => {
		fails([
			{ op: "create", id: 1, kind: "view" },
			{ op: "set-prop", id: 1, name: "transition", value },
		] as RuntimePatchBatch["patches"]);
	});

	it.each([
		["string offset", { translateX: "10px" }],
		["Infinity", { translateY: Number.POSITIVE_INFINITY }],
		["negative scale", { scale: -1 }],
	])("%s", (_label, style) => {
		fails([
			{ op: "create", id: 1, kind: "view" },
			{ op: "set-prop", id: 1, name: "style", value: style },
		] as RuntimePatchBatch["patches"]);
	});

	/** `transition` is accepted exactly where `style: RuntimeStyle` is accepted. */
	it.each([
		"text",
		"button",
		"progress",
		"screen",
	] as const)("%s does not take the transition prop", (kind) => {
		fails([
			{ op: "create", id: 1, kind },
			{ op: "set-prop", id: 1, name: "transition", value: { duration: 200 } },
		] as RuntimePatchBatch["patches"]);
	});

	it.each([
		"view",
		"stack",
		"row",
		"scroll",
		"image",
		"pressable",
		"text-input",
		"text-area",
	] as const)("%s takes the transition prop", (kind) => {
		const harness = mount();
		harness.apply([
			{ op: "create", id: 1, kind },
			{ op: "set-prop", id: 1, name: "transition", value: { duration: 200 } },
			{ op: "insert", parent: 0, child: 1, index: 0 },
		] as RuntimePatchBatch["patches"]);
		expect(harness.renderer.failed).toBe(false);
		expect(armed(harness.node(1))).toBe(true);
	});
});
