import type { RuntimeAssetTarget } from "@rowcat/runtime/asset";
// @vitest-environment jsdom
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebRuntimeRendererError } from "./errors.ts";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "./renderer.ts";

/**
 * Each patch operation and its effect on the DOM and registry, checked with hand-written batches.
 *
 * The real pipeline (TSX → compiler → QuickJS → reconciler) is covered by `pipeline.test.ts`.
 * Batches are written by hand here because the reconciler never emits protocol boundary values on
 * its normal path: duplicate revisions, out-of-range indices, children not under their parent, and
 * props outside the contract. Only feeding bad input directly can show that those rejections
 * actually happen.
 */

const COUNTER: RuntimePatchBatch = {
	revision: 1,
	patches: [
		{ op: "create", id: 1, kind: "stack" },
		{ op: "set-prop", id: 1, name: "gap", value: 12 },
		{ op: "create", id: 2, kind: "text" },
		{ op: "create", id: 3, kind: "#text" },
		{ op: "set-text", id: 3, value: "Count: 0" },
		{ op: "insert", parent: 2, child: 3, index: 0 },
		{ op: "create", id: 4, kind: "button" },
		{ op: "set-prop", id: 4, name: "onPress", value: { $handler: 41 } },
		{ op: "create", id: 5, kind: "#text" },
		{ op: "set-text", id: 5, value: "Increment" },
		{ op: "insert", parent: 4, child: 5, index: 0 },
		{ op: "insert", parent: 1, child: 2, index: 0 },
		{ op: "insert", parent: 1, child: 4, index: 1 },
		{ op: "insert", parent: 0, child: 1, index: 0 },
	],
};

interface Harness {
	renderer: WebRuntimeRenderer;
	container: HTMLElement;
	root: HTMLElement;
	dispatched: number[];
	/**
	 * The value sent with a handler number. This is the only place where text input carries a string.
	 */
	events: { handler: number; payload: string | null }[];
	failures: WebRuntimeRendererError[];
	resolveAsset: ReturnType<
		typeof vi.fn<(target: RuntimeAssetTarget) => string | null>
	>;
	onEvent: ((id: number, payload: string | null) => void) | null;
}

function mount(): Harness {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const dispatched: number[] = [];
	const events: Harness["events"] = [];
	const failures: WebRuntimeRendererError[] = [];
	const resolveAsset = vi.fn<(target: RuntimeAssetTarget) => string | null>(
		() => null,
	);
	const harness = {
		dispatched,
		events,
		failures,
		resolveAsset,
		/**
		 * Called when an event goes out. This is where the controlled author is deferred (§5). This file
		 * has no VM, so without that round trip the controlled value would stay at the first commit
		 * forever, and IME behavior checked in that state would not match the real app.
		 */
		onEvent: null,
	} as Harness;
	harness.renderer = createWebRuntimeRenderer({
		container,
		dispatchEvent: (id, payload) => {
			dispatched.push(id);
			events.push({ handler: id, payload: payload ?? null });
			harness.onEvent?.(id, payload ?? null);
		},
		resolveAsset,
		onFailure: (error) => failures.push(error),
	});
	harness.container = container;
	harness.root = container.shadowRoot?.querySelector(
		'[data-rc="root"]',
	) as HTMLElement;
	return harness;
}

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("first render: revision 1 from an empty root", () => {
	it("one bundle builds the expected tree", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(h.renderer.revision).toBe(1);
		expect(h.renderer.size).toBe(5);
		const stack = h.root.firstElementChild as HTMLElement;
		expect(stack.dataset.rc).toBe("stack");
		expect(stack.style.gap).toBe("12px");
		expect(stack.children).toHaveLength(2);
		expect(stack.children[0]?.tagName).toBe("SPAN");
		expect(stack.children[0]?.textContent).toBe("Count: 0");
		const button = stack.children[1] as HTMLButtonElement;
		expect(button.tagName).toBe("BUTTON");
		expect(button.type).toBe("button");
		expect(button.textContent).toBe("Increment");
	});

	it("no DOM node is made for the synthetic root (0): the container takes that place", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(h.renderer.node(0)).toBe(h.root);
		expect(h.root.dataset.rcNode).toBeUndefined();
		expect(h.renderer.ids()).toEqual([1, 2, 3, 4, 5]);
	});

	it("draws inside a shadow root: the app's CSS does not reach it", () => {
		const h = mount();
		expect(h.container.shadowRoot).not.toBeNull();
		expect(
			h.container.shadowRoot?.querySelector("style")?.textContent,
		).toContain(":focus-visible");
		expect(h.container.childNodes).toHaveLength(0);
	});
});

