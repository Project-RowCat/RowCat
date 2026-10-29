import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
	compileRuntimeProject,
	type RuntimeCompileHandle,
} from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import {
	createRuntimeVmSession,
	type RuntimeVmEngine,
} from "@rowcat/runtime-host";
import { createQuickJsEngine } from "@rowcat/runtime-host/quickjs";
import type { RuntimeMcpHost } from "../ports.ts";

/**
 * Wiring that builds the execution environment on Node. Only this file knows Node. It follows the
 * same layout as runtime-compiler's environment/node.ts. If the core imported node:crypto and the
 * WASM variant directly, this layer could not run elsewhere, and tests could not run against the
 * real compiler and real QuickJS. Tests that imitate those two cannot show that the protocol
 * actually holds.
 *
 * Not here: eval, new Function, dynamic import(), or fetch. Creator code runs inside the
 * QuickJS/WASM VM, not in this process. The one file read, reading the WASM bytes, reads an asset
 * of an installed package.
 *
 * It holds on to the program handle. The previous compile's program is reused so each edit does not
 * reparse everything. This is a speed concern, not a correctness condition; results are the same
 * without it.
 */

const require = createRequire(import.meta.url);

const readWasmBinary = (): Promise<ArrayBuffer> =>
	readFile(require.resolve("@jitl/quickjs-ng-wasmfile-release-sync/wasm")).then(
		(buffer) =>
			buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength,
			),
	);

export function createNodeRuntimeMcpHost(): RuntimeMcpHost {
	const environment = nodeRuntimeEnvironment();
	let engine: RuntimeVmEngine | null = null;
	let previous: RuntimeCompileHandle | undefined;

	const engineFor = (): RuntimeVmEngine => {
		if (engine === null)
			engine = createQuickJsEngine(variant, { wasmBinary: readWasmBinary });
		return engine;
	};

	return {
		compile: (input) => {
			const outcome = compileRuntimeProject(
				input,
				environment,
				previous === undefined ? {} : { previous },
			);
			previous = outcome.handle;
			return outcome.ok
				? {
						ok: true,
						artifact: outcome.artifact,
						diagnostics: outcome.diagnostics,
					}
				: { ok: false, artifact: null, diagnostics: outcome.diagnostics };
		},
		createSession: (options) =>
			createRuntimeVmSession({
				engine: engineFor(),
				artifact: options.artifact,
				onConsole: options.onConsole,
				storyState: options.storyState,
				persistentState: options.persistentState,
				onStoryStateCommit: options.onStoryStateCommit,
				onPersistentStateCommit: options.onPersistentStateCommit,
				/**
				 * The generation capability is deliberately left out of the table. If it were there, a single
				 * tool call could create billable state, and that decision does not belong to this channel. A
				 * disabled preview's generate() reports 'no such capability', not 'not permitted'. To the
				 * creator these are different messages.
				 */
			}),
		/**
		 * Content fingerprint: the key for optimistic concurrency. It is not a basis for authorization.
		 * Only the first 16 characters are kept. This is not for collision avoidance. A short value is
		 * easier to read in responses; the media table's version column made the same choice.
		 */
		digest: (content) =>
			createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16),
		now: () => Date.now(),
		/**
		 * Idle-check timer. This timer must never keep the process alive by itself. unref does that.
		 * Without it, an idle rowcat-mcp would hold the event loop through this timer and outlive its
		 * client. The returned function cancels the timer, and calling it twice is safe.
		 */
		schedule: (callback, delayMs) => {
			const timer = setTimeout(callback, delayMs);
			timer.unref?.();
			return () => clearTimeout(timer);
		},
	};
}
