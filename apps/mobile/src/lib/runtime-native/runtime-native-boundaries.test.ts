import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	RUNTIME_VM_WASM_BYTES,
	RUNTIME_VM_WASM_SHA256,
} from "./runtime-assets.generated.ts";

/**
 * Trusted-runtime boundaries: **things neither the types nor compilation catch.**
 *
 * Every rule here belongs to the kind that compiles when broken, and whose failure appears on the
 * device for the first time (or on the bill).
 */

const APP = fileURLToPath(new URL("../../..", import.meta.url));
const SRC = join(APP, "src");
const MODULE = join(APP, "modules/rowcat-runtime-webview");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, match, out);
		else if (match.test(entry.name)) out.push(full);
	}
	return out;
}

const read = (path: string) => ({
	path: path.slice(APP.length),
	text: stripComments(readFileSync(path, "utf8")),
});

const appSources = walk(SRC, /\.tsx?$/)
	.map(read)
	.filter((file) => !/\.test\.tsx?$/.test(file.path));

const runtimeNative = appSources.filter((file) =>
	file.path.startsWith("src/lib/runtime-native/"),
);

const kotlin = walk(join(MODULE, "android"), /\.kt$/).map(read);
const swift = walk(join(MODULE, "ios"), /\.swift$/).map(read);
const moduleJs = walk(MODULE, /\.tsx?$/).map(read);

const at = (path: string) => {
	const file = [...appSources, ...moduleJs].find(
		(entry) => entry.path === path,
	);
	expect(file, path).toBeDefined();
	return file as { path: string; text: string };
};

describe("the files to check actually exist", () => {
	it("the transport layer and native sources are in place", () => {
		expect(runtimeNative.length).toBeGreaterThan(5);
		expect(kotlin.length).toBeGreaterThan(1);
		expect(swift.length).toBe(1);
	});
});

