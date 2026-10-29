import { ROOT_HOST_NODE_ID } from "@rowcat/runtime-host/patches";
import {
	createNativeRuntimeTreeStore,
	type NativeRuntimeTreeStore,
} from "@rowcat/runtime-renderer-native/tree-store";
import { describe, expect, it } from "vitest";
import { firstPressHandler, runInteractionBenchmark } from "./benchmark.ts";

/** `Stack > Button(onPress 41) + Text`, the same shape as the fixture. */
function seeded(): NativeRuntimeTreeStore {
	const store = createNativeRuntimeTreeStore();
	store.apply({
		revision: 1,
		patches: [
			{ op: "create", id: 1, kind: "stack" },
			{ op: "create", id: 2, kind: "text" },
			{ op: "create", id: 3, kind: "button" },
			{ op: "set-prop", id: 3, name: "onPress", value: { $handler: 41 } },
			{ op: "insert", parent: 1, child: 2, index: 0 },
			{ op: "insert", parent: 1, child: 3, index: 1 },
			{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
		],
	});
	return store;
}

const never = () => new Promise<void>(() => {});

describe("the tree answers what to press", () => {
	it("picks the first pressable's number", () => {
		expect(firstPressHandler(seeded())).toBe(41);
	});

	it("doesn't pick a disabled node", () => {
		const store = seeded();
		store.apply({
			revision: 2,
			patches: [{ op: "set-prop", id: 3, name: "disabled", value: true }],
		});
		expect(firstPressHandler(store)).toBeNull();
	});

	it("doesn't invent anything when there's nothing to press", () => {
		expect(firstPressHandler(createNativeRuntimeTreeStore())).toBeNull();
	});
});

describe("repetition", () => {
	/**
	 * Handler ids change on every commit. Repeating with a cached id would point at a released id from
	 * the second press on, and the VM would silently discard it. This check locks that failure by
	 * value.
	 */
	it("re-reads the number every iteration", async () => {
		const store = seeded();
		const asked: number[] = [];
		let handler = 41;
		let revision = 1;
		await runInteractionBenchmark({
			target: {
				store,
				dispatchEvent(id) {
					asked.push(id);
					/** A new function per render: the reconciler gives it a new id. */
					handler += 1;
					revision += 1;
					store.apply({
						revision,
						patches: [
							{
								op: "set-prop",
								id: 3,
								name: "onPress",
								value: { $handler: handler },
							},
						],
					});
				},
			},
			handlerFor: (t) => firstPressHandler(t.store),
			iterations: 3,
			timeoutMs: 1000,
			delay: never,
			yieldTurn: () => Promise.resolve(),
		});
		expect(asked).toEqual([41, 42, 43]);
	});

	it("waits for one commit before pressing the next", async () => {
		const store = seeded();
		const pressed: number[] = [];
		let revision = 1;
		const outcome = await runInteractionBenchmark({
			target: {
				store,
				dispatchEvent(handlerId) {
					pressed.push(handlerId);
					/** As if the bridge answered: one commit is applied to the store. */
					revision += 1;
					store.apply({
						revision,
						patches: [{ op: "set-prop", id: 2, name: "style", value: null }],
					});
				},
			},
			handlerFor: (t) => firstPressHandler(t.store),
			iterations: 3,
			timeoutMs: 1000,
			delay: never,
			yieldTurn: () => Promise.resolve(),
		});
		expect(outcome).toEqual({ ok: true, completed: 3 });
		expect(pressed).toEqual([41, 41, 41]);
	});

	it("stops at a bridge that doesn't answer", async () => {
		const store = seeded();
		const outcome = await runInteractionBenchmark({
			target: { store, dispatchEvent: () => {} },
			handlerFor: (t) => firstPressHandler(t.store),
			iterations: 5,
			timeoutMs: 1,
			delay: () => Promise.resolve(),
			yieldTurn: () => Promise.resolve(),
		});
		expect(outcome).toEqual({ ok: false, completed: 0, reason: "timeout" });
	});

	it("doesn't start from a stopped store", async () => {
		const store = seeded();
		store.dispose();
		const outcome = await runInteractionBenchmark({
			target: { store, dispatchEvent: () => {} },
			handlerFor: (t) => firstPressHandler(t.store),
			iterations: 5,
			timeoutMs: 1,
			delay: never,
			yieldTurn: () => Promise.resolve(),
		});
		expect(outcome).toEqual({ ok: false, completed: 0, reason: "failed" });
	});
});