describe("operations", () => {
	it("set-text edits the same Text node", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		const before = h.renderer.node(3);
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "set-text", id: 3, value: "Count: 1" }],
		});
		expect(h.renderer.node(3)).toBe(before);
		expect(before?.textContent).toBe("Count: 1");
		expect(h.root.textContent).toBe("Count: 1Increment");
	});

	it("set-prop and remove-prop move only that prop", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		const button = h.renderer.node(4) as HTMLButtonElement;
		h.renderer.apply({
			revision: 2,
			patches: [
				{ op: "set-prop", id: 4, name: "tone", value: "primary" },
				{ op: "set-prop", id: 4, name: "disabled", value: true },
				{ op: "set-prop", id: 1, name: "style", value: { padding: 8 } },
			],
		});
		expect(button.dataset.rcTone).toBe("primary");
		expect(button.disabled).toBe(true);
		const stack = h.renderer.node(1) as HTMLElement;
		expect(stack.style.padding).toBe("8px");
		expect(stack.style.gap).toBe("12px");
		h.renderer.apply({
			revision: 3,
			patches: [
				{ op: "remove-prop", id: 4, name: "tone" },
				{ op: "remove-prop", id: 4, name: "disabled" },
				{ op: "remove-prop", id: 1, name: "style" },
				{ op: "remove-prop", id: 1, name: "gap" },
			],
		});
		expect(button.dataset.rcTone).toBeUndefined();
		expect(button.disabled).toBe(false);
		/**
		 * The `style.padding` getter still returns the old value after the property is cleared. That is
		 * cssstyle's behavior, so the test checks the declaration itself.
		 */
		expect(stack.style.getPropertyValue("padding")).toBe("");
		expect(stack.style.getPropertyValue("gap")).toBe("");
	});

	it("the gap prop beats style.gap, and style.gap returns when the prop vanishes", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "row" },
				{ op: "set-prop", id: 1, name: "style", value: { gap: 4 } },
				{ op: "set-prop", id: 1, name: "gap", value: 20 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const row = h.renderer.node(1) as HTMLElement;
		expect(row.style.gap).toBe("20px");
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "remove-prop", id: 1, name: "gap" }],
		});
		expect(row.style.gap).toBe("4px");
	});

	it("insert puts it at that moment's list index", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "view" },
				{ op: "create", id: 3, kind: "view" },
				{ op: "create", id: 4, kind: "view" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 1, child: 4, index: 1 },
				{ op: "insert", parent: 1, child: 3, index: 1 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		expect(h.renderer.ids()).toEqual([1, 2, 3, 4]);
		const stack = h.renderer.node(1) as HTMLElement;
		expect(
			[...stack.children].map((c) => (c as HTMLElement).dataset.rcNode),
		).toEqual(["2", "3", "4"]);
	});

	it("move moves the same DOM node: no delete and recreate", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "view" },
				{ op: "create", id: 3, kind: "view" },
				{ op: "create", id: 4, kind: "view" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 1, child: 3, index: 1 },
				{ op: "insert", parent: 1, child: 4, index: 2 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const stack = h.renderer.node(1) as HTMLElement;
		const [a, b, c] = [...stack.children];
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "move", parent: 1, child: 4, index: 0 }],
		});
		expect([...stack.children]).toEqual([c, a, b]);
		expect(h.renderer.ids()).toEqual([1, 4, 2, 3]);
		expect(h.renderer.node(4)).toBe(c);
	});

	it("remove releases the subtree and its registration wholesale", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "remove", id: 1 }],
		});
		expect(h.renderer.size).toBe(0);
		expect(h.renderer.ids()).toEqual([]);
		expect(h.root.childNodes).toHaveLength(0);
		for (const id of [1, 2, 3, 4, 5]) expect(h.renderer.node(id)).toBeNull();
		/** Reusing a removed id is a protocol violation. */
		expect(() =>
			h.renderer.apply({
				revision: 3,
				patches: [{ op: "create", id: 3, kind: "view" }],
			}),
		).toThrowError(expect.objectContaining({ code: "renderer_node_reused" }));
	});
});

describe("revisions", () => {
	const next = (revision: number): RuntimePatchBatch => ({
		revision,
		patches: [],
	});

	it("accepts 1 → 2", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		h.renderer.apply(next(2));
		expect(h.renderer.revision).toBe(2);
	});

	it.each([
		["duplicate", 1],
		["skipped", 3],
	])("1 → %s (%i) is refused and enters the failed state", (_label, revision) => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(() => h.renderer.apply(next(revision))).toThrowError(
			expect.objectContaining({ code: "renderer_revision_mismatch" }),
		);
		expect(h.renderer.failed).toBe(true);
		expect(h.failures).toHaveLength(1);
		/** After a failure, even a correct revision is refused. The tree can no longer be trusted. */
		expect(() => h.renderer.apply(next(2))).toThrowError(
			expect.objectContaining({ code: "renderer_failed" }),
		);
	});

	it("refuses 2 → 1 (going back)", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		h.renderer.apply(next(2));
		expect(() => h.renderer.apply(next(1))).toThrowError(
			expect.objectContaining({ code: "renderer_revision_mismatch" }),
		);
	});

	it("reset returns to an empty root and takes revision 1 again", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(() => h.renderer.apply(next(5))).toThrowError();
		h.renderer.reset();
		expect(h.renderer.failed).toBe(false);
		expect(h.renderer.revision).toBe(0);
		expect(h.root.childNodes).toHaveLength(0);
		h.renderer.apply(COUNTER);
		expect(h.renderer.size).toBe(5);
	});
});

