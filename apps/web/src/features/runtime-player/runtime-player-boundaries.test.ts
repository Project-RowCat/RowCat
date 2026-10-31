import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Boundary of the product playback surface: what may not enter this folder. Three things are
 * locked.
 * - No compiler. Players do not write code, so they must not receive the tools that make it.
 * - No authoring. The playback screen must not hold the creator's draft storage.
 * - No second execution path. Creator code runs only inside the WASM VM in the worker. This
 *   mirrors the studio preview folder's check and shares its rationale. It is stricter, because
 *   every player opens playback, not only one creator opening a preview, so the cost lands on every
 *   player's network and device.
 */

/**
 * Block comments (including JSDoc) are stripped before matching; line comments are not. The check
 * guards code, not prose. The boundary words also appear in the long rationale comments, so without
 * stripping, the test would effectively forbid explaining the reasons.
 */
const read = (path: string): string =>
	readFileSync(new URL(path, import.meta.url), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

/** The trusted copy's English source. The constants in `runtime-player-copy.ts` read it by key. */
const DICTIONARY = "../../lib/i18n/messages/en/runtime-player.ts";

const files = (): { name: string; text: string }[] =>
	readdirSync(new URL(".", import.meta.url))
		.filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
		.filter((name) => !name.endsWith(".test.ts"))
		.map((name) => ({ name, text: read(`./${name}`) }));

describe("product playback does not compile", () => {
	/**
	 * The compiler must not enter this folder. If it did, the lib.es2022.d.ts family and TypeScript
	 * would ship to player devices, giving people who never write code the tools to make it. The only
	 * input is the artifact the server has already built.
	 */
	test("does not import the compiler, Monaco or templates", () => {
		for (const file of files())
			for (const forbidden of [
				/@rowcat\/runtime-compiler/,
				/\bcompileRuntimeProject\b/,
				/\banalyzeRuntimeProject\b/,
				/monaco/i,
				/typescript-compiler-api/,
				/runtime-templates/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * The authoring store must not enter this folder. If the playback screen held the draft store, the
	 * screen that runs creator code could reach that creator's manuscripts.
	 */
	test("does not import authoring or the studio", () => {
		for (const file of files())
			for (const forbidden of [
				/@rowcat\/authoring/,
				/runtime-studio/,
				/AuthoringStore/,
				/useAuthoringScope/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * No second execution path. Creator code runs only in the QuickJS/WASM instance inside the worker.
	 * A bypass through `eval`, `new Function`, `iframe` or a Blob URL would run code without isolation
	 * and hand it our origin's privileges: session cookies, IndexedDB and sync keys.
	 */
	test("opens no door to run creator code in the main realm", () => {
		for (const file of files()) {
			if (file.name === "runtime-player.worker.ts") continue;
			for (const forbidden of [
				/\beval\(/,
				/new Function\(/,
				/dangerouslySetInnerHTML/,
				/\.innerHTML\b/,
				/<iframe/,
				/createObjectURL/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
		}
	});

	/**
	 * The worker must not compile either. That is the whole reason this file differs from the preview
	 * worker. If that stops being true, there is no point keeping the two workers separate.
	 */
	test("the worker receives artifacts, not source", () => {
		const worker = read("./runtime-player.worker.ts");
		expect(worker).toMatch(/createRuntimeVmSession/);
		expect(worker).not.toMatch(/@rowcat\/runtime-compiler/);
		expect(worker).not.toMatch(/\bfiles\b\s*:/);
	});
});

/**
 * A runtime playthrough is not a `ChatRoom`. The folder now sits at `/chat/runtime/:storyId` in the
 * same slot as a chat room, so the tempting shortcut is to create a room behind it, for the title,
 * the list entry and the header controls. That room would do nothing in lists, search, sync, memory
 * or message editing, and it would claim that two storage systems represent one experience (§3,
 * §4). So no chat-domain vocabulary enters this folder: no store, list, input or chat generation
 * hook. Runtime generation is a capability that returns text to creator code (`useGeneration`), not
 * a turn that stores a `ChatMessage` (§24).
 */
describe("a runtime playthrough is not a chat room", () => {
	test("does not import chat storage, lists, the composer or generation", () => {
		for (const file of files())
			for (const forbidden of [
				/\bChatStore\b/,
				/\bcreateRoom\b/,
				/\buseLocalRoom\b/,
				/\buseLocalMessages\b/,
				/\buseChatScope\b/,
				/local-chat\//,
				/\bChatComposer\b/,
				/\bMessageList\b/,
				/\bMessageActionBar\b/,
				/\buseChatGeneration\b/,
				/\buseChatSearch\b/,
				/\buseRoomManagement\b/,
				/chat-page/,
				/chat-header-context/,
				/@rowcat\/chat["/]/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * Dependencies flow one way. If the chat feature knew about runtime playback, chat room code would
	 * take on the VM lifecycle. The coupling would show up not as an error but as the playback module
	 * loading whenever a chat opens. The only shared piece is the neutral column in
	 * features/conversation.
	 */
	test("chat features do not import this folder", () => {
		const chat = readdirSync(new URL("../chat/", import.meta.url))
			.filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
			.map((name) => ({ name, text: read(`../chat/${name}`) }));
		expect(chat.length).toBeGreaterThan(0);
		for (const file of chat)
			expect(file.text, file.name).not.toMatch(/runtime-player/);
		/**
		 * The neutral column must not know about either side. If it did, it would become one side's
		 * property.
		 */
		const viewport = read("../conversation/conversation-viewport.tsx");
		expect(viewport).not.toMatch(/runtime-player|features\/chat/);
	});

	/**
	 * Header controls belong to the work, not to a room (§19, §56). Search, settings (`Settings`),
	 * rename (`Rename`), memory (`Memory`) and persona (`Personas`) are `ChatRoom` vocabulary. If those names
	 * appeared here, they would be pressable buttons that do nothing.
	 */
	test("the header has no chat room actions", () => {
		const header = read("./runtime-chat-header-context.tsx");
		for (const forbidden of [
			/Find in conversation/,
			/Conversation settings/,
			/requestChatSearch/,
			/Rename/,
			/Memory/,
			/Personas/,
		])
			expect(forbidden.test(header), `${forbidden}`).toBe(false);
		expect(header).toMatch(/resetPlaythrough/);
	});

	/**
	 * There are two addresses but only one screen (§9, §39). The legacy address only redirects, and
	 * the new address renders this folder's surface. This keeps two playback surfaces from growing
	 * apart.
	 */
	test("the old playback address redirects to the conversation canvas address", () => {
		const legacy = read("../../routes/(app)/stories/$storyId_/play.tsx");
		expect(legacy).toMatch(/redirect\(/);
		expect(legacy).toMatch(/"\/chat\/runtime\/\$storyId"/);
		expect(legacy).not.toMatch(/RuntimeConversation|RuntimePlayer|lazy\(/);

		const canonical = read("../../routes/(app)/chat/runtime/$storyId.tsx");
		expect(canonical).toMatch(/runtime-conversation/);
		/**
		 * Does not use the chat room skeleton (its input-bar placeholder), because what will fill the
		 * space is different (§60).
		 */
		expect(canonical).not.toMatch(
			/\bChatSkeleton\b|\bChatShell\b|\bChatPage\b/,
		);
	});
});

describe("playback writes nothing", () => {
	/**
	 * No path writes works, publications or authoring. The only write this screen performs is player
	 * save data. That is the member's private data and belongs to local storage and E2EE sync.
	 */
	test("does not call publish, acquisition or authoring APIs", () => {
		for (const file of files())
			for (const forbidden of [
				/stories\.publish/,
				/stories\.update/,
				/stories\.purchase/,
				/setCover/,
				/markPublished/,
			])
				expect(forbidden.test(file.text), `${file.name} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * Creator code is never uploaded to the server. Playback is read-only: artifacts come down and
	 * nothing goes up.
	 */
	test("does not send artifacts to the server", () => {
		for (const file of files()) {
			expect(file.text, file.name).not.toMatch(/method:\s*"POST"/);
			expect(file.text, file.name).not.toMatch(/method:\s*"PUT"/);
		}
	});
});

describe("the trusted shell sits outside the creator", () => {
	/**
	 * The AI notice is RowCat's own text (§69). If the creator drew it, the sentence would become the
	 * creator's, and creator content would decide whether billing happens.
	 */
	test("the notice copy lives in a pure constant", () => {
		expect(read("./runtime-player-copy.ts")).toMatch(/RUNTIME_PLAYER_AI_COPY/);
		expect(read(DICTIONARY)).toMatch(/uses AI generation/);
	});

	/**
	 * Does not claim one destination for requests. Whether a request is managed or BYO depends on the
	 * user's settings, so a single claim would be false for half of users. Since payments were removed
	 * from the product, the copy does not mention Churu either.
	 */
	test("the notice does not assert where requests go", () => {
		const copy = read(DICTIONARY);
		expect(copy).toMatch(/use this server's default AI/);
		expect(copy).toMatch(/a provider you connected/);
		expect(copy).not.toMatch(/churu/i);
	});

	/**
	 * A version-mismatch failure does not offer a restart (§95). Rebuilding with the same app would
	 * bring the same failure, so the user needs a new app build.
	 */
	test("the compatibility failure copy points to an app update", () => {
		expect(read(DICTIONARY)).toMatch(/Update the app/);
	});

	/**
	 * The reset confirmation says what survives first (§61, §63). The basis for this is that product
	 * playback has no operation that erases long-term progress.
	 */
	test("the reset confirmation says what stays", () => {
		const copy = read(DICTIONARY);
		expect(copy).toMatch(/Only this playthrough's progress is erased/);
		/**
		 * Persistent-state reset is not part of product playback, so its operation name must not appear
		 * anywhere in this folder.
		 */
		for (const file of files())
			expect(file.text, file.name).not.toMatch(/resetPersistent/);
	});
});

/**
 * Remote addresses assembled by the runtime must not turn into outgoing requests without
 * authorization. A resolver that skips authorization produces no visible symptom: images still
 * render, and only the creator's server receives different values. So the wiring is pinned by a
 * test: the resolver the renderer receives must always pass authorization, and the asset list must
 * be the one the session provided. Rereading the artifact here would make an unverified value the
 * basis.
 */
describe("remote asset authorization", () => {
	test("the resolver the renderer receives passes through authorization", () => {
		const hook = read("./use-runtime-player.ts");
		expect(hook).toMatch(/resolveAsset:\s*authorizeRuntimeAssetResolver\(/);
	});

	test("the authorization list comes from the session's `started`", () => {
		expect(read("./use-runtime-player.ts")).toMatch(/message\.remoteAssets/);
	});

	/**
	 * If the list is extracted from the artifact itself, its values are the artifact's claims, not
	 * verified facts.
	 */
	test("this folder does not pull the list out of the artifact", () => {
		for (const file of files())
			expect(/artifact[^\n]*\.remoteAssets/.test(file.text), file.name).toBe(
				false,
			);
	});
});

/**
 * Transitions belong to the renderer, and this folder must not grow a second implementation.
 * Preview and product playback share one web renderer, so there is exactly one transition
 * implementation. That makes the rule "moves only in preview" impossible to express. If this folder
 * started producing frames (timers, rAF, self-declared transitions), creators would see something
 * different after publishing than while authoring, and the difference would only show after
 * publish.
 */
describe("transitions are not rebuilt here", () => {
	test("nothing here makes frames", () => {
		for (const file of files()) {
			expect(file.text, file.name).not.toMatch(/requestAnimationFrame/);
			expect(file.text, file.name).not.toMatch(/\brequestIdleCallback\b/);
			expect(file.text, file.name).not.toMatch(/\bsetInterval\s*\(/);
		}
	});

	test("transition declarations are not hand-written", () => {
		for (const file of files()) {
			expect(file.text, file.name).not.toMatch(/transition-property/);
			expect(file.text, file.name).not.toMatch(/transitionDuration/);
			expect(file.text, file.name).not.toMatch(/prefers-reduced-motion/);
		}
	});

	/**
	 * The reduced-motion setting must not reach creator code. If it became a branch in creator code,
	 * an accessibility setting would change how the story progresses.
	 */
	test("reduced motion is not sent to the VM", () => {
		for (const file of files())
			expect(file.text, file.name).not.toMatch(/reducedMotion|reduceMotion/);
	});
});

/**
 * Preview and playback hosts see the same compatibility window. The decision is a single function,
 * `runtimeApiCompatibility` from `@rowcat/runtime`, and both workers pass through its validation in
 * `createRuntimeVmSession`. If a worker compared `apiVersion` itself, the window would be defined
 * in two places, and the drift would appear only as a work that runs in the studio but will not
 * open once published. The preview worker's `apiVersion` is a compile input (it compiles against
 * the current version), not a compatibility check.
 */
describe("both hosts see the same compatibility window", () => {
	const workers = [
		"./runtime-player.worker.ts",
		"../runtime-preview/runtime-preview.worker.ts",
	] as const;

	test.each(
		workers,
	)("%s goes through session creation and does not compare versions itself", (file) => {
		const source = read(file);
		expect(source).toMatch(/createRuntimeVmSession\(/);
		expect(source).not.toMatch(/apiVersion\s*[!=]==/);
		expect(source).not.toMatch(/validateRuntimeArtifact\(/);
		expect(source).not.toMatch(/RUNTIME_API_MIN_COMPATIBLE_VERSION/);
	});
});

/**
 * The pacing, liveness and sound rules live in pure modules with their own tests
 * (lib/runtime-watchdog, runtime-player-session.ts). What can still go missing is the wiring: a hook
 * that never arms the watch, a worker that never answers, or a dispose path that forgets to release
 * the flow gate is green everywhere else and hangs or freezes only in the browser.
 */
describe("the worker is paced and watched", () => {
	test("the hook watches from the worker's first message and acknowledges commits", () => {
		const hook = read("./use-runtime-player.ts");
		/** Paused until `starting`: downloading the worker's script is not a stuck turn. */
		expect(hook).toMatch(/watchRuntimeWorker\(/);
		expect(hook).not.toMatch(/watchRuntimeLiveness\(/);
		expect(hook).toMatch(
			/case "status":[\s\S]*?watch\?\.observe\("session-starting"\)/,
		);
		expect(hook).toMatch(/case "pong":/);
		expect(hook).toMatch(
			/\.acknowledge\(generation, message\.batch\.revision\)/,
		);
	});

	test("the worker answers pings, applies acks and runs on the gated clock", () => {
		const worker = read("./runtime-player.worker.ts");
		expect(worker).toMatch(/case "ping":[\s\S]*?type: "pong"/);
		expect(worker).toMatch(/case "ack":[\s\S]*?\.acknowledged\(/);
		/** Wakes from main wait on the gate too, or each one starts an ungated drain. */
		expect(worker).toMatch(/case "event":[\s\S]*?admit\(request\.generation/);
		expect(worker).toMatch(
			/case "generation-result":[\s\S]*?admit\(request\.generation/,
		);
		expect(worker).toMatch(/current\.flow\.admit\(run\)/);
		expect(worker).toMatch(/scheduling: \{ clock: flow\.clock \}/);
		expect(worker).not.toMatch(
			/scheduling: \{ clock: workerSchedulerClock\(\) \}/,
		);
	});

	/** Every dispose in the worker is preceded by a release, or a parked scheduler hangs it. */
	test("every dispose releases the flow first", () => {
		const worker = read("./runtime-player.worker.ts");
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

	test("the generation router asks whether the generation is still on screen", () => {
		const hook = read("./use-runtime-player.ts");
		expect(hook).toMatch(
			/currentGeneration: \(\) =>\s*runtimePlayerAnswersGeneration\(/,
		);
		expect(hook).toMatch(/release\(\) \{\s*session\.abortGeneration\(\);/);
	});

	test("sound ends with the session", () => {
		const hook = read("./use-runtime-player.ts");
		expect(hook).toMatch(/LIFECYCLE_EVENT_SILENCES_AUDIO\[event\.type\]/);
		const silences = hook.match(/silenceAudio\(\)/g) ?? [];
		/** Lifecycle events, worker `failed`, crash, renderer failure, liveness verdict. */
		expect(silences.length).toBeGreaterThanOrEqual(5);
	});
});
