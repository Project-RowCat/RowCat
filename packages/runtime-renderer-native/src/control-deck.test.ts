import type { RuntimeCommandBatch } from "@rowcat/runtime-host/commands";
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import {
	createNativeRuntimeControlDeck,
	type NativeScrollHandle,
	type NativeTextEntryHandle,
} from "./control-deck.ts";
import { createNativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * What the control deck guards: whether the same command means the same thing as on web. There is
 * no React Native runtime in this file (building the tree needs a device test), so handles are
 * faked in place of real views. The file still answers its question. The deck knows only four
 * operations (scrollTo, scrollToEnd, focus, blur), and that narrowness is the point of the design.
 */

const SCREEN: RuntimePatchBatch = {
	revision: 1,
	patches: [
		{ op: "create", id: 1, kind: "scroll" },
		{ op: "set-prop", id: 1, name: "controller", value: { $control: 7 } },
		{ op: "create", id: 2, kind: "text-input" },
		{ op: "set-prop", id: 2, name: "value", value: "" },
		{ op: "set-prop", id: 2, name: "controller", value: { $control: 9 } },
		{ op: "insert", parent: 0, child: 1, index: 0 },
		{ op: "insert", parent: 0, child: 2, index: 1 },
	],
};

const commands = (
	revision: number,
	...list: RuntimeCommandBatch["commands"]
): RuntimeCommandBatch => ({ revision, commands: list });

interface FakeScroll extends NativeScrollHandle {
	calls: string[];
}
interface FakeEntry extends NativeTextEntryHandle {
	calls: string[];
}

const fakeScroll = (): FakeScroll => {
	const calls: string[] = [];
	return {
		calls,
		scrollTo: (options) =>
			calls.push(`to:${options.x ?? "-"},${options.y ?? "-"}`),
		scrollToEnd: () => calls.push("end"),
	};
};

const fakeEntry = (): FakeEntry => {
	const calls: string[] = [];
	return {
		calls,
		focus: () => calls.push("focus"),
		blur: () => calls.push("blur"),
	};
};

function harness() {
	const store = createNativeRuntimeTreeStore();
	const deck = createNativeRuntimeControlDeck({ store });
	const scroll = fakeScroll();
	const entry = fakeEntry();
	let versions = 0;
	deck.subscribe(() => {
		versions += 1;
	});
	return {
		store,
		deck,
		scroll,
		entry,
		get versions() {
			return versions;
		},
		attachAll() {
			deck.attach(1, scroll);
			deck.attach(2, entry);
		},
	};
}

describe("control deck", () => {
	it("commands apply **one frame later**: not executed on arrival", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "end" }));
		/**
		 * Native diverges from web here. The store has committed, but React has not drawn yet, so
		 * measuring now gives the end before the content has grown.
		 */
		expect(h.scroll.calls).toEqual([]);
		expect(h.deck.pending).toBe(1);
		/**
		 * A new version bumps the surface so it redraws. The effect that runs after that commit then
		 * drains the pending queue.
		 */
		expect(h.versions).toBe(1);
		h.deck.flush();
		expect(h.scroll.calls).toEqual(["end"]);
		expect(h.deck.pending).toBe(0);
	});

	it("vertical and horizontal touch one axis only: the same rule as the web", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "start" }));
		h.deck.apply(
			commands(1, { op: "scroll", control: 7, to: "offset", offset: 240 }),
		);
		h.deck.flush();
		expect(h.scroll.calls).toEqual(["to:-,0", "to:-,240"]);

		h.store.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 1, name: "horizontal", value: true }],
		});
		h.scroll.calls.length = 0;
		h.deck.apply(
			commands(2, { op: "scroll", control: 7, to: "offset", offset: 60 }),
		);
		h.deck.flush();
		expect(h.scroll.calls).toEqual(["to:60,-"]);
	});

	it("gives and takes focus", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(
			commands(1, { op: "focus", control: 9 }, { op: "blur", control: 9 }),
		);
		h.deck.flush();
		expect(h.entry.calls).toEqual(["focus", "blur"]);
	});

	it("nothing happens to a disabled input", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.store.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 2, name: "disabled", value: true }],
		});
		h.deck.apply(commands(2, { op: "focus", control: 9 }));
		h.deck.flush();
		expect(h.entry.calls).toEqual([]);
	});

	it("command order is kept", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(
			commands(
				1,
				{ op: "scroll", control: 7, to: "start" },
				{ op: "scroll", control: 7, to: "end" },
			),
		);
		h.deck.flush();
		expect(h.scroll.calls).toEqual(["to:-,0", "end"]);
	});

	it("a command of the wrong kind does nothing", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(commands(1, { op: "focus", control: 7 }));
		h.deck.flush();
		expect(h.entry.calls).toEqual([]);
		expect(h.scroll.calls).toEqual([]);
	});

	it("bundles with mismatched revisions are dropped", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(commands(9, { op: "scroll", control: 7, to: "end" }));
		h.deck.flush();
		expect(h.scroll.calls).toEqual([]);
	});

	it("unbound controllers and handle-less nodes pass quietly", () => {
		const h = harness();
		h.store.apply(SCREEN);
		/** The handle is not attached yet, since React has not drawn. */
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "end" }));
		h.deck.flush();
		expect(h.scroll.calls).toEqual([]);
		h.attachAll();
		h.deck.apply(commands(1, { op: "focus", control: 999 }));
		h.deck.flush();
		expect(h.entry.calls).toEqual([]);
	});

	it("pending never survives more than one flush", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "end" }));
		/**
		 * Clears the pending entry even though the target was not found. The command is not held until
		 * the next frame.
		 */
		h.deck.flush();
		expect(h.deck.pending).toBe(0);
		h.attachAll();
		h.deck.flush();
		expect(h.scroll.calls).toEqual([]);
	});

	it("when a node vanishes its controller's commands do nothing", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.store.apply({ revision: 2, patches: [{ op: "remove", id: 2 }] });
		h.deck.apply(commands(2, { op: "focus", control: 9 }));
		h.deck.flush();
		expect(h.entry.calls).toEqual([]);
	});

	it("removing the prop removes it from the table too", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.store.apply({
			revision: 2,
			patches: [{ op: "remove-prop", id: 1, name: "controller" }],
		});
		h.deck.apply(commands(2, { op: "scroll", control: 7, to: "end" }));
		h.deck.flush();
		expect(h.scroll.calls).toEqual([]);
	});

	it("a reorder does not break binding", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.store.apply({
			revision: 2,
			patches: [{ op: "move", parent: 0, child: 1, index: 1 }],
		});
		h.deck.apply(commands(2, { op: "scroll", control: 7, to: "end" }));
		h.deck.flush();
		expect(h.scroll.calls).toEqual(["end"]);
	});

	it("detaching a handle leaves that node uncontrolled", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.attach(1, null);
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "end" }));
		h.deck.flush();
		expect(h.scroll.calls).toEqual([]);
	});

	it("disposing leaves neither pending nor handles", () => {
		const h = harness();
		h.store.apply(SCREEN);
		h.attachAll();
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "end" }));
		h.deck.dispose();
		expect(h.deck.pending).toBe(0);
		h.deck.flush();
		expect(h.scroll.calls).toEqual([]);
		/** Commands arriving after dispose are also rejected. */
		h.deck.apply(commands(1, { op: "scroll", control: 7, to: "end" }));
		expect(h.deck.pending).toBe(0);
	});
});