describe("topology invariants", () => {
	it("missing nodes, already attached nodes, out-of-range indexes and children not in the parent all fail", () => {
		const cases: [string, RuntimePatchBatch["patches"]][] = [
			["missing node", [{ op: "set-text", id: 99, value: "x" }]],
			[
				"already attached node",
				[{ op: "insert", parent: 0, child: 1, index: 1 }],
			],
			["out-of-range index", [{ op: "insert", parent: 0, child: 1, index: 5 }]],
			[
				"child not in the parent",
				[{ op: "move", parent: 2, child: 4, index: 0 }],
			],
			["set-text on a non-text node", [{ op: "set-text", id: 2, value: "x" }]],
			["duplicate create", [{ op: "create", id: 1, kind: "view" }]],
		];
		for (const [label, patches] of cases) {
			const h = mount();
			h.renderer.apply(COUNTER);
			expect(
				() => h.renderer.apply({ revision: 2, patches }),
				label,
			).toThrowError(WebRuntimeRendererError);
			expect(h.renderer.failed, label).toBe(true);
		}
	});

	it("the registry's size equals the live DOM: no leaks on repetition", () => {
		const h = mount();
		let revision = 0;
		let id = 0;
		for (let cycle = 0; cycle < 50; cycle += 1) {
			const stack = ++id;
			const text = ++id;
			const leaf = ++id;
			h.renderer.apply({
				revision: ++revision,
				patches: [
					{ op: "create", id: stack, kind: "stack" },
					{ op: "create", id: text, kind: "text" },
					{ op: "create", id: leaf, kind: "#text" },
					{ op: "set-text", id: leaf, value: `c${cycle}` },
					{ op: "insert", parent: text, child: leaf, index: 0 },
					{ op: "insert", parent: stack, child: text, index: 0 },
					{ op: "insert", parent: 0, child: stack, index: 0 },
				],
			});
			h.renderer.apply({
				revision: ++revision,
				patches: [{ op: "set-text", id: leaf, value: `u${cycle}` }],
			});
			h.renderer.apply({
				revision: ++revision,
				patches: [{ op: "remove", id: stack }],
			});
			expect(h.renderer.size).toBe(0);
			expect(h.root.childNodes).toHaveLength(0);
		}
	});
});

describe("only props in the table", () => {
	it("unknown props do not reach the DOM and are a contract error", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(() =>
			h.renderer.apply({
				revision: 2,
				patches: [
					{ op: "set-prop", id: 4, name: "onclick", value: "alert(1)" },
				],
			}),
		).toThrowError(expect.objectContaining({ code: "renderer_contract" }));
		const button = h.renderer.node(4) as HTMLButtonElement;
		expect(button.getAttribute("onclick")).toBeNull();
		expect(button.onclick).toBeNull();
	});

	it("children are structure and don't come as a prop", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(() =>
			h.renderer.apply({
				revision: 2,
				patches: [{ op: "set-prop", id: 1, name: "children", value: "x" }],
			}),
		).toThrowError(expect.objectContaining({ code: "renderer_contract" }));
	});

	it("colors that are not colors do not become CSS", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "screen" },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		expect(() =>
			h.renderer.apply({
				revision: 2,
				patches: [
					{
						op: "set-prop",
						id: 1,
						name: "background",
						value: "url(javascript:1)",
					},
				],
			}),
		).toThrowError(expect.objectContaining({ code: "renderer_contract" }));
		expect((h.renderer.node(1) as HTMLElement).style.backgroundColor).toBe("");
	});
});

