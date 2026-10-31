import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { describe, expect, test } from "vitest";
import {
	compileRuntimeInIsolation,
	runtimeCompileStats,
} from "./runtime-compile.ts";

/**
 * The compile runs in a thread so that hostile source can exhaust that thread and not this process.
 * These run the real compiler in a real worker; the limits are lowered so the hostile case ends in
 * seconds rather than at the production ceiling.
 */

const project = (content: string) => ({
	apiVersion: RUNTIME_API_VERSION,
	entry: "src/main.tsx",
	files: [{ path: "src/main.tsx", content }],
});

const ORDINARY = `import { Screen, Text } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Text>Hello</Text>
		</Screen>
	);
}
`;

/**
 * The shape the review measured: each line forces a 998-step recursive type instantiation. Ten lines
 * ran a 2.6 GB heap inline; here the ceiling is far lower, so it must end as `exhausted`.
 */
const HOSTILE = `${ORDINARY}
type L<S, N extends unknown[] = []> = N["length"] extends 998 ? N : L<S, [...N, S]>;
${Array.from({ length: 30 }, (_, i) => `export const v${i}: L<${i}>["length"] = 998;`).join("\n")}
`;

describe("publication compile isolation", () => {
	test("an ordinary project compiles in the thread and its artifact comes back", async () => {
		const outcome = await compileRuntimeInIsolation(project(ORDINARY));
		expect(outcome.kind).toBe("compiled");
		if (outcome.kind !== "compiled") return;
		expect(outcome.result.ok).toBe(true);
		expect(outcome.result.artifact?.entry).toBe("src/main.tsx");
	}, 60_000);

	test("source that exhausts the thread is refused, and this process carries on", async () => {
		const outcome = await compileRuntimeInIsolation(project(HOSTILE), {
			limits: { heapMb: 128, timeoutMs: 8_000 },
		});
		expect(outcome.kind).toBe("exhausted");
		/** The process that ran the hostile compile still compiles the next project. */
		const after = await compileRuntimeInIsolation(project(ORDINARY));
		expect(after.kind).toBe("compiled");
	}, 60_000);

	/**
	 * TypeScript's parser and checker recurse, so nesting alone overflows the thread's stack long
	 * before the memory ceiling or the deadline. That is the source's doing like the other two; it
	 * used to escape as an ordinary thread error and became a 500 with an incident log line.
	 */
	test("source that overflows the thread's stack is exhaustion, not a server error", async () => {
		const outcome = await compileRuntimeInIsolation(project(DEEP));
		expect(outcome).toEqual({ kind: "exhausted", reason: "stack" });
	}, 60_000);
});

/**
 * ⚠️ Each nests far past anything a person writes: the parser recurses once per bracket. Five
 * thousand overflowed the default stack in under a second when measured.
 */
const DEEP = `${ORDINARY}
export const z = ${"[".repeat(5_000)}${"]".repeat(5_000)};
`;

/**
 * Slow without being large: two thousand brackets keep the checker busy until the deadline rather
 * than the stack or the heap, so a test can watch a compile that is still running.
 */
const SLOW = `${ORDINARY}
export const z = ${"[".repeat(2_000)}${"]".repeat(2_000)};
`;

describe("one member, one compile", () => {
	/**
	 * The gate's slots are the whole process's. Without a per-member cap, one account sending a few
	 * compiles that run to the deadline held every slot and the queue, and everyone else's publish
	 * answered `busy`.
	 */
	test("a second compile from the same member is refused while the first runs", async () => {
		const first = compileRuntimeInIsolation(project(ORDINARY), {
			member: "member-a",
		});
		const second = await compileRuntimeInIsolation(project(ORDINARY), {
			member: "member-a",
		});
		expect(second).toEqual({ kind: "member-busy" });
		/** Another member is not held up by member-a. */
		const other = await compileRuntimeInIsolation(project(ORDINARY), {
			member: "member-b",
		});
		expect(other.kind).toBe("compiled");
		expect((await first).kind).toBe("compiled");
		/** Once the first has ended, the member may compile again. */
		const again = await compileRuntimeInIsolation(project(ORDINARY), {
			member: "member-a",
		});
		expect(again.kind).toBe("compiled");
	}, 60_000);

	/**
	 * A request whose client left used to keep its thread to the deadline: nothing told the compile.
	 * Now the request's signal ends the thread, and the slot comes back once the thread has exited.
	 */
	test("a cancelled compile ends its thread and gives the slot back", async () => {
		const controller = new AbortController();
		const started = Date.now();
		const pending = compileRuntimeInIsolation(project(SLOW), {
			member: "member-c",
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 1_000);
		expect(await pending).toEqual({ kind: "cancelled" });
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(runtimeCompileStats()).toEqual({
			inFlight: 0,
			queued: 0,
			members: 0,
		});
	}, 60_000);

	test("a signal that already fired compiles nothing", async () => {
		const outcome = await compileRuntimeInIsolation(project(ORDINARY), {
			member: "member-d",
			signal: AbortSignal.abort(),
		});
		expect(outcome).toEqual({ kind: "cancelled" });
		expect(runtimeCompileStats().members).toBe(0);
	});
});
