import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUNTIME_PREVIEW } from "./runtime-preview-copy.ts";

/**
 * Statically checks what preview does not do. This folder is the first place in the studio that
 * runs creator code, so the shortest bypass looks most natural: run it once on the main thread
 * because the worker exists, use new Function because it already compiled, or bundle to HTML. These
 * are blocked here by name. Isolation comes from QuickJS/WASM, not from the worker, and the worker
 * file is the only one that sets up that VM.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = () =>
	readdirSync(HERE)
		.filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
		.map((name) => ({
			name,
			source: stripComments(readFileSync(join(HERE, name), "utf8")),
		}));

const FORBIDDEN: { door: RegExp; why: string }[] = [
	{ door: /\beval\s*\(/, why: "Creator code runs only inside QuickJS/WASM." },
	{ door: /new\s+Function\s*\(/, why: "Same as `eval`." },
	{
		door: /<iframe/i,
		why: "iframe isolation is not a boundary we reviewed.",
	},
	{
		door: /createObjectURL/,
		why: "A Blob URL is a path that turns a script into an address.",
	},
	{
		door: /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/,
		why: "A path that turns creator text into markup. The renderer makes only Text nodes.",
	},
	{
		door: /\bimportScripts\s*\(/,
		why: "A path that loads arbitrary scripts inside the worker.",
	},
];

describe("execution is inside the VM", () => {
	it.each(FORBIDDEN)("$door is absent from this folder", ({ door, why }) => {
		const offenders = files()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});

	/**
	 * Only one file may value-import the VM, the compiler, or the engine: the worker. The exception is
	 * one leaf subpath. `@rowcat/runtime-host/story-state` and `/persistent-state` import nothing but
	 * the snapshot core and wire format, so they do not pull the session, engine, or generated sandbox
	 * into the main bundle. Importing the root (`@rowcat/runtime-host`) would bring all three along.
	 * The renderer imports its `patches` subpath for the same reason.
	 */
	it("the worker is the one place that imports runtime-host, compiler execution and QuickJS by value", () => {
		const offenders = files()
			.filter((file) =>
				/^import\s+(?!type\b)[^;]*from\s+"(@rowcat\/runtime-host(?!\/(story|persistent)-state)|@rowcat\/runtime-compiler|@jitl\/quickjs)/m.test(
					file.source,
				),
			)
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual(["runtime-preview.worker.ts"]);
	});

	/**
	 * Checks by value that the exception really is a leaf, so this breaks first on the day it stops
	 * being one. `durable-snapshot.ts` is in the list because two lifetimes pass through the same
	 * core. That file is also a leaf (it imports only `wire.ts`), so the end of the chain is
	 * unchanged; the two checks below verify that together.
	 */
	it.each([
		"story-state.ts",
		"persistent-state.ts",
		"durable-snapshot.ts",
	])("the allowed subpath %s does not reach the engine", (file) => {
		const source = readFileSync(
			join(HERE, `../../../../../packages/runtime-host/src/${file}`),
			"utf8",
		);
		const specifiers = [
			...new Set(
				[...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]),
			),
		].sort();
		for (const specifier of specifiers)
			expect(
				["./wire.ts", "./durable-snapshot.ts"],
				`${file} → ${specifier}`,
			).toContain(specifier);
	});

	/**
	 * Studio preview never touches the product's save rows: a creator's test must not change their own
	 * player progress. The snapshot's owner is the worker's memory, which is lost on refresh, and the
	 * screen copy says so. If this folder ever imports the save domain or local storage, that promise
	 * breaks silently.
	 */
	it("does not import the player save domain or local storage", () => {
		for (const file of files())
			for (const pattern of [
				/@rowcat\/runtime-persistence/,
				/runtimePlaythrough|runtimePersistent/,
				/local-runtime-save/,
				/from "dexie"/,
				/#\/lib\/local-data/,
			])
				expect(pattern.test(file.source), `${file.name} — ${pattern}`).toBe(
					false,
				);
	});

	it("only the worker calls the function that builds artifacts", () => {
		const offenders = files()
			.filter((file) => /compileRuntimeProject\s*\(/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["runtime-preview.worker.ts"]);
	});

	it("the client is the one place that creates the worker", () => {
		const offenders = files()
			.filter((file) => /\?worker/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["runtime-preview-client.ts"]);
	});

	/** Renderer creation lives in one hook, and React is never passed into the renderer. */
	it("one hook stands up the renderer", () => {
		const offenders = files()
			.filter((file) => /createWebRuntimeRenderer\s*\(/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["use-runtime-preview.ts"]);
	});

	/**
	 * The asset resolver comes in from outside. If this folder started building addresses, preview and
	 * playback would follow different rules, and the creator's address would gain a shortcut into
	 * `src`.
	 */
	it("receives the asset resolver rather than building it", () => {
		const hook = files().find((file) => file.name === "use-runtime-preview.ts");
		expect(hook?.source).toMatch(/resolveAssetRef\.current\(target\)/);
		for (const file of files())
			for (const door of [
				/runtimeAssetUrl/,
				/runtime\/assets\/remote/,
				/target\.url\b/,
			])
				expect(file.source, `${file.name} — ${door}`).not.toMatch(door);
	});

	it("does not reach the store, the API or publication", () => {
		const offenders = files()
			.filter((file) =>
				/local-authoring|publishDraft|\/stories\//.test(file.source),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * The generation stack is reached through one file: the adapter. That this file is the folder's
	 * only door is the whole check. The worker, hook, and renderer never learn the SDK, queries, or
	 * credentials; they pass only results. So 'creator code cannot choose the provider' holds by
	 * structure, not by wiring.
	 */
	it("the adapter is the one place that imports the generation stack", () => {
		const offenders = files()
			.filter((file) =>
				/@rowcat\/sdk|@rowcat\/query|getRowCatClient|createGenerationTransport|resolveGenerationExecution|local-provider/.test(
					file.source,
				),
			)
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual(["runtime-preview-generation.ts"]);
	});

	/**
	 * A provider's raw error sentence must never reach the worker. Behavior tests come first
	 * (runtime-preview-generation-failure.test.ts and this folder's e2e). This static check is a lock
	 * that makes the property harder to break again. One line that puts a caught exception's message
	 * into a result looks like an ordinary diff in review, and it could carry a named reason past the
	 * host's general sanitizer and into the VM.
	 *
	 * The decision that attaches a reason belongs to runtime-preview-generation-failure.ts alone.
	 */
	it("the generation path does not put a caught exception's sentence in the result", () => {
		for (const name of [
			"runtime-preview-generation.ts",
			"runtime-preview-generation-router.ts",
			"runtime-preview-generation-failure.ts",
		]) {
			const source = files().find((file) => file.name === name)?.source ?? "";
			expect(source.length, `${name} is absent`).toBeGreaterThan(0);
			for (const door of [
				/\berror\.message\b/,
				/\bcause\.message\b/,
				/String\(\s*error\s*\)/,
				/JSON\.stringify\(\s*error\s*\)/,
			])
				expect(source, `${name} — ${door}`).not.toMatch(door);
		}
	});

	/**
	 * There is one source for safe sentences, so no reason gets its string copied into a second place.
	 */
	it("one module builds the failure sentences", () => {
		const offenders = files()
			.filter(
				(file) =>
					file.name !== "runtime-preview-generation-failure.ts" &&
					/reason:\s*"(failed|not-authorized|insufficient-balance|unavailable)"/.test(
						file.source,
					),
			)
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual([]);
	});

	/**
	 * The worker has no such import. Credentials must never share a process with creator code. The
	 * worker only sends a message and awaits the answer; if that changed, the SDK client and decrypted
	 * BYO keys would sit next to the realm where QuickJS runs.
	 */
	it("the worker only requests, it does not generate", () => {
		const worker =
			files().find((file) => file.name === "runtime-preview.worker.ts")
				?.source ?? "";
		for (const door of [
			/@rowcat\/sdk/,
			/@rowcat\/query/,
			/local-provider/,
			/withCredential/,
			/createGenerationTransport/,
		])
			expect(worker).not.toMatch(door);
		expect(worker).toMatch(/generation-request/);
	});

	/**
	 * The protocol has no way for creator code to choose a provider, model, or key. The narrowness of
	 * the request shape is half of this contract: adding one field would bring a creator API that
	 * fills it.
	 */
	it("a generation request has no slot for provider, model or key", () => {
		const protocolSource =
			files().find((file) => file.name === "protocol.ts")?.source ?? "";
		const shape = protocolSource.slice(
			protocolSource.indexOf("PreviewGenerationRequest"),
			protocolSource.indexOf("PreviewGenerationResult"),
		);
		for (const door of [
			/provider/i,
			/\bmodel\b/i,
			/apiKey/i,
			/temperature/i,
			/reasoning/i,
		])
			expect(shape).not.toMatch(door);
	});
});

describe("durable state boundaries", () => {
	/**
	 * No product save is created here. Preview snapshots live in worker memory and last only while the
	 * studio stays open; refresh, another browser, or another device loses them. If a save medium's
	 * name ever appears in this folder, that promise widens silently.
	 */
	it.each([
		[/\blocalStorage\b/, "Browser storage crosses account boundaries."],
		[/\bsessionStorage\b/, "The same axis."],
		[
			/\bindexedDB\b|\bDexie\b/,
			"The local database belongs to the authoring store.",
		],
		[
			/\blocal-authoring\b|\blocal-data\b/,
			"Does not write to the authoring store.",
		],
	])("%s is absent from this folder", (door, why) => {
		const offenders = files()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});

	/**
	 * The SDK in the generation adapter is there for generation, not storage. It was once on this list
	 * on the grounds that server storage did not exist yet. It is listed now because of generation, so
	 * the check looks at that purpose directly. No name for a storage medium appears anywhere in this
	 * folder.
	 */
	it("the adapter does not call a storage medium either", () => {
		const adapter =
			files().find((file) => file.name === "runtime-preview-generation.ts")
				?.source ?? "";
		for (const door of [
			/\blocalStorage\b/,
			/\bsessionStorage\b/,
			/\bindexedDB\b|\bDexie\b/,
			/\blocal-authoring\b|\blocal-data\b/,
		])
			expect(adapter).not.toMatch(door);
	});

	/** The one place that holds the snapshot is the worker, so main does not become a second store. */
	it("the worker is the one place holding the snapshot", () => {
		const offenders = files()
			.filter((file) => /\bstorySnapshot\b/.test(file.source))
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual(["runtime-preview.worker.ts"]);
	});

	/**
	 * Save state flows one way only. If main sent the snapshot to the worker, the studio would become
	 * a second author of the save format, and that value would never pass through creator code.
	 */
	it("no snapshot goes from main to the worker", () => {
		const protocolSource =
			files().find((file) => file.name === "protocol.ts")?.source ?? "";
		const request = protocolSource.slice(
			protocolSource.indexOf("PreviewWorkerRequest"),
			protocolSource.indexOf("PreviewErrorInfo"),
		);
		expect(request).not.toMatch(/snapshot/);
	});
});

describe("copy", () => {
	it("run-state words claim no more than the fact", () => {
		const copy = Object.values<unknown>(RUNTIME_PREVIEW)
			.filter((value): value is string => typeof value === "string")
			.join("\n");
		for (const promise of [
			"soon",
			"launch",
			"coming",
			"beta",
			"experimental",
			"publish",
		])
			expect(copy).not.toContain(promise);
		expect(RUNTIME_PREVIEW.stale).toBe("Changes pending");
		expect(RUNTIME_PREVIEW.staleBody).toContain("previous code");
	});

	/**
	 * Do not describe preview memory as cloud save. This progress lasts only while the studio stays
	 * open, and the screen says so.
	 */
	it("does not promise a longer lifetime for preview saves", () => {
		const copy = Object.values<unknown>(RUNTIME_PREVIEW)
			.filter((value): value is string => typeof value === "string")
			.join("\n");
		for (const promise of [
			"cloud",
			"saved to your account",
			"permanent",
			"sync",
		])
			expect(copy).not.toContain(promise);
		expect(RUNTIME_PREVIEW.stateScope).toContain("Refresh");
		/**
		 * The difference between the two operations is carried by the on-screen copy, so that copy must
		 * contain `Restart`.
		 */
		expect(RUNTIME_PREVIEW.resetPlaythroughHint).toContain("Restart");
	});
});

/**
 * A remote address the runtime assembles must not become an outgoing request. An unauthorized
 * resolver produces no symptom: images still draw, and the only change is what the creator's server
 * receives. So the wiring is pinned by value. The resolver the renderer gets must always pass
 * authorization, and the list must be the one the session was given. Re-reading the artifact here
 * would make an unvalidated value the basis.
 */
describe("remote asset authorization", () => {
	const hook = () =>
		files().find((file) => file.name === "use-runtime-preview.ts")?.source ??
		"";

	it("the resolver the renderer receives passes through authorization", () => {
		expect(hook()).toMatch(/resolveAsset:\s*authorizeRuntimeAssetResolver\(/);
	});

	it("the authorization list comes from the session's `started`", () => {
		expect(hook()).toMatch(/message\.remoteAssets/);
	});

	/**
	 * If this folder pulls the list out of the artifact itself, that value is the artifact's claim,
	 * not a verified fact.
	 */
	it("this folder does not pull the list out of the artifact", () => {
		for (const file of files())
			expect(/artifact[^\n]*\.remoteAssets/.test(file.source), file.name).toBe(
				false,
			);
	});
});

/**
 * Transitions belong to the renderer, and this folder must not grow a second implementation.
 * Preview and playback share one web renderer, so transitions are one implementation too. That
 * makes the spec rule `moves only in the preview` (moves only in preview) impossible to express.
 *
 * If this folder starts producing frames (timers, rAF, self-declared transitions), the screen
 * creators see after publishing would differ from what they saw while authoring. The difference
 * would only appear after publishing.
 */
describe("transitions are not rebuilt here", () => {
	it("nothing here makes frames", () => {
		for (const file of files()) {
			expect(file.source, file.name).not.toMatch(/requestAnimationFrame/);
			expect(file.source, file.name).not.toMatch(/\brequestIdleCallback\b/);
			expect(file.source, file.name).not.toMatch(/\bsetInterval\s*\(/);
		}
	});

	it("transition declarations are not hand-written", () => {
		for (const file of files()) {
			expect(file.source, file.name).not.toMatch(/transition-property/);
			expect(file.source, file.name).not.toMatch(/transitionDuration/);
			expect(file.source, file.name).not.toMatch(/prefers-reduced-motion/);
		}
	});

	/**
	 * Reduced-motion preferences must not reach the creator's VM either. If the value became a branch
	 * in creator code, an accessibility setting would change how the story progresses.
	 */
	it("reduced motion is not sent to the VM", () => {
		for (const file of files())
			expect(file.source, file.name).not.toMatch(/reducedMotion|reduceMotion/);
	});
});

/**
 * Same wiring as product playback (see that folder's boundaries test). The pure rules are tested in
 * lib/runtime-watchdog; this pins that the preview actually uses them.
 */
describe("the preview worker is paced and watched", () => {
	const source = (name: string): string =>
		files().find((file) => file.name === name)?.source ?? "";

	it("the hook watches the worker by its own facts and acknowledges commits", () => {
		const hook = source("use-runtime-preview.ts");
		expect(hook).toMatch(/watchRuntimeWorker\(/);
		/** `starting` resumes and the compile pauses: that is what keeps the compile out of the bound. */
		expect(hook).toMatch(
			/message\.stage === "starting" \? "session-starting" : "compiling"/,
		);
		expect(hook).toMatch(/watch\.observe\(fact, message\.generation\)/);
		/**
		 * Run must not end the watch: a stuck worker cannot read the new start, and nothing else would
		 * bring the watch back (dev5 re-review). The only thing run() says to it is `restarting()`.
		 */
		const run = hook.slice(
			hook.indexOf("const run = useCallback("),
			hook.indexOf("const resetPlaythrough = useCallback("),
		);
		expect(run).toMatch(/watchRef\.current\?\.restarting\(\)/);
		expect(run).not.toMatch(/stopWatch\(\)|\.stop\(\)/);
		expect(hook).toMatch(
			/client\.acknowledge\(message\.generation, message\.batch\.revision\)/,
		);
	});

	it("the worker answers pings, applies acks and releases before every dispose", () => {
		const worker = source("runtime-preview.worker.ts");
		expect(worker).toMatch(/case "ping":[\s\S]*?type: "pong"/);
		expect(worker).toMatch(/case "ack":[\s\S]*?\.acknowledged\(/);
		/** Wakes from main wait on the gate too, or each one starts an ungated drain. */
		expect(worker).toMatch(/case "event":[\s\S]*?admit\(request\.generation/);
		expect(worker).toMatch(
			/case "generation-result":[\s\S]*?admit\(request\.generation/,
		);
		expect(worker).toMatch(/current\.flow\.admit\(run\)/);
		expect(worker).toMatch(/scheduling: \{ clock: flow\.clock \}/);
		const disposes = [...worker.matchAll(/await session\.dispose\(\)/g)];
		expect(disposes.length).toBeGreaterThan(0);
		for (const match of disposes) {
			const before = worker.slice(
				Math.max(0, (match.index ?? 0) - 400),
				match.index,
			);
			expect(before).toMatch(/flow\.release\(\)/);
		}
	});

	/**
	 * Stopping releases the worker's commit gate, so a press it held runs before the unmount and may
	 * ask for a generation. Stop does not move the generation number, so the router has to refuse the
	 * stopped generation by its own record, or that request is answered with a paid call nobody reads.
	 */
	it("nothing a stopped session asks for is answered", () => {
		const hook = source("use-runtime-preview.ts");
		const stop = hook.slice(
			hook.indexOf("const stop = useCallback("),
			hook.indexOf(
				"generationRouter.abort();",
				hook.indexOf("const stop = useCallback("),
			),
		);
		expect(stop).toMatch(/stoppedGenerationRef\.current = generation;/);
		expect(hook).toMatch(
			/currentGeneration: \(\) =>\s*stoppedGenerationRef\.current === generationRef\.current\s*\? -1/,
		);
	});

	it("a stop that times out silences the tree it leaves", () => {
		const hook = source("use-runtime-preview.ts");
		expect(hook).toMatch(
			/stopTimerRef\.current = setTimeout\(\(\) => \{[\s\S]*?silenceAudio\(\);[\s\S]*?\}, STOP_GRACE_MS\);/,
		);
	});
});