describe("primitives", () => {
	it("each kind makes its set element", () => {
		const h = mount();
		const kinds = [
			"screen",
			"view",
			"stack",
			"row",
			"scroll",
			"text",
			"image",
			"button",
			"pressable",
			"progress",
		] as const;
		h.renderer.apply({
			revision: 1,
			patches: kinds.flatMap((kind, index) => [
				{ op: "create" as const, id: index + 1, kind },
				{ op: "insert" as const, parent: 0, child: index + 1, index },
			]),
		});
		expect(
			[...h.root.children].map((child) => child.tagName.toLowerCase()),
		).toEqual([
			"div",
			"div",
			"div",
			"div",
			"div",
			"span",
			"img",
			"button",
			"button",
			"progress",
		]);
		expect([...h.root.children].map((c) => c.className)).toEqual(
			kinds.map((kind) => `rc-${kind}`),
		);
	});

	it("screen's background is a background color and does not touch document.body", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "screen" },
				{ op: "set-prop", id: 1, name: "background", value: "#111111" },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		expect((h.renderer.node(1) as HTMLElement).style.backgroundColor).toBe(
			"rgb(17, 17, 17)",
		);
		expect(document.body.style.backgroundColor).toBe("");
	});

	it("scroll's horizontal changes the axis while keeping the same element", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "scroll" },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const scroll = h.renderer.node(1) as HTMLElement;
		scroll.scrollTop = 40;
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 1, name: "horizontal", value: true }],
		});
		expect(h.renderer.node(1)).toBe(scroll);
		expect(scroll.dataset.rcHorizontal).toBe("true");
	});

	it("text styles carry over", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "text" },
				{
					op: "set-prop",
					id: 1,
					name: "style",
					value: { color: "#ffffff", fontSize: 20, fontWeight: "bold" },
				},
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const text = h.renderer.node(1) as HTMLElement;
		expect(text.style.color).toBe("rgb(255, 255, 255)");
		expect(text.style.fontSize).toBe("20px");
		expect(text.style.fontWeight).toBe("700");
	});

	it("image uses only the resolver's answer as src; the creator's address never becomes src", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "image" },
				{
					op: "set-prop",
					id: 1,
					name: "source",
					value: { $asset: "https://creator.example/a.png" },
				},
				{ op: "set-prop", id: 1, name: "alt", value: "Sena" },
				{ op: "set-prop", id: 1, name: "fit", value: "contain" },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const image = h.renderer.node(1) as HTMLImageElement;
		/**
		 * The resolver receives a classified kind, not a string, and is also asked what to use it as. If
		 * `image` is not specified, a name bound to a sound would become a picture here.
		 */
		expect(h.resolveAsset).toHaveBeenCalledWith(
			{ kind: "remote", url: "https://creator.example/a.png" },
			"image",
		);
		/**
		 * When the resolver returns null, even for a remote URL, the author's address does not sit in
		 * `src`.
		 */
		expect(image.hasAttribute("src")).toBe(false);
		expect(image.dataset.rcMissing).toBe("");
		expect(image.getAttribute("alt")).toBe("Sena");
		expect(image.style.objectFit).toBe("contain");
		expect(image.referrerPolicy).toBe("no-referrer");

		h.resolveAsset.mockImplementation((target) =>
			target.kind === "remote"
				? `https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent(target.url)}`
				: null,
		);
		h.renderer.apply({
			revision: 2,
			patches: [
				{
					op: "set-prop",
					id: 1,
					name: "source",
					value: { $asset: "https://creator.example/b.png" },
				},
			],
		});
		/** The address the DOM opens is RowCat's, not the author's origin. */
		expect(image.getAttribute("src")).toBe(
			"https://api.rowcat.test/v2/runtime/assets/remote?url=https%3A%2F%2Fcreator.example%2Fb.png",
		);
		expect(
			image.getAttribute("src")?.startsWith("https://creator.example"),
		).toBe(false);
		expect(image.dataset.rcMissing).toBeUndefined();

		/** A logical reference is a placeholder under the same resolver. It does not go to the proxy. */
		h.renderer.apply({
			revision: 3,
			patches: [
				{
					op: "set-prop",
					id: 1,
					name: "source",
					value: { $asset: "characters/sena" },
				},
			],
		});
		expect(h.resolveAsset).toHaveBeenLastCalledWith(
			{ kind: "logical", path: "characters/sena" },
			"image",
		);
		expect(image.hasAttribute("src")).toBe(false);
		expect(image.dataset.rcMissing).toBe("");
	});

	it("image: values the runtime could not have sealed do not reach the resolver and are placeholders", () => {
		const h = mount();
		h.resolveAsset.mockReturnValue("https://api.rowcat.test/never");
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "image" },
				{
					op: "set-prop",
					id: 1,
					name: "source",
					value: { $asset: "http://creator.example/a.png" },
				},
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const image = h.renderer.node(1) as HTMLImageElement;
		expect(h.resolveAsset).not.toHaveBeenCalled();
		expect(image.hasAttribute("src")).toBe(false);
		expect(image.dataset.rcMissing).toBe("");
	});

	it("image: a remote picture that fails to load folds to a placeholder and the renderer stays alive", () => {
		const h = mount();
		h.resolveAsset.mockReturnValue(
			"https://api.rowcat.test/v2/runtime/assets/remote?url=x",
		);
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "image" },
				{
					op: "set-prop",
					id: 1,
					name: "source",
					value: { $asset: "https://creator.example/missing.png" },
				},
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const image = h.renderer.node(1) as HTMLImageElement;
		expect(image.hasAttribute("src")).toBe(true);
		image.dispatchEvent(new Event("error"));
		expect(image.hasAttribute("src")).toBe(false);
		expect(image.dataset.rcMissing).toBe("");
		expect(image.getAttribute("role")).toBe("img");
		expect(h.failures).toEqual([]);
		/** The next commit is applied as-is. One picture's failure does not stop the session. */
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 1, name: "alt", value: "later" }],
		});
		expect(h.renderer.revision).toBe(2);
	});

	it("progress folds a value to 0 to 1, and without one it is progress with no known end", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "progress" },
				{ op: "set-prop", id: 1, name: "value", value: 1.5 },
				{ op: "set-prop", id: 1, name: "style", value: { width: "50%" } },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const progress = h.renderer.node(1) as HTMLProgressElement;
		expect(progress.max).toBe(1);
		expect(progress.value).toBe(1);
		expect(progress.style.width).toBe("50%");
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "remove-prop", id: 1, name: "value" }],
		});
		expect(progress.hasAttribute("value")).toBe(false);
		expect(progress.position).toBe(-1);
	});
});

