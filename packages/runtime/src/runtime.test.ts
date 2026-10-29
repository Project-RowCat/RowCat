import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { RUNTIME_PACKAGE_SOURCES } from "./declarations/index.ts";
import * as runtime from "./index.ts";
import {
	Button,
	defineStoryState,
	isRuntimeElement,
	isRuntimeHostComponent,
	isSerializable,
	RUNTIME_ERROR_CODE,
	RuntimeError,
	runtimeHostKindOf,
	Screen,
	Stack,
	Text,
	useState,
} from "./index.ts";
import {
	hasRuntimeDispatcher,
	setRuntimeDispatcher,
} from "./internal/dispatcher.ts";
import { resetDurableStateRuntime } from "./internal/durable-hydrate.ts";
import { jsxDEV } from "./jsx-dev-runtime.ts";
import { Fragment, jsx, jsxs } from "./jsx-runtime.ts";
import { RUNTIME_SANDBOX_MODULES } from "./sandbox/index.ts";

/**
 * What the runtime contract guards: identity, failure modes, and serializability. Render output is
 * not checked here because there is no reconciler yet. The value of these tests is the properties
 * the VM will rely on later. A change that breaks them still compiles, so the tests must catch it.
 */

describe("elements are not React's", () => {
	it("jsx makes runtime elements marked by a symbol", () => {
		const element = jsx(Text, { children: "hello" });
		expect(isRuntimeElement(element)).toBe(true);
		expect(element.type).toBe(Text);
		expect(element.props).toEqual({ children: "hello" });
		expect(element.key).toBeNull();
	});

	it("a plain object is not an element: JSON cannot carry symbols", () => {
		const forged = JSON.parse(
			JSON.stringify({ type: "text", props: {}, key: null }),
		) as unknown;
		expect(isRuntimeElement(forged)).toBe(false);
	});

	it("jsxs makes the same shape and carries key", () => {
		expect(jsxs(Stack, { children: [] }, "a").key).toBe("a");
	});

	it("the dev transform makes the same element too, carrying no position", () => {
		const element = jsxDEV(Text, { children: "x" }, undefined, false, {
			fileName: "src/main.tsx",
		});
		expect(isRuntimeElement(element)).toBe(true);
		expect(Object.keys(element)).toEqual(["$$typeof", "type", "props", "key"]);
	});

	it("Fragment is a symbol: not judged by name", () => {
		expect(typeof Fragment).toBe("symbol");
	});

	it("props are frozen", () => {
		const element = jsx(Text, { children: "x" });
		expect(Object.isFrozen(element.props)).toBe(true);
	});
});

describe("host primitive identity", () => {
	it("identified by symbol and answers its vocabulary", () => {
		expect(runtimeHostKindOf(Screen)).toBe("screen");
		expect(runtimeHostKindOf(Stack)).toBe("stack");
		expect(runtimeHostKindOf(Button)).toBe("button");
	});

	/**
	 * The most useful test in this file. A reconciler that identifies elements by name reads every
	 * element as unknown in a minified bundle, and the failure does not reproduce in development
	 * builds.
	 */
	it("the function name does not state the vocabulary", () => {
		for (const primitive of [Screen, Stack, Text, Button])
			expect(primitive.name).not.toBe(runtimeHostKindOf(primitive));
	});

	it("a plain function is not a primitive", () => {
		const impostor = function Stack() {
			return null;
		};
		expect(isRuntimeHostComponent(impostor)).toBe(false);
		expect(runtimeHostKindOf(impostor)).toBeNull();
	});

	it("calling it directly throws: a place unreachable on the normal path", () => {
		expect(() => (Screen as unknown as () => void)()).toThrowError(
			RuntimeError,
		);
	});

	it("the mark cannot be overwritten", () => {
		expect(Object.isFrozen(Stack)).toBe(true);
	});
});

