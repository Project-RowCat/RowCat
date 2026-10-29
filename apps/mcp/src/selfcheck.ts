import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import {
	emptyPersistentStateSnapshot,
	emptyStoryStateSnapshot,
} from "@rowcat/runtime-host";
import { createNodeRuntimeMcpHost } from "@rowcat/runtime-mcp/node";

/**
 * Asks whether this installation can actually run the runtime, with no account or network.
 *
 * In the repository the compiler's `lib.*.d.ts` and QuickJS's WASM are always present, but in an
 * npm-installed package both must be resolved from `node_modules`. An install where that resolution
 * is broken passes `--help` and the login line of `doctor`, then fails when an agent calls
 * `runtime_preview_start`, which users see as "the MCP does not respond".
 *
 * ```text
 * compile  does it find typescript-compiler-api's lib.*.d.ts
 * VM       does it find @jitl/…-wasmfile-release-sync's .wasm and does an instance come up
 * ```
 *
 * Both stages are really run rather than checking that files exist, because that check misses real
 * failures (a mismatched WASM, truncated bytes, an `import.meta.url` rewritten by a bundler). The
 * only source run here is the constant below, never creator code.
 */

/** Smallest project that goes through a real compile: draws one screen and ends. */
const PROBE = `import { Screen, Text } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Text>ok</Text>
		</Screen>
	);
}
`;

export type SelfCheckOutcome =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly stage: "compile" | "vm";
			readonly detail: string;
	  };

const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export async function runSelfCheck(): Promise<SelfCheckOutcome> {
	const host = createNodeRuntimeMcpHost();

	let compiled: ReturnType<typeof host.compile>;
	try {
		compiled = host.compile({
			apiVersion: RUNTIME_API_VERSION,
			entry: "src/main.tsx",
			files: [{ path: "src/main.tsx", content: PROBE }],
		});
	} catch (error) {
		/** Usually a missing `lib.*.d.ts`; the cause is not hidden. */
		return { ok: false, stage: "compile", detail: reasonOf(error) };
	}
	if (!compiled.ok)
		return {
			ok: false,
			stage: "compile",
			detail:
				compiled.diagnostics[0]?.message ??
				"The compiler refused without a reason.",
		};

	let session: Awaited<ReturnType<typeof host.createSession>>;
	try {
		session = await host.createSession({
			artifact: compiled.artifact,
			onConsole: () => {},
			storyState: emptyStoryStateSnapshot(),
			persistentState: emptyPersistentStateSnapshot(),
			onStoryStateCommit: () => {},
			onPersistentStateCommit: () => {},
		});
	} catch (error) {
		/** Usually a missing WASM or corrupt bytes. */
		return { ok: false, stage: "vm", detail: reasonOf(error) };
	}

	try {
		/**
		 * Does not stop at the session standing up: only mounting loads the generated sandbox, evaluates
		 * the creator module and produces the first commit. Stopping earlier would only prove the WASM
		 * file was read.
		 */
		let committed = false;
		const mounted = await session.mountRoot({
			onCommit: () => {
				committed = true;
			},
		});
		if (!mounted.ok)
			return { ok: false, stage: "vm", detail: mounted.error.message };
		if (!committed)
			return { ok: false, stage: "vm", detail: "No screen bundle arrived." };
		return { ok: true };
	} catch (error) {
		return { ok: false, stage: "vm", detail: reasonOf(error) };
	} finally {
		/** Do not leave a WASM instance behind because of one diagnostic. */
		await session.dispose().catch(() => {});
	}
}
