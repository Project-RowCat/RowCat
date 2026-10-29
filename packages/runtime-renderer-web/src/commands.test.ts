// @vitest-environment jsdom
import type { RuntimeCommandBatch } from "@rowcat/runtime-host/commands";
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import { beforeEach, describe, expect, it } from "vitest";
import type { WebRuntimeRendererError } from "./errors.ts";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "./renderer.ts";

/**
 * What control commands do to the DOM, and what they cannot reach. Four things are pinned by value:
 * the controller number appears in the table; the table lives as long as its node; a command
 * touches only one axis; and nothing outside this renderer's registry is reachable.
 */

const SCREEN: RuntimePatchBatch = {
	revision: 1,
	patches: [
		{ op: "create", id: 1, kind: "scroll" },
		{ op: "set-prop", id: 1, name: "controller", value: { $control: 7 } },
		{ op: "create", id: 2, kind: "text-input" },
		{ op: "set-prop", id: 2, name: "value", value: "" },
		{ op: "set-prop", id: 2, name: "controller", value: { $control: 9 } },
		{ op: "create", id: 3, kind: "text-area" },
		{ op: "set-prop", id: 3, name: "value", value: "" },
		{ op: "set-prop", id: 3, name: "controller", value: { $control: 11 } },
		{ op: "insert", parent: 0, child: 1, index: 0 },
		{ op: "insert", parent: 0, child: 2, index: 1 },
		{ op: "insert", parent: 0, child: 3, index: 2 },
	],
};

interface Harness {
	renderer: WebRuntimeRenderer;
	root: HTMLElement;
	failures: WebRuntimeRendererError[];
	node(id: number): HTMLElement;
}

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
	return {
		renderer,
		failures,
		root: container.shadowRoot?.querySelector(
			'[data-rc="root"]',
		) as HTMLElement,
		node: (id) => renderer.node(id) as HTMLElement,
	};
}

/** Focused element inside the shadow root, found from the root the renderer attached. */
const activeIn = (h: Harness): Element | null =>
	(h.root.getRootNode() as ShadowRoot).activeElement;

const commands = (
	revision: number,
	...list: RuntimeCommandBatch["commands"]
): RuntimeCommandBatch => ({ revision, commands: list });

/**
 * jsdom computes no layout: scrollHeight and clientHeight are always 0. So scrollable boxes are set
 * up by value. This file checks which axis the renderer assigns which value to, not the browser's
 * scroll implementation, and that is enough for this purpose.
 */
function makeScrollable(
	element: HTMLElement,
	size: {
		scrollHeight?: number;
		clientHeight?: number;
		scrollWidth?: number;
		clientWidth?: number;
	},
): { top: number; left: number } {
	const position = { top: 0, left: 0 };
	for (const [name, value] of Object.entries(size))
		Object.defineProperty(element, name, { value, configurable: true });
	Object.defineProperty(element, "scrollTo", {
		value: (options: ScrollToOptions) => {
			if (options.top !== undefined) position.top = options.top;
			if (options.left !== undefined) position.left = options.left;
		},
		configurable: true,
	});
	return position;
}

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("scroll", () => {
	it("vertical scroll start, end and offset", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const position = makeScrollable(h.node(1), {
			scrollHeight: 900,
			clientHeight: 300,
		});

		h.renderer.applyCommands(
			commands(1, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position).toEqual({ top: 600, left: 0 });

		h.renderer.applyCommands(
			commands(1, { op: "scroll", control: 7, to: "start" }),
		);
		expect(position).toEqual({ top: 0, left: 0 });

		h.renderer.applyCommands(
			commands(1, { op: "scroll", control: 7, to: "offset", offset: 240 }),
		);
		expect(position).toEqual({ top: 240, left: 0 });
	});

	it("horizontal scroll touches **only the horizontal axis**", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 1, name: "horizontal", value: true }],
		});
		const position = makeScrollable(h.node(1), {
			scrollWidth: 1000,
			clientWidth: 400,
		});
		position.top = 55;

		h.renderer.applyCommands(
			commands(2, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position).toEqual({ top: 55, left: 600 });

		h.renderer.applyCommands(
			commands(2, { op: "scroll", control: 7, to: "start" }),
		);
		expect(position).toEqual({ top: 55, left: 0 });
	});

	it("when content is shorter than the screen, the end is 0: never negative", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const position = makeScrollable(h.node(1), {
			scrollHeight: 100,
			clientHeight: 300,
		});
		h.renderer.applyCommands(
			commands(1, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position.top).toBe(0);
	});

	it("measures the end after the commit grew it: the command comes after", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const position = makeScrollable(h.node(1), {
			scrollHeight: 300,
			clientHeight: 300,
		});
		/** The commit that grows the list. The command follows it, in the caller's order. */
		h.renderer.apply({
			revision: 2,
			patches: [
				{ op: "create", id: 20, kind: "text" },
				{ op: "insert", parent: 1, child: 20, index: 0 },
			],
		});
		Object.defineProperty(h.node(1), "scrollHeight", {
			value: 900,
			configurable: true,
		});
		h.renderer.applyCommands(
			commands(2, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position.top).toBe(600);
	});
});