describe("events", () => {
	it("one click is one dispatchEvent(41): no DOM event object crosses", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		const button = h.renderer.node(4) as HTMLButtonElement;
		button.click();
		expect(h.dispatched).toEqual([41]);
	});

	it("pressing text goes to the nearest pressable's number", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		const label = h.renderer.node(5) as Text;
		label.parentElement?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, composed: true }),
		);
		expect(h.dispatched).toEqual([41]);
	});

	it("disabled buttons emit no number", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 4, name: "disabled", value: true }],
		});
		const button = h.renderer.node(4) as HTMLButtonElement;
		button.click();
		button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(h.dispatched).toEqual([]);
	});

	it("a changed handler sends the new number", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		h.renderer.apply({
			revision: 2,
			patches: [
				{ op: "set-prop", id: 4, name: "onPress", value: { $handler: 42 } },
			],
		});
		(h.renderer.node(4) as HTMLButtonElement).click();
		expect(h.dispatched).toEqual([42]);
	});

	it("a failed renderer emits no presses", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		expect(() => h.renderer.apply({ revision: 9, patches: [] })).toThrowError();
		(h.renderer.node(4) as HTMLButtonElement).click();
		expect(h.dispatched).toEqual([]);
	});
});

describe("identity preservation", () => {
	it("a button with focus keeps it after another node's update", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		const button = h.renderer.node(4) as HTMLButtonElement;
		button.focus();
		expect(h.container.shadowRoot?.activeElement).toBe(button);
		h.renderer.apply({
			revision: 2,
			patches: [
				{ op: "set-text", id: 3, value: "Count: 1" },
				{ op: "set-prop", id: 4, name: "onPress", value: { $handler: 42 } },
			],
		});
		expect(h.renderer.node(4)).toBe(button);
		expect(h.container.shadowRoot?.activeElement).toBe(button);
	});

	it("a button moved by key keeps focus too", () => {
		const h = mount();
		h.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "button" },
				{ op: "create", id: 3, kind: "button" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 1, child: 3, index: 1 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const second = h.renderer.node(3) as HTMLButtonElement;
		second.focus();
		h.renderer.apply({
			revision: 2,
			patches: [{ op: "move", parent: 1, child: 3, index: 0 }],
		});
		expect(h.container.shadowRoot?.activeElement).toBe(second);
		expect((h.renderer.node(1) as HTMLElement).firstElementChild).toBe(second);
	});

	it("nothing is accepted after dispose", () => {
		const h = mount();
		h.renderer.apply(COUNTER);
		h.renderer.dispose();
		expect(h.container.shadowRoot?.childNodes).toHaveLength(0);
		expect(() => h.renderer.apply({ revision: 2, patches: [] })).toThrowError(
			expect.objectContaining({ code: "renderer_disposed" }),
		);
	});
});

/** A batch containing one input. A `text-input` also gets its submit handler attached. */
const entryBatch = (
	kind: "text-input" | "text-area",
	options: { value?: string; disabled?: boolean; submit?: boolean } = {},
): RuntimePatchBatch => ({
	revision: 1,
	patches: [
		{ op: "create", id: 1, kind },
		{ op: "set-prop", id: 1, name: "value", value: options.value ?? "" },
		{ op: "set-prop", id: 1, name: "onChangeText", value: { $handler: 7 } },
		...(kind === "text-input" && options.submit !== false
			? ([
					{ op: "set-prop", id: 1, name: "onSubmit", value: { $handler: 9 } },
				] as const)
			: []),
		...(options.disabled === true
			? ([{ op: "set-prop", id: 1, name: "disabled", value: true }] as const)
			: []),
		{ op: "insert", parent: 0, child: 1, index: 0 },
	],
});

/**
 * A follow-up batch that changes the controlled value, as if the author's state had updated and
 * committed again.
 */
const setValue = (revision: number, value: string): RuntimePatchBatch => ({
	revision,
	patches: [{ op: "set-prop", id: 1, name: "value", value }],
});

interface Entry {
	harness: Harness;
	element: HTMLInputElement | HTMLTextAreaElement;
	typeText(value: string): void;
	enter(options?: { isComposing?: boolean }): boolean;
	compositionStart(): void;
	/** Confirms composition. The browser writes the value, then fires `compositionend`. */
	compositionEnd(value: string): void;
	/** Leaves the input. `focusout` bubbles through delegation up to the root. */
	blur(): void;
	/** Answers `count` pending round trips (for `defer` only). The default is one. */
	answer(count?: number): void;
	/** Number of answers not yet arrived. The test reads the round-trip delay from this value. */
	unanswered(): number;
	/**
	 * A single commit where the author changed the value on its own, not a reply to something the user
	 * typed.
	 */
	commitValue(value: string): void;
}

