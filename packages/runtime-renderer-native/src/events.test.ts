import {
	ROOT_HOST_NODE_ID,
	type RuntimePatch,
	type RuntimePatchBatch,
} from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import { pressHandlerOf, textEntryBindingOf } from "./events.ts";
import { createNativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * Native wiring of text entry: what the renderer passes to React Native. The prop table
 * (props.test.ts) answers what is received; this answers what is passed on. The second question
 * needs its own test because the wiring lives in JSX and this repo's tests cannot run React Native.
 *
 * Only handler numbers and strings cross the bridge. No NativeSyntheticEvent, nativeEvent or native
 * view reference is part of this contract, and the shape of the wiring shows that.
 */

const entryNode = (
	kind: "text-input" | "text-area",
	props: RuntimePatch[] = [],
): RuntimePatchBatch => ({
	revision: 1,
	patches: [
		{ op: "create", id: 1, kind },
		...props,
		{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
	],
});

function bind(kind: "text-input" | "text-area", props: RuntimePatch[] = []) {
	const store = createNativeRuntimeTreeStore();
	store.apply(entryNode(kind, props));
	const node = store.node(1);
	if (node === null) throw new Error("no entry node");
	return textEntryBindingOf(node);
}

describe("text input wiring", () => {
	it("the controlled value and placeholder go as is", () => {
		expect(
			bind("text-input", [
				{ op: "set-prop", id: 1, name: "value", value: "hello" },
				{
					op: "set-prop",
					id: 1,
					name: "placeholder",
					value: "Type a message…",
				},
			]),
		).toEqual({
			multiline: false,
			value: "hello",
			placeholder: "Type a message…",
			editable: true,
			changeHandler: null,
			submitHandler: null,
		});
	});

	it("handlers go only as numbers: the functions stay inside the VM", () => {
		const binding = bind("text-input", [
			{ op: "set-prop", id: 1, name: "onChangeText", value: { $handler: 7 } },
			{ op: "set-prop", id: 1, name: "onSubmit", value: { $handler: 9 } },
		]);
		expect(binding.changeHandler).toBe(7);
		expect(binding.submitHandler).toBe(9);
	});

	/**
	 * Section 8: in multi-line input, Enter inserts a newline. No submit wiring is set up for TextArea
	 * at all.
	 */
	it("TextArea is multi-line with no submit", () => {
		const binding = bind("text-area", [
			{ op: "set-prop", id: 1, name: "onChangeText", value: { $handler: 7 } },
		]);
		expect(binding.multiline).toBe(true);
		expect(binding.submitHandler).toBeNull();
	});

	/**
	 * Section 7: inactive inputs produce no events. RN's editable={false} already blocks them, but
	 * since that prop is often misused as visual-only, no wiring is attached.
	 */
	it("disabled inputs get no wiring", () => {
		const binding = bind("text-input", [
			{ op: "set-prop", id: 1, name: "value", value: "unchanged" },
			{ op: "set-prop", id: 1, name: "disabled", value: true },
			{ op: "set-prop", id: 1, name: "onChangeText", value: { $handler: 7 } },
			{ op: "set-prop", id: 1, name: "onSubmit", value: { $handler: 9 } },
		]);
		expect(binding.editable).toBe(false);
		expect(binding.changeHandler).toBeNull();
		expect(binding.submitHandler).toBeNull();
		/** The value is still rendered as given. It must remain readable even when inactive. */
		expect(binding.value).toBe("unchanged");
	});

	/**
	 * Replacing a handler issues a new number. A late event on the old number is silently dropped by
	 * the host.
	 */
	it("swapping the handler sends the new number", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(
			entryNode("text-input", [
				{ op: "set-prop", id: 1, name: "onChangeText", value: { $handler: 7 } },
			]),
		);
		store.apply({
			revision: 2,
			patches: [
				{ op: "set-prop", id: 1, name: "onChangeText", value: { $handler: 8 } },
			],
		});
		const node = store.node(1);
		if (node === null) throw new Error("no entry node");
		expect(textEntryBindingOf(node).changeHandler).toBe(8);
		store.apply({
			revision: 3,
			patches: [{ op: "remove-prop", id: 1, name: "onChangeText" }],
		});
		const cleared = store.node(1);
		if (cleared === null) throw new Error("no entry node");
		expect(textEntryBindingOf(cleared).changeHandler).toBeNull();
	});

	/**
	 * The wiring has six slots, and this list is the contract. Each added slot must state what it
	 * means. This list is the only route by which a creator's arbitrary prop can become an RN prop.
	 */
	it("the list of passed cells is the contract", () => {
		expect(Object.keys(bind("text-input")).sort()).toEqual([
			"changeHandler",
			"editable",
			"multiline",
			"placeholder",
			"submitHandler",
			"value",
		]);
	});
});

describe("press wiring", () => {
	it("disabled pressables emit no number", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "button" },
				{ op: "set-prop", id: 1, name: "onPress", value: { $handler: 3 } },
				{ op: "set-prop", id: 1, name: "disabled", value: true },
				{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
			],
		});
		const node = store.node(1);
		if (node === null) throw new Error("no button");
		expect(pressHandlerOf(node)).toBeNull();
	});
});