describe("focus", () => {
	it("gives and takes focus on TextInput and TextArea", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const input = h.node(2) as HTMLInputElement;
		const area = h.node(3) as HTMLTextAreaElement;

		h.renderer.applyCommands(commands(1, { op: "focus", control: 9 }));
		expect(activeIn(h)).toBe(input);

		h.renderer.applyCommands(commands(1, { op: "focus", control: 11 }));
		expect(activeIn(h)).toBe(area);

		h.renderer.applyCommands(commands(1, { op: "blur", control: 11 }));
		expect(activeIn(h)).not.toBe(area);
	});

	it("nothing happens to a disabled input", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 2, name: "disabled", value: true }],
		});
		h.renderer.applyCommands(commands(2, { op: "focus", control: 9 }));
		expect(activeIn(h)).not.toBe(h.node(2));
		expect(h.renderer.failed).toBe(false);
	});
});

describe("controller lifetime", () => {
	it("removing the prop removes it from the table too", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const position = makeScrollable(h.node(1), {
			scrollHeight: 900,
			clientHeight: 300,
		});
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "remove-prop", id: 1, name: "controller" }],
		});
		h.renderer.applyCommands(
			commands(2, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position.top).toBe(0);
		expect(h.renderer.failed).toBe(false);
	});

	it("when a node vanishes its controller's commands do nothing", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		h.renderer.apply({ revision: 2, patches: [{ op: "remove", id: 2 }] });
		h.renderer.applyCommands(commands(2, { op: "focus", control: 9 }));
		expect(h.renderer.failed).toBe(false);
	});

	it("removed from the table when it vanishes with its subtree", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "text-input" },
				{ op: "set-prop", id: 2, name: "value", value: "" },
				{ op: "set-prop", id: 2, name: "controller", value: { $control: 5 } },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		h.renderer.apply({ revision: 2, patches: [{ op: "remove", id: 1 }] });
		h.renderer.applyCommands(commands(2, { op: "focus", control: 5 }));
		expect(h.renderer.failed).toBe(false);
	});

	it("a reorder does not break binding", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const position = makeScrollable(h.node(1), {
			scrollHeight: 900,
			clientHeight: 300,
		});
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "move", parent: 0, child: 1, index: 2 }],
		});
		h.renderer.applyCommands(
			commands(2, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position.top).toBe(600);
	});

	it("reset empties the table", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		h.renderer.reset();
		h.renderer.applyCommands(commands(0, { op: "focus", control: 9 }));
		expect(h.renderer.failed).toBe(false);
	});

	it("two nodes with the same number is a contract error", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		expect(() =>
			h.renderer.apply({
				revision: 2,
				patches: [
					{ op: "set-prop", id: 2, name: "controller", value: { $control: 7 } },
				],
			}),
		).toThrow();
		expect(h.renderer.failed).toBe(true);
	});

	it("a value that is not a controller reference is a contract error", () => {
		const h = mount();
		expect(() =>
			h.renderer.apply({
				revision: 1,
				patches: [
					{ op: "create", id: 1, kind: "scroll" },
					{ op: "set-prop", id: 1, name: "controller", value: 7 },
				],
			}),
		).toThrow();
	});
});

describe("boundaries", () => {
	it("bundles with mismatched revisions are dropped quietly: the renderer does not die", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const position = makeScrollable(h.node(1), {
			scrollHeight: 900,
			clientHeight: 300,
		});
		h.renderer.applyCommands(
			commands(5, { op: "scroll", control: 7, to: "end" }),
		);
		expect(position.top).toBe(0);
		expect(h.renderer.failed).toBe(false);
	});

	it("a command of the wrong kind is a contract error", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		h.renderer.applyCommands(commands(1, { op: "focus", control: 7 }));
		/** Does not throw. The renderer is marked failed and onFailure reports the fact. */
		expect(h.renderer.failed).toBe(true);
		expect(h.failures[0]?.message).toContain("focus command targets a scroll");
	});

	it("the trusted shell is not controlled: the synthetic root and outer DOM are not in the table", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		const outside = document.createElement("input");
		document.body.appendChild(outside);
		for (const control of [0, 1, 2, 3, 999])
			h.renderer.applyCommands(commands(1, { op: "focus", control }));
		expect(document.activeElement).not.toBe(outside);
		expect(h.renderer.failed).toBe(false);
	});

	it("commands after failure or disposal do nothing", () => {
		const h = mount();
		h.renderer.apply(SCREEN);
		h.renderer.dispose();
		h.renderer.applyCommands(commands(1, { op: "focus", control: 9 }));
		expect(h.failures).toHaveLength(0);
	});
});