function entry(
	kind: "text-input" | "text-area" = "text-input",
	options: {
		value?: string;
		disabled?: boolean;
		submit?: boolean;
		/**
		 * Defers the controlled author: when `onChangeText` goes out, it returns that value as the next
		 * commit (`const [v, setV] = useState(""); <TextInput value={v} onChangeText={setV} />`).
		 *
		 * It is off by default because most of this file tests one renderer. It is turned on where the
		 * round trip is part of the answer: the IME checks.
		 */
		echo?: boolean;
		/**
		 * The author answers late. Outgoing text is collected and committed when `answer()` is called.
		 *
		 * This matches real round trips: preview crosses the worker, playback crosses the native bridge,
		 * and answers arrive at best a turn later. The user keeps typing meanwhile, so an arriving commit
		 * is older than the screen. A synchronous echo would never show this in tests.
		 */
		defer?: boolean;
		/**
		 * The author trims outgoing text (cap, filter) before returning it. This is the only branch where
		 * the answer never equals the value sent, which is why settling does not depend on equality
		 * alone.
		 */
		transform?: (value: string) => string;
	} = {},
): Entry {
	const harness = mount();
	harness.renderer.apply(entryBatch(kind, options));
	const element = harness.root.firstElementChild as
		| HTMLInputElement
		| HTMLTextAreaElement;
	let revision = 1;
	const deferred: string[] = [];
	const commit = (value: string): void => {
		revision += 1;
		harness.renderer.apply({
			revision,
			patches: [{ op: "set-prop", id: 1, name: "value", value }],
		});
	};
	if (options.echo === true || options.defer === true)
		harness.onEvent = (id, payload) => {
			if (id !== 7 || payload === null) return;
			const answered = options.transform?.(payload) ?? payload;
			if (options.defer === true) deferred.push(answered);
			else commit(answered);
		};
	return {
		harness,
		element,
		typeText(value) {
			element.value = value;
			element.dispatchEvent(new Event("input", { bubbles: true }));
		},
		enter(keyOptions = {}) {
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				...(keyOptions.isComposing === true ? { isComposing: true } : {}),
			});
			element.dispatchEvent(event);
			return event.defaultPrevented;
		},
		compositionStart() {
			element.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
		},
		compositionEnd(value) {
			element.value = value;
			element.dispatchEvent(
				new CompositionEvent("compositionend", { bubbles: true, data: value }),
			);
		},
		blur() {
			element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		},
		answer(count = 1) {
			for (let i = 0; i < count; i += 1) {
				const next = deferred.shift();
				if (next === undefined) throw new Error("no deferred answer");
				commit(next);
			}
		},
		unanswered() {
			return deferred.length;
		},
		commitValue(value) {
			commit(value);
		},
	};
}

describe("text input: controlled value", () => {
	it("each kind makes its set element and the controlled value sits as is", () => {
		const single = entry("text-input", { value: "hello" });
		expect(single.element.tagName).toBe("INPUT");
		expect((single.element as HTMLInputElement).type).toBe("text");
		expect(single.element.value).toBe("hello");
		const multi = entry("text-area", { value: "multiple\nlines" });
		expect(multi.element.tagName).toBe("TEXTAREA");
		expect(multi.element.value).toBe("multiple\nlines");
	});

	it("typed text goes out as one string: no DOM event object crosses", () => {
		const e = entry("text-input", { echo: true });
		e.typeText("a");
		e.typeText("ab");
		e.typeText("abc");
		expect(e.harness.events).toEqual([
			{ handler: 7, payload: "a" },
			{ handler: 7, payload: "ab" },
			{ handler: 7, payload: "abc" },
		]);
	});

	/**
	 * Does not send the same value twice. Some browsers fire `input` again after `compositionend` with
	 * the same character. If both became separate VM turns, that would be wrong.
	 */
	it("a second input with the same value does not go out", () => {
		const e = entry();
		e.typeText("\ud55c");
		e.typeText("\ud55c");
		expect(e.harness.events).toEqual([{ handler: 7, payload: "\ud55c" }]);
	});

	/**
	 * Duplicate detection is based on the controlled value that came back, not on the last text sent.
	 * Otherwise, an input the author cleared, which the user then re-pasted with the same text, would
	 * be discarded.
	 */
	it("the same text entered again into a field the creator cleared goes out again", () => {
		const e = entry("text-input", { echo: true });
		e.typeText("hello");
		e.commitValue("");
		expect(e.element.value).toBe("");
		e.typeText("hello");
		expect(e.harness.events).toEqual([
			{ handler: 7, payload: "hello" },
			{ handler: 7, payload: "hello" },
		]);
	});

	/**
	 * The controlled value is authoritative. With no handler, the renderer restores the screen;
	 * otherwise the screen would show typed text that is absent from the author's state.
	 */
	it("without onChangeText typed text is reverted", () => {
		const harness = mount();
		harness.renderer.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "text-input" },
				{ op: "set-prop", id: 1, name: "value", value: "fixed" },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		const input = harness.root.firstElementChild as HTMLInputElement;
		input.value = "a value changed behind its back";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(harness.events).toEqual([]);
		expect(input.value).toBe("fixed");
	});

	it("disabled inputs emit neither text nor submit", () => {
		const e = entry("text-input", { disabled: true });
		expect((e.element as HTMLInputElement).disabled).toBe(true);
		e.typeText("ignored");
		e.enter();
		expect(e.harness.events).toEqual([]);
	});

	/**
	 * Does not perform unneeded assignments. If the value is already equal, writing it again resets
	 * the caret and selection in the browser. The absence of the assignment is how the test shows that
	 * unrelated re-renders do not break input.
	 */
	it("a commit with the same value does not rewrite the element's value", () => {
		const e = entry("text-input", { value: "hello" });
		let writes = 0;
		const element = e.element as HTMLInputElement;
		const descriptor = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		);
		if (descriptor?.set === undefined || descriptor.get === undefined)
			throw new Error("no value descriptor");
		Object.defineProperty(element, "value", {
			configurable: true,
			get() {
				return descriptor.get?.call(this);
			},
			set(next: string) {
				writes += 1;
				descriptor.set?.call(this, next);
			},
		});
		e.harness.renderer.apply({
			revision: 2,
			patches: [
				{ op: "set-prop", id: 1, name: "placeholder", value: "anything" },
				{ op: "set-prop", id: 1, name: "value", value: "hello" },
			],
		});
		expect(writes).toBe(0);
		expect(element.value).toBe("hello");
		e.harness.renderer.apply(setValue(3, "hello there"));
		expect(writes).toBe(1);
		expect(element.value).toBe("hello there");
	});
});

