import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { compileRuntimeProject } from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import { build } from "esbuild";

/**
 * Native runtime generated artifacts: the harness HTML and the QuickJS WASM asset.
 *
 * ```text
 * runtime-vm-harness/entry.ts ──esbuild──▶ IIFE ──▶ one HTML page ──base64──▶ harness.generated.ts
 * @jitl/…/dist/emscripten-module.wasm ──bytes verbatim──▶ assets/runtime/quickjs-ng.wasm
 * ```
 *
 * The WASM is an app asset, not a string inside the bundle. It used to be inlined by esbuild's
 * `base64` loader and then base64-encoded again into `harness.generated.ts` (1,175 KiB), which
 * bloated the release JS bundle, held the string in memory at launch, and re-committed 1 MiB on
 * every harness edit. The harness now `fetch`es it from its own document's origin
 * (`runtime/quickjs-ng.wasm`); the native transport provides that origin (Android
 * `shouldInterceptRequest`, iOS a readable file directory). Do not re-wrap the bytes in base64 and
 * send them over the bridge.
 *
 * `--check` rebuilds both and compares them. The WASM is compared by bytes, not hash: a recorded
 * hash would still pass in a deployment where the asset file is missing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ENTRY = join(ROOT, "runtime-vm-harness/entry.ts");
const ASSETS = join(ROOT, "modules/rowcat-runtime-webview/assets/runtime");
const HARNESS_ASSET = join(ASSETS, "harness.html");
const WASM_ASSET = join(ASSETS, "quickjs-ng.wasm");
const MANIFEST = join(ROOT, "src/lib/runtime-native/runtime-assets.generated.ts");
const FIXTURE = join(ROOT, "src/lib/runtime-native/fixture.generated.ts");

/**
 * Authoring source for the dev/acceptance fixture. It is never compiled on-device: mobile is the
 * playback side, so a repository tool compiles it and commits the artifact, which also keeps the
 * TypeScript compiler out of this app's bundle.
 *
 * It is a counter to measure one bridge crossing and one reconcile: a press sends one commit
 * containing one `set-text`. A large tree would make layout dominate and hide the bridge cost.
 */
const FIXTURE_ENTRY = "src/main.tsx";
const FIXTURE_SOURCE = `import { Button, Screen, Stack, Text, useState } from "@rowcat/runtime";

export default function App() {
	const [count, setCount] = useState(0);

	return (
		<Screen>
			<Stack gap={12} style={{ padding: 24 }}>
				<Text style={{ fontSize: 20, fontWeight: "bold" }}>Count: {count}</Text>

				<Button onPress={() => setCount((value) => value + 1)}>Increment</Button>
			</Stack>
		</Screen>
	);
}
`;

const require_ = createRequire(import.meta.url);

/** Bytes verbatim from the pinned dependency; never hand-vendor another engine build. */
function sourceWasm(): Buffer {
	return readFileSync(
		require_.resolve("@jitl/quickjs-ng-wasmfile-release-sync/wasm"),
	);
}

async function bundle(): Promise<string> {
	const result = await build({
		entryPoints: [ENTRY],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: ["es2020"],
		minify: true,
		legalComments: "none",
		/** The browser emscripten loader asks for the file location here; we supply the bytes directly. */
		define: { "import.meta.url": '"about:blank"' },
		logLevel: "silent",
	});
	const js = result.outputFiles[0]?.text ?? "";
	if (js.length === 0) throw new Error("harness bundle is empty");
	if (/[A-Za-z0-9+/]{4096,}/.test(js))
		throw new Error(
			"harness bundle contains a very long base64-looking literal — the WASM must be an app asset, not a string",
		);
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

const digest = (bytes: Buffer | string): string =>
	createHash("sha256").update(bytes).digest("hex");

/**
 * Records only the identity of the generated assets; the bytes live in the asset files. These
 * values let the diagnostics screen say which assets the device carries and let a human compare the
 * committed assets against the pinned dependency. Freshness is not guarded here — `--check`
 * compares the bytes.
 */
function renderManifest(html: string, wasm: Buffer): string {
	return [
		"/**",
		" * Generated — do not edit by hand. `pnpm --filter @rowcat/mobile runtime-vm:harness`.",
		" *",
		" * The identities of the two assets the trusted runtime WebView loads. The bytes",
		" * live in `modules/rowcat-runtime-webview/assets/runtime/` and native code packages them —",
		" * **neither the harness nor the WASM rides in the JS bundle as a string.**",
		" */",
		"",
		`export const RUNTIME_VM_HARNESS_VERSION = "${digest(html).slice(0, 16)}";`,
		"",
		`export const RUNTIME_VM_WASM_SHA256 = "${digest(wasm)}";`,
		"",
		`export const RUNTIME_VM_WASM_BYTES = ${wasm.byteLength};`,
		"",
	].join("\n");
}

/** Authoring source to artifact. Generation stops on failure so no stale fixture is left. */
function renderFixture(): string {
	const result = compileRuntimeProject(
		{
			apiVersion: RUNTIME_API_VERSION,
			entry: FIXTURE_ENTRY,
			files: [{ path: FIXTURE_ENTRY, content: FIXTURE_SOURCE }],
		},
		nodeRuntimeEnvironment(),
	);
	if (!result.ok)
		throw new Error(
			`fixture does not compile:\n${result.diagnostics
				.map((d) => `  ${d.path ?? "?"}: ${d.message}`)
				.join("\n")}`,
		);
	return [
		"/**",
		" * Generated — do not edit by hand. `pnpm --filter @rowcat/mobile runtime-vm:harness`.",
		" *",
		" * The **compiled artifacts** of the development and acceptance fixtures. The creator source",
		" * lives in `scripts/build-runtime-vm-harness.ts`, and nothing is compiled on the device —",
		" * mobile is the playback side, so the TypeScript compiler never comes into this app's bundle.",
		" */",
		"",
		"export const RUNTIME_COUNTER_FIXTURE = " +
			`${JSON.stringify(result.artifact, null, "\t")} as const;`,
		"",
	].join("\n");
}

function readOrEmpty(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function sameBytes(path: string, expected: Buffer): boolean {
	try {
		return readFileSync(path).equals(expected);
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const check = process.argv.includes("--check");
	const wasm = sourceWasm();
	const html = await bundle();
	const manifest = renderManifest(html, wasm);
	const fixture = renderFixture();

	if (check) {
		let stale: string | null = null;
		if (readOrEmpty(MANIFEST) !== manifest) stale = "manifest";
		else if (readOrEmpty(FIXTURE) !== fixture) stale = "fixture";
		else if (!sameBytes(HARNESS_ASSET, Buffer.from(html, "utf8")))
			stale = "harness asset";
		else if (!sameBytes(WASM_ASSET, wasm)) stale = "wasm asset";
		if (stale !== null) {
			console.error(
				`runtime VM ${stale} is stale — run \`pnpm --filter @rowcat/mobile runtime-vm:harness\``,
			);
			process.exit(1);
		}
		console.log("runtime VM harness and WASM asset are up to date");
		return;
	}

	writeFileSync(MANIFEST, manifest);
	writeFileSync(FIXTURE, fixture);
	writeFileSync(HARNESS_ASSET, html, "utf8");
	writeFileSync(WASM_ASSET, wasm);
	console.log(
		`wrote ${HARNESS_ASSET} (${(html.length / 1024).toFixed(0)} KiB) and ${WASM_ASSET} (${(wasm.byteLength / 1024).toFixed(0)} KiB)`,
	);
}

void main();