describe("hooks do not fail silently without a dispatcher", () => {
	it("throws deterministically outside render", () => {
		expect(hasRuntimeDispatcher()).toBe(false);
		try {
			useState(0);
			throw new Error("did not throw");
		} catch (error) {
			expect(error).toBeInstanceOf(RuntimeError);
			expect((error as RuntimeError).code).toBe(
				RUNTIME_ERROR_CODE.hookOutsideRender,
			);
		}
	});

	it("defers to the dispatcher when one is set", () => {
		const calls: string[] = [];
		const previous = setRuntimeDispatcher({
			useState: <S>(initial: S | (() => S)) => {
				calls.push("useState");
				return [initial as S, () => {}] as [S, (action: unknown) => void];
			},
			useReducer: (() => [null, () => {}]) as never,
			useMemo: ((factory: () => unknown) => factory()) as never,
			useRef: ((initial: unknown) => ({ current: initial })) as never,
			useEffect: () => {},
			useStoryState: (() => [null, () => {}]) as never,
			usePersistentState: (() => [null, () => {}]) as never,
		});
		try {
			const [value] = useState(7);
			expect(value).toBe(7);
			expect(calls).toEqual(["useState"]);
		} finally {
			setRuntimeDispatcher(previous);
		}
	});
});

describe("capabilities this version opens and does not open", () => {
	/**
	 * Locks the absence of other capabilities by value. Once a name appears at the root, creators
	 * assume it works. Story state and generation exist; the other capabilities must not, so that
	 * capability families do not open one slice at a time.
	 */
	it("useStoryState, usePersistentState and useGeneration exist; no other capabilities do", () => {
		const names = Object.keys(runtime);
		expect(names).toContain("useStoryState");
		expect(names).toContain("defineStoryState");
		expect(names).toContain("useGeneration");
		expect(names).toContain("usePersistentState");
		expect(names).toContain("definePersistentState");
		for (const absent of [
			"useNavigation",
			"useAudio",
			"useAsset",
			"useNetwork",
		])
			expect(names, absent).not.toContain(absent);
	});

	/**
	 * The generation request contract is narrow by value. Creators have no way to choose a provider in
	 * this version. The key set of the request type expresses that, and adding a field would soon be
	 * followed by a screen that fills it.
	 */
	it("generation requests have no slot for provider, model or key", async () => {
		const source = await readFile(
			new URL("./generation.ts", import.meta.url),
			"utf8",
		);
		const shape = source.slice(
			source.indexOf("interface RuntimeGenerationRequest"),
			source.indexOf("interface RuntimeGenerationResult"),
		);
		for (const absent of [
			"provider",
			"model",
			"apiKey",
			"temperature",
			"reasoning",
			"stream",
		])
			expect(shape, absent).not.toContain(absent);
	});

	/**
	 * Section 35: three surfaces must know the same names. Creator code uses names from three places:
	 * this package's values, the declared assets that tooling reads, and the sandbox artifacts
	 * installed into the VM. If one surface lacks a name, compilation still passes and the failure
	 * appears only in the work that uses that name. An autocompleted name can become a SyntaxError in
	 * the VM.
	 */
	it.each([
		"TextInput",
		"TextArea",
		"useGeneration",
	])("%s is in all three: values, declarations and the sandbox", (name) => {
		expect(Object.keys(runtime)).toContain(name);
		const declared = RUNTIME_PACKAGE_SOURCES.map((file) => file.content).join(
			"\n",
		);
		expect(declared).toMatch(new RegExp(`export (const|function) ${name}\\b`));
		const sandboxed = RUNTIME_SANDBOX_MODULES.map(
			(module) => module.source,
		).join("\n");
		expect(sandboxed).toContain(name);
	});

	/**
	 * Strips comments, then checks that the declared asset carries no React, DOM, or React Native
	 * types. If such types leaked, the creator program would know them, and `<div>` or
	 * NativeSyntheticEvent would type-check. Comments are stripped first because several headers
	 * explain why these names are absent. A check that failed on those explanations would tempt
	 * someone to delete the explanations.
	 */
	it("platform vocabulary does not leak into declared assets", () => {
		const declared = RUNTIME_PACKAGE_SOURCES.map((file) => file.content)
			.join("\n")
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/(^|[^:])\/\/.*$/gm, "$1");
		for (const absent of [
			'from "react"',
			'from "react-native"',
			'from "react/jsx-runtime"',
			"HTMLInputElement",
			"HTMLTextAreaElement",
			"KeyboardEvent",
			"NativeSyntheticEvent",
			"ChangeEvent",
			"ReactNode",
		])
			expect(declared, absent).not.toContain(absent);
	});

	/**
	 * The snapshot belongs to the host. No creator function reads or writes the whole story state. If
	 * one existed, the storage format would become the creator API, and this version has not decided
	 * that format.
	 */
	it("names that open snapshots are not in the public vocabulary", () => {
		const names = Object.keys(runtime);
		for (const absent of [
			"hydrateStoryState",
			"readStoryState",
			"commitStoryState",
			"storyStateSnapshot",
			"resetDurableStateRuntime",
			"hydratePersistentState",
			"readPersistentState",
			"commitPersistentState",
		])
			expect(names, absent).not.toContain(absent);
	});
});

