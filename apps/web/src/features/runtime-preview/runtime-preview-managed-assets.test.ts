import {
	authorizeRuntimeAssetResolver,
	bindRuntimeAssetResolver,
	EMPTY_REMOTE_ASSET_ALLOWLIST,
	runtimeManagedAssetBindings,
} from "@rowcat/runtime/asset";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { compileRuntimeProject } from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import {
	createRuntimeVmSession,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { testEngine } from "@rowcat/runtime-host/test/fixtures";
import {
	type TestHostNode,
	TestHostTree,
} from "@rowcat/runtime-host/testing/host-tree";
import { afterEach, describe, expect, it } from "vitest";
import { currentRuntimeProjectSnapshot } from "#/features/runtime-studio/compile/source-snapshot.ts";
import { createWebRuntimeAssetResolver } from "#/lib/runtime-assets/web-asset-resolver.ts";

/**
 * The chain where a logical name becomes an actual picture: compiler, QuickJS, patch bundle,
 * resolver. Two claims cannot be checked by value tests, so this uses the real compiler and real
 * VM.
 * - What the VM emits: `{ "$asset": "characters/sena/smile" }`, a name rather than an identity.
 * - Where that name becomes an identity: a single binding table in the trusted layer. The first
 *   matters most. The claim that creator code cannot see media identity holds only if it is
 *   verified by looking at what the reconciler actually exports. If identity began to be carried
 *   there, this slice's boundary would collapse, and the logical name would just be a wrapped media
 *   id.
 */

const environment = nodeRuntimeEnvironment();

/**
 * Live sessions. Any left over keep their WASM instance pinned, so they are disposed after each
 * test.
 */
const live: RuntimeVmSession[] = [];

afterEach(async () => {
	for (const session of live.splice(0, live.length)) await session.dispose();
});

/**
 * A minimal runtime calling two logical names: one a literal, the other assembled at run time. The
 * second is the point of the file. A remote address becomes a placeholder when assembled, but a
 * logical name does not, and that asymmetry is only confirmed by running through the VM.
 */
const SOURCE = `import { Image, Screen, asset } from "@rowcat/runtime";

const face = "smile";

export default function App() {
	return (
		<Screen>
			<Image source={asset("backgrounds/library")} alt="library" />
			<Image source={asset(\`characters/sena/\${face}\`)} alt="Sena" />
		</Screen>
	);
}
`;

async function mount(source: string): Promise<TestHostTree> {
	const result = compileRuntimeProject(
		{
			apiVersion: RUNTIME_API_VERSION,
			entry: "src/main.tsx",
			files: [{ path: "src/main.tsx", content: source }],
		},
		environment,
	);
	if (!result.ok)
		throw new Error(
			result.diagnostics.map((diagnostic) => diagnostic.message).join(" / "),
		);
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: result.artifact,
	});
	live.push(session);
	const tree = new TestHostTree();
	const outcome = await session.mountRoot({
		onCommit: (batch) => tree.apply(batch),
	});
	if (!outcome.ok) throw outcome.error;
	await session.settle();
	return tree;
}

/** Collects each Image's source prop: the value the VM actually exported. */
function imageSources(tree: TestHostTree): unknown[] {
	const out: unknown[] = [];
	const walk = (node: TestHostNode): void => {
		if (node.kind === "image" && node.props.source !== undefined)
			out.push(node.props.source);
		for (const child of node.children) walk(child);
	};
	walk(tree.root);
	return out;
}

const mediaUrl = (mediaId: string) =>
	`https://api.rowcat.test/v2/media/${mediaId}`;
const runtimeAssetUrl = (remote: string) =>
	`https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent(remote)}`;

describe("the logical name crosses out of the VM", () => {
	it("what the VM emits is a name, not a media identity", async () => {
		const sources = imageSources(await mount(SOURCE));
		expect(sources).toEqual([
			{ $asset: "backgrounds/library" },
			{ $asset: "characters/sena/smile" },
		]);
		/** If media identity appeared in that value, this slice's boundary would collapse. */
		expect(JSON.stringify(sources)).not.toContain("media-");
	});

	/**
	 * A name assembled at run time crosses through unchanged. This is where it differs from a remote
	 * address: the artifact's static list authorizes remote addresses, while the published bundle's
	 * table authorizes these names.
	 */
	it("an assembled name arrives as finished text", async () => {
		const sources = imageSources(await mount(SOURCE));
		expect(sources).toContainEqual({ $asset: "characters/sena/smile" });
	});
});

/**
 * Checks whether the VM's exported value becomes an address through the resolver. It imitates what
 * the renderer does: classify the string by kind and pass it to the composed resolver. Those two
 * steps live in the web renderer, so they are verified here by value only.
 */