describe("submit: Enter in TextInput", () => {
	it("Enter sends the last text and then submits, in that order", () => {
		const e = entry("text-input", { echo: true });
		e.element.value = "a message to send";
		e.enter();
		expect(e.harness.events).toEqual([
			{ handler: 7, payload: "a message to send" },
			{ handler: 9, payload: null },
		]);
	});

	it("text already sent is not sent again, and submit fires once", () => {
		const e = entry("text-input", { echo: true });
		e.typeText("a message to send");
		e.enter();
		expect(e.harness.events).toEqual([
			{ handler: 7, payload: "a message to send" },
			{ handler: 9, payload: null },
		]);
	});

	it("prevents Enter's default action", () => {
		const e = entry();
		expect(e.enter()).toBe(true);
	});

	it("nothing goes out without a submit handler", () => {
		const e = entry("text-input", { submit: false });
		e.element.value = "x";
		expect(e.enter()).toBe(false);
		expect(e.harness.events).toEqual([]);
	});

	/**
	 * Enter in a TextArea is a newline. The contract has no `onSubmit` (the prop table rejects it),
	 * and the renderer does not treat Enter as a commit for this kind.
	 */
	it("Enter in TextArea is not submit", () => {
		const e = entry("text-area");
		e.element.value = "first line";
		expect(e.enter()).toBe(false);
		expect(e.harness.events).toEqual([]);
	});

	it("TextArea does not take an onSubmit prop at all", () => {
		const harness = mount();
		expect(() =>
			harness.renderer.apply({
				revision: 1,
				patches: [
					{ op: "create", id: 1, kind: "text-area" },
					{ op: "set-prop", id: 1, name: "onSubmit", value: { $handler: 9 } },
					{ op: "insert", parent: 0, child: 1, index: 0 },
				],
			}),
		).toThrowError(expect.objectContaining({ code: "renderer_contract" }));
	});
});