describe("story state", () => {
	/**
	 * The registry belongs to one session. A host process such as vitest runs several sessions, and
	 * defining the same key twice is valid within one session, so tests reset the registry before each
	 * run.
	 */
	beforeEach(() => {
		resetDurableStateRuntime();
	});

	it("returns the definition frozen", () => {
		const state = defineStoryState({
			key: "game",
			version: 1,
			initial: { count: 0 },
		});
		expect(state.key).toBe("game");
		expect(Object.isFrozen(state)).toBe(true);
	});

	it("refuses empty keys and invalid versions", () => {
		for (const bad of [
			{ key: "", version: 1, initial: {} },
			{ key: "1game", version: 1, initial: {} },
			{ key: "game", version: 0, initial: {} },
			{ key: "game", version: 1.5, initial: {} },
			{ key: "game", version: -1, initial: {} },
			{ key: "game", version: Number.MAX_SAFE_INTEGER + 2, initial: {} },
		])
			expect(() => {
				resetDurableStateRuntime();
				defineStoryState(bad);
			}).toThrowError(RuntimeError);
	});

	/**
	 * When the version cap was 1, this line meant 'rejects version 99'. Migrations now exist, so the
	 * version is the creator schema's version, and the runtime has no reason to reject a high value.
	 */
	it("higher versions can be defined too: the version belongs to the creator's schema", () => {
		expect(
			defineStoryState({ key: "game", version: 12, initial: {} }).version,
		).toBe(12);
	});

	it("refuses defining the same key twice", () => {
		defineStoryState({ key: "game", version: 1, initial: {} });
		expect(() =>
			defineStoryState({ key: "game", version: 1, initial: {} }),
		).toThrowError(RuntimeError);
	});

	/** Values the types forbid but that arrive through `as` casts. The runtime is the last check. */
	it("refuses initial values that do not serialize", () => {
		expect(() =>
			defineStoryState({
				key: "game",
				version: 1,
				initial: { at: new Date() } as unknown as Record<string, never>,
			}),
		).toThrowError(RuntimeError);
	});

	it("serialization check: refuses cycles, passes deep values", () => {
		expect(isSerializable({ a: [1, "b", null, { c: true }] })).toBe(true);
		expect(isSerializable(Number.NaN)).toBe(false);
		expect(isSerializable(undefined)).toBe(false);
		expect(isSerializable(() => {})).toBe(false);
		expect(isSerializable(new Map())).toBe(false);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(isSerializable(cyclic)).toBe(false);
	});
});

describe("there is no React", () => {
	it("no module of this package imports react", async () => {
		const { readFileSync, readdirSync, statSync } = await import("node:fs");
		const { join } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const here = fileURLToPath(new URL(".", import.meta.url));
		const offenders: string[] = [];
		const walk = (root: string): void => {
			for (const name of readdirSync(root)) {
				const path = join(root, name);
				if (statSync(path).isDirectory()) {
					walk(path);
					continue;
				}
				if (!name.endsWith(".ts") || name.includes(".test.")) continue;
				if (/from\s+"react/.test(readFileSync(path, "utf8")))
					offenders.push(path.slice(here.length));
			}
		};
		walk(here);
		expect(offenders).toEqual([]);
	});
});