describe("the binding turns that name into an address", () => {
	const resolver = (
		bindings: { path: string; assetId: string; kind?: "image" | "audio" }[],
	) =>
		authorizeRuntimeAssetResolver(
			() => EMPTY_REMOTE_ASSET_ALLOWLIST,
			bindRuntimeAssetResolver(
				() => runtimeManagedAssetBindings(bindings),
				createWebRuntimeAssetResolver({ mediaUrl, runtimeAssetUrl }),
			),
		);

	const resolve = (
		bindings: { path: string; assetId: string; kind?: "image" | "audio" }[],
	): ((value: string) => string | null) => {
		const composed = resolver(bindings);
		return (value: string) =>
			composed({ kind: "logical", path: value }, "image");
	};

	it("a name in the table becomes a RowCat media address", async () => {
		const sources = imageSources(await mount(SOURCE));
		const answer = resolve([
			{ path: "characters/sena/smile", assetId: "media-A" },
			{ path: "backgrounds/library", assetId: "media-B" },
		]);
		expect(
			sources.map((source) => answer((source as { $asset: string }).$asset)),
		).toEqual([mediaUrl("media-B"), mediaUrl("media-A")]);
	});

	/**
	 * If the kind does not match, no address is built. This is not a filter; assembly itself never
	 * happens. Relying on the browser's decode failure would mean the request already went out, and it
	 * could target media this session is not allowed to open.
	 */
	it("a sound name does not resolve in Image, and the reverse holds too", () => {
		const composed = resolver([
			{ path: "characters/sena/smile", assetId: "media-A", kind: "image" },
			{ path: "audio/bgm/main", assetId: "media-B", kind: "audio" },
		]);
		const ask = (path: string, expect_: "image" | "audio") =>
			composed({ kind: "logical", path }, expect_);

		expect(ask("characters/sena/smile", "image")).toBe(mediaUrl("media-A"));
		expect(ask("audio/bgm/main", "audio")).toBe(mediaUrl("media-B"));
		expect(ask("audio/bgm/main", "image")).toBeNull();
		expect(ask("characters/sena/smile", "audio")).toBeNull();
	});

	/**
	 * An old binding without a kind is an image. Before this version every managed asset was an image,
	 * so the missing kind is itself the fact, and it does not open as audio.
	 */
	it("a binding without a kind opens only as an image", () => {
		const composed = resolver([
			{ path: "characters/sena/smile", assetId: "media-A" },
		]);
		expect(
			composed({ kind: "logical", path: "characters/sena/smile" }, "image"),
		).toBe(mediaUrl("media-A"));
		expect(
			composed({ kind: "logical", path: "characters/sena/smile" }, "audio"),
		).toBeNull();
	});

	/**
	 * If the table is empty, both are placeholders. That is a normal state during authoring, not an
	 * error.
	 */
	it("an empty table makes everything a placeholder", async () => {
		const sources = imageSources(await mount(SOURCE));
		const answer = resolve([]);
		expect(
			sources.map((source) => answer((source as { $asset: string }).$asset)),
		).toEqual([null, null]);
	});
});

/**
 * What the preview sends to the worker. Bindings do not cross this boundary. The snapshot carries
 * assets (the resolver reads them), but the worker's start message carries only entry and files.
 * The VM emits logical names as they are and need not know identities, and neither media bytes nor
 * addresses have a reason to cross the isolation boundary.
 */
describe("what the snapshot carries", () => {
	const snapshot = currentRuntimeProjectSnapshot({
		files: [{ id: "f1", path: "src/main.tsx", content: SOURCE }],
		entry: "src/main.tsx",
		edited: new Map(),
		assets: [
			{ path: "characters/sena/smile", assetId: "media-A", kind: "image" },
			{ path: "audio/bgm/main", assetId: "media-B", kind: "audio" },
		],
	});

	it("the snapshot carries bindings, kind included", () => {
		expect(snapshot.assets).toEqual([
			{ path: "characters/sena/smile", assetId: "media-A", kind: "image" },
			{ path: "audio/bgm/main", assetId: "media-B", kind: "audio" },
		]);
	});

	/**
	 * The worker receives only source. This pins by value that the start fields the preview hook sends
	 * are exactly these two; the protocol's start message has no asset slot.
	 */
	it("the shape sent to the worker has no bindings", () => {
		const start = {
			entry: snapshot.entry,
			files: snapshot.files.map((file) => ({
				path: file.path,
				content: file.content,
			})),
		};
		expect(Object.keys(start).sort()).toEqual(["entry", "files"]);
		expect(JSON.stringify(start)).not.toContain("media-A");
	});
});
