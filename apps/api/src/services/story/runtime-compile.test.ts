import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { describe, expect, test } from "vitest";
import { compileRuntimeInIsolation } from "./runtime-compile.ts";

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
			heapMb: 128,
			timeoutMs: 8_000,
		});
		expect(outcome.kind).toBe("exhausted");
		/** The process that ran the hostile compile still compiles the next project. */
		const after = await compileRuntimeInIsolation(project(ORDINARY));
		expect(after.kind).toBe("compiled");
	}, 60_000);
});