describe("Android's normal path has no script evaluation", () => {
	/**
	 * **The reason for this slice is this check.**
	 *
	 * `injectJavaScript` is the slowest bridge: it evaluates a script on the UI thread on every call.
	 * The 68 ms round trip measured on the emulator is its cost
	 * (`docs/creator-runtime/native-vm-host.md`). Android's production path is `WebMessagePort`. Once
	 * that reverts, the measurements can no longer say which path produced them, and the revert does
	 * not break compilation.
	 */
	it("the native module doesn't evaluate JavaScript", () => {
		for (const file of kotlin) {
			expect(file.text, file.path).not.toMatch(/evaluateJavascript/);
			expect(file.text, file.path).not.toMatch(/loadUrl\s*\(\s*"javascript:/);
			expect(file.text, file.path).not.toMatch(/addJavascriptInterface/);
		}
	});

	it("the Android transport goes through the port", () => {
		const view = at("src/lib/runtime-native/runtime-host-view.tsx");
		const android = view.text.slice(
			view.text.indexOf("function AndroidHost"),
			view.text.indexOf("function IosHost"),
		);
		expect(android.length).toBeGreaterThan(200);
		expect(android).not.toMatch(/injectJavaScript/);
		/** The outgoing path is one native module `send`. */
		expect(android).toMatch(/native\.send\(/);
	});

	it("only iOS injects — and it doesn't splice values into code", () => {
		const view = at("src/lib/runtime-native/runtime-host-view.tsx");
		/** The message crosses as one JS string literal, so quotes inside it do not surface as code. */
		expect(view.text).toMatch(/receive\(\$\{JSON\.stringify\(json\)\}\)/);
		const ios = view.text.slice(view.text.indexOf("function IosHost"));
		expect(ios).toMatch(/injectJavaScript/);
	});

	it("no silent fallback", () => {
		/**
		 * If an Android whose port failed to set up falls back to the injection path, that deployment's
		 * measurements are not from the production path, yet they look as if they are. Failure ends in a
		 * structured termination.
		 */
		const host = at("src/lib/runtime-native/runtime-host-view.tsx");
		expect(host.text).not.toMatch(/fallback|fallBack/i);
		const bridge = at("src/lib/runtime-native/host-bridge.ts");
		expect(bridge.text).toMatch(/unavailable/);
	});
});

describe("the WASM isn't a string in the bundle", () => {
	it("the assets are the pinned dependency's bytes as is", () => {
		const require_ = createRequire(import.meta.url);
		const source = readFileSync(
			require_.resolve("@jitl/quickjs-ng-wasmfile-release-sync/wasm"),
		);
		const asset = readFileSync(join(MODULE, "assets/runtime/quickjs-ng.wasm"));
		expect(asset.equals(source)).toBe(true);
		expect(asset.byteLength).toBe(RUNTIME_VM_WASM_BYTES);
		expect(createHash("sha256").update(asset).digest("hex")).toBe(
			RUNTIME_VM_WASM_SHA256,
		);
	});

	it("no huge base64 literal anywhere in the JavaScript", () => {
		/**
		 * For a time this 1 MiB was a string inside the harness bundle, and that bundle became a base64
		 * constant in `src/` (double-encoded, 1,175 KiB). The shortest path back to that structure is
		 * "read the asset and send it over the bridge as base64", which moves the file and leaves the
		 * problem in place.
		 */
		for (const file of [...appSources, ...moduleJs]) {
			expect(file.text, file.path).not.toMatch(/[A-Za-z0-9+/]{4096,}/);
			expect(file.text, file.path).not.toMatch(/wasmBase64|WASM_BASE64/);
		}
	});

	it("doesn't put bytes on the bridge as base64", () => {
		for (const file of runtimeNative) {
			expect(file.text, file.path).not.toMatch(/\bbtoa\b|\batob\b/);
			expect(file.text, file.path).not.toMatch(
				/toString\(\s*["']base64["']\s*\)/,
			);
		}
	});

	it("the harness document is an asset too", () => {
		const harness = statSync(join(MODULE, "assets/runtime/harness.html"));
		expect(harness.size).toBeGreaterThan(1000);
		for (const file of appSources)
			expect(file.text, file.path).not.toMatch(/HARNESS_HTML/);
	});
});

describe("creator code doesn't run on Hermes", () => {
	it("not a single dynamic code generation", () => {
		for (const file of [...runtimeNative, ...moduleJs]) {
			expect(file.text, file.path).not.toMatch(/\beval\s*\(/);
			expect(file.text, file.path).not.toMatch(/new\s+Function\b/);
		}
	});

	it("doesn't treat the creator's text as markup", () => {
		for (const file of runtimeNative)
			expect(file.text, file.path).not.toMatch(/dangerouslySetInnerHTML/);
	});

	it("the TypeScript compiler doesn't come to mobile", () => {
		/**
		 * The input is **an artifact that has already been emitted**. Compilation is the job of authoring
		 * and publishing. If that package enters the app graph, the playback bundle carries the whole
		 * `lib.es2022.d.ts` family around.
		 */
		for (const file of appSources) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/runtime-compiler/);
			expect(file.text, file.path).not.toMatch(/\bcompileRuntimeProject\b/);
			expect(file.text, file.path).not.toMatch(/monaco/i);
			expect(file.text, file.path).not.toMatch(/typescript-compiler-api/);
		}
	});
});

describe("what this slice doesn't do", () => {
	/**
	 * **The app does not invent runtime capabilities that are not yet open.**
	 *
	 * `useGeneration` was removed from the list. Phase 6C opened that capability, and Phase 7
	 * connected it to product playback (the bridge's `runtime-host-call` → Hermes's trusted adapter).
	 * The name is still creator vocabulary. **What is locked here is the app creating a capability
	 * that does not exist yet.**
	 */
	it("doesn't create runtime capabilities that don't exist yet", () => {
		for (const file of [...appSources, ...moduleJs])
			for (const forbidden of [
				/\buseNavigation\b/,
				/\buseAudio\b/,
				/\buseAsset\b/,
			])
				expect(forbidden.test(file.text), `${file.path} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * **The storage-state hook names still do not appear in this app.**
	 *
	 * `useStoryState` and `usePersistentState` are creator vocabulary. What this app carries is their
	 * result, the **snapshot** only (`hydrated`, `story-state`, `persistent-state`). If those names
	 * appear in app code, a second author of the save format exists.
	 */
	it("the app doesn't use the creator's vocabulary for saved state", () => {
		for (const file of [...appSources, ...moduleJs])
			for (const forbidden of [/\buseStoryState\b/, /\busePersistentState\b/])
				expect(forbidden.test(file.text), `${file.path} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * **The places that may host this infrastructure are closed as a list.**
	 *
	 * Phase 7 added the playback folder to that list. Published runtime works are the first product
	 * consumer of this infrastructure. The list is still locked **by value** for the same reason as
	 * before: if the work detail or the conversation adopted this, those screens would take on the
	 * VM's lifetime. The coupling would show up not as an error but as "the WebView starts just by
	 * brushing against a work".
	 */
	it("the places taking in this infrastructure are exactly the list", () => {
		const consumers = appSources
			.filter((file) => !file.path.startsWith("src/lib/runtime-native/"))
			.filter((file) => /runtime-native\//.test(file.text))
			.map((file) => file.path)
			.sort();
		expect(consumers).toEqual([
			"src/features/runtime-native-lab/runtime-native-lab.tsx",
			/** Product playback: the first product consumer of this infrastructure (Phase 7). */
			"src/features/runtime-player/runtime-chat-screen.tsx",
			"src/features/runtime-player/runtime-generation-failure.ts",
			/**
			 * The pure decision that separates the two faces of a failure. It takes the bridge's vocabulary
			 * only as a type (`NativeRuntimeFailure`). The decision lives here so the harness does not gain
			 * an `artifact` stage: that value would be a protocol change, which moves the generated harness
			 * and the WASM asset together, while the fact it needs (`code`) already crosses the bridge.
			 */
			"src/features/runtime-player/runtime-player-status.ts",
			"src/features/runtime-player/use-runtime-generation.ts",
			"src/features/runtime-player/use-runtime-player.ts",
			/** The diagnostic lab takes the vocabulary only as a type. It is the same channel, so it reads the same names. */
			"src/features/runtime-vm-lab/lab-state.ts",
			"src/features/runtime-vm-lab/runtime-vm-lab.tsx",
		]);
	});

	it("the runtime writes nothing", () => {
		/**
		 * Neither the authoring store, the API client nor publishing comes into this layer. The fixture
		 * is an artifact the repository committed, and running it is a read.
		 */
		for (const file of runtimeNative)
			for (const forbidden of [
				/@rowcat\/authoring/,
				/@rowcat\/sdk/,
				/@rowcat\/query/,
				/getRowCatClient/,
				/expo-sqlite/,
				/expo-secure-store/,
				/publishDraft/,
			])
				expect(forbidden.test(file.text), `${file.path} — ${forbidden}`).toBe(
					false,
				);
	});
});

describe("the native surface is narrow", () => {
	it("doesn't open a general WebView API", () => {
		/**
		 * Arbitrary URL navigation and arbitrary script evaluation are not in this module's surface. If
		 * either opened, this module would become a browser component rather than a trusted runtime host,
		 * and then no one could say what runs in this realm.
		 */
		const api = at("modules/rowcat-runtime-webview/index.ts");
		for (const forbidden of [
			/navigate/i,
			/\bloadUrl\b/,
			/\bevaluate\b/i,
			/\bopenUrl\b/i,
		])
			expect(forbidden.test(api.text), `${forbidden}`).toBe(false);
	});

	it("the iOS module has no transport", () => {
		const module = swift[0] as { path: string; text: string };
		expect(module.text).not.toMatch(/WKWebView/);
		expect(module.text).not.toMatch(/WebMessage/);
		/** Its only job is to report where the assets are. */
		expect(module.text).toMatch(/RowcatRuntimeAssets/);
	});

	it("catches renderer process termination", () => {
		const view = kotlin.find((file) =>
			file.path.endsWith("RowcatRuntimeHostView.kt"),
		);
		expect(view?.text).toMatch(/onRenderProcessGone/);
		const host = at("src/lib/runtime-native/runtime-host-view.tsx");
		expect(host.text).toMatch(/onRuntimeTerminated/);
		expect(host.text).toMatch(/onContentProcessDidTerminate/);
	});
});

/**
 * **A remote address assembled by the runtime cannot become an outgoing request.**
 *
 * This app uses the same authorization model as the web. An authorization omission produces no
 * symptom (the image still renders), so the wiring is pinned by value. The list comes from **the
 * bridge's `started`**, and the resolver builds a `uri` only after passing through that list.
 */
describe("remote asset authorization", () => {
	it("the resolver hook goes through authorization", () => {
		const hook = at("src/features/runtime-player/use-asset-resolver.ts");
		expect(hook.text).toMatch(/authorizeRuntimeAssetResolver\(/);
	});

	it("the authorization list comes from session state — the screen doesn't reread the artifact", () => {
		const screen = at("src/features/runtime-player/runtime-chat-screen.tsx");
		expect(screen.text).toMatch(/native\.remoteAssets/);
		for (const file of appSources)
			expect(/artifact[^\n]*\.remoteAssets/.test(file.text), file.path).toBe(
				false,
			);
	});

	/** The bridge does carry that list. If the parser drops that field, the list is always empty. */
	it("the bridge's `started` carries the list", () => {
		const protocol = at("src/lib/runtime-native/protocol.ts");
		expect(protocol.text).toMatch(/remoteAssets/);
	});
});

/**
 * **Managed sound wiring.** What is caught here are facts that "the renderer package's tests are
 * green" does not prove. The deck is exported, and **whether the product playback path actually
 * sets it up** is the condition under which this slice closes.
 */
describe("managed audio", () => {
	it("the playback screen owns the sound", () => {
		const screen = at("src/features/runtime-player/runtime-chat-screen.tsx");
		expect(screen.text).toMatch(/useNativeRuntimeAudio\(/);
		/**
		 * The deck's identity is **the session's tree store**. Moving to another work changes that
		 * object, and at that moment the previous work's sound ends before the new deck is set up.
		 */
		expect(screen.text).toMatch(/session\?\.store/);
	});

	/**
	 * **The vendor name ends in one file.** The renderer package knows only the port, which is why its
	 * tests can run without a simulator.
	 */
	it("one file knows expo-audio", () => {
		const consumers = appSources
			.filter((file) => !file.path.endsWith(".test.ts"))
			.filter((file) => /["']expo-audio["']/.test(file.text))
			.map((file) => file.path);
		expect(consumers).toEqual(["src/features/runtime-player/audio-port.ts"]);
	});

	/** There is one place that sets up the deck. Two would mount two players into one tree. */
	it("one place stands the deck", () => {
		const consumers = appSources
			.filter((file) => !file.path.endsWith(".test.ts"))
			.filter((file) => /createNativeAudioDeck/.test(file.text))
			.map((file) => file.path);
		expect(consumers).toEqual([
			"src/features/runtime-player/runtime-audio-lifecycle.ts",
		]);
	});

	/**
	 * **Sound passes through the same two gates.** Skipping authorization or binding here would make
	 * sound a second channel outside authorization, and that leak has no symptom.
	 */
	it("the audio resolver goes through authorization and binding", () => {
		const hook = at("src/features/runtime-player/use-asset-resolver.ts");
		expect(hook.text).toMatch(/resolveAudio/);
		expect(
			hook.text.match(/authorizeRuntimeAssetResolver\(/g)?.length,
		).toBeGreaterThanOrEqual(2);
		expect(
			hook.text.match(/bindRuntimeAssetResolver\(/g)?.length,
		).toBeGreaterThanOrEqual(2);
	});

	/**
	 * **A remote address does not become sound.** The binding layer blocks it, and the app's resolver
	 * blocks it once more. So if the binding layer changes, this file does not quietly start producing
	 * proxy addresses.
	 */
	it("the audio resolver opens only managed assets", () => {
		const resolver = at("src/features/runtime-player/asset-resolver.ts");
		expect(resolver.text).toMatch(
			/resolveNativeRuntimeAudioUrl[\s\S]*?target\.kind !== "managed"/,
		);
		expect(resolver.text).not.toMatch(
			/resolveNativeRuntimeAudioUrl[\s\S]*?runtimeAssetUrl/,
		);
	});
});

/**
 * **The product playback path is the one that must not wait on a hung realm.** The watchdog, the
 * renewal and the early stop are options and one event branch; dropping any of them compiles and
 * every unit test of the session stays green, so the wiring is pinned by value.
 */
describe("product playback watches the harness", () => {
	it("the session gets a liveness watchdog and renews its bridge", () => {
		const hook = at("src/features/runtime-player/use-runtime-player.ts");
		expect(hook.text).toMatch(/liveness:\s*\{/);
		expect(hook.text).toMatch(
			/renewTransport:\s*\(\)\s*=>\s*createHostTransport\(/,
		);
	});

	it("a transition stops the old session at once", () => {
		const hook = at("src/features/runtime-player/use-runtime-player.ts");
		expect(hook.text).toMatch(/case "transition":\s*session\.stop\(\);/);
	});

	it("the WebView is keyed on its transport", () => {
		const view = at("src/lib/runtime-native/runtime-host-view.tsx");
		expect(view.text).toMatch(/<AndroidHost key=\{key\}/);
		expect(view.text).toMatch(/<IosHost key=\{key\}/);
	});

	it("the harness clock waits on the commit window and stop releases it", () => {
		const harness = readFileSync(
			join(APP, "runtime-vm-harness/entry.ts"),
			"utf8",
		);
		expect(harness).toMatch(/await commits\.wait\(\)/);
		expect(harness).toMatch(
			/case "stop":\s*releaseCommits\(message\.generation\)/,
		);
		expect(harness).toMatch(/case "commit-ack":/);
	});
});