describe("IME: Enter during composition is not submit", () => {
	/**
	 * Korean composition: `\u314e` → `\ud558` → `\ud55c`. Enter during composition confirms the candidate. Reading it
	 * as submit would send a sentence the user never sent.
	 */
	it("no submit goes out during composition, and the finished text goes out first when it ends", () => {
		const e = entry("text-input", { echo: true });
		e.compositionStart();
		for (const step of ["\u314e", "\ud558", "\ud55c"]) e.typeText(step);
		/** The composition state the renderer tracks is what blocks this Enter. */
		expect(e.enter()).toBe(false);
		e.compositionEnd("\ud55c");
		expect(e.harness.events).toEqual([
			{ handler: 7, payload: "ㅎ" },
			{ handler: 7, payload: "\ud558" },
			{ handler: 7, payload: "\ud55c" },
		]);
		expect(e.enter()).toBe(true);
		expect(e.harness.events).toEqual([
			{ handler: 7, payload: "ㅎ" },
			{ handler: 7, payload: "\ud558" },
			{ handler: 7, payload: "\ud55c" },
			{ handler: 9, payload: null },
		]);
	});

	/**
	 * Two facts are checked together: the composition state the renderer tracks, and the event's own
	 * `isComposing`. Neither alone covers every browser.
	 */
	it("does not submit when isComposing even if compositionstart was missed", () => {
		const e = entry();
		e.element.value = "\ud55c";
		expect(e.enter({ isComposing: true })).toBe(false);
		expect(e.harness.events).toEqual([]);
	});

	/**
	 * When composition ends, the last text is sent first, and then the controlled value is synced. If
	 * the order were reversed, a stale controlled value would be written to the DOM and the character
	 * just confirmed would disappear.
	 */
	it("sends the confirmed text at compositionend", () => {
		const e = entry("text-input", { echo: true });
		e.compositionStart();
		e.compositionEnd("\ud55c");
		expect(e.harness.events).toEqual([{ handler: 7, payload: "\ud55c" }]);
	});

	/**
	 * During composition the controlled value is not rewritten; doing so would break the composition
	 * at that point. Even after composition ends, the commit does not restore the screen immediately.
	 * The text just confirmed has already gone to the host, so the value before its answer arrives is
	 * older than what the user typed.
	 */
	it("a commit during composition does not touch the element's value and catches up after the answer", () => {
		const e = entry("text-input", { defer: true });
		e.compositionStart();
		/** Uncommitted IME characters. The browser draws these on the element directly. */
		e.element.value = "\ud558";
		e.commitValue("another commit");
		expect(e.element.value).toBe("\ud558");
		e.compositionEnd("\ud55c");
		expect(e.harness.events).toEqual([{ handler: 7, payload: "\ud55c" }]);
		expect(e.element.value).toBe("\ud55c");
		/**
		 * When the answer arrives, the controlled value takes over again. Here the author echoes the same
		 * value back.
		 */
		e.answer();
		expect(e.element.value).toBe("\ud55c");
	});
});

describe("async round trips: a stale commit does not revert the screen", () => {
	/**
	 * This is where jamo were duplicated or scrambled. In Korean, the moment one composition ends is
	 * also the moment the next starts (`\ud55c` confirmed, then `\ub140` starts). Assigning a controlled value
	 * one character old in between makes the IME redraw its composition range over the erased text.
	 */
	it("a late answer at the moment composition ends does not erase the confirmed character", () => {
		const e = entry("text-input", { defer: true });
		e.compositionStart();
		for (const step of ["\u314e", "\ud558", "\ud55c"]) e.typeText(step);
		/** Only one answer has arrived. Its value is `\u314e`, while the screen already shows `\ud55c`. */
		e.answer();
		expect(e.element.value).toBe("\ud55c");
		e.compositionEnd("\ud55c");
		expect(e.element.value).toBe("\ud55c");
		e.answer(e.unanswered());
		expect(e.element.value).toBe("\ud55c");
	});

	it("an old answer arriving during the next composition does not revert the screen", () => {
		const e = entry("text-input", { defer: true });
		e.compositionStart();
		e.typeText("\ud55c");
		e.compositionEnd("\ud55c");
		e.compositionStart();
		e.typeText("\ud55c\ub140");
		e.answer();
		expect(e.element.value).toBe("\ud55c\ub140");
		e.compositionEnd("\ud55c\ub140");
		e.answer(e.unanswered());
		expect(e.element.value).toBe("\ud55c\ub140");
	});

	/** The same holds without composition. When typing fast, answers always trail the screen. */
	it("a late answer does not rewind quickly typed characters", () => {
		const e = entry("text-input", { defer: true });
		for (const step of ["a", "ab", "abc"]) e.typeText(step);
		e.answer();
		expect(e.element.value).toBe("abc");
		e.answer();
		expect(e.element.value).toBe("abc");
		e.answer();
		expect(e.element.value).toBe("abc");
	});

	/**
	 * Waiting for answers does not mean giving up control. If the author trims the text and returns
	 * it, that value wins over the screen. This branch is why settling does not rely only on "equals
	 * the value sent".
	 */
	it("a value the creator trimmed and returned beats the screen", () => {
		const e = entry("text-input", {
			defer: true,
			transform: (value) => value.toUpperCase(),
		});
		e.typeText("ab");
		e.answer();
		expect(e.element.value).toBe("AB");
	});

	/**
	 * If the author swallows the character entirely (the cap blocks any change), no commit arrives and
	 * no answer ever comes. So that the input does not receive each later commit one step late, settle
	 * when focus leaves it.
	 */
	it("leaving the field, the controlled value takes the screen back without waiting for the answer", () => {
		const e = entry("text-input", { defer: true });
		e.typeText("text past the cap");
		expect(e.element.value).toBe("text past the cap");
		e.blur();
		e.commitValue("up to the cap");
		expect(e.element.value).toBe("up to the cap");
	});

	it("the controlled value sits on screen right at the moment of leaving", () => {
		const e = entry("text-input", { value: "fixed", defer: true });
		e.typeText("a value changed behind its back");
		expect(e.element.value).toBe("a value changed behind its back");
		e.blur();
		expect(e.element.value).toBe("fixed");
	});
});
