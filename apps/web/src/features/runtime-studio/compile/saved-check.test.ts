import { describe, expect, it } from "vitest";
import { runtimeSavedCheck } from "./saved-check.ts";

/**
 * Structural check of saved code. The test records by value what it catches and what it misses. It
 * cannot catch type errors, which is why the UI label is `Structure check` (structural check) and not a full
 * check.
 */

const main = (content: string) => ({ path: "src/main.tsx", content });

describe("runtimeSavedCheck", () => {
	it("no problems when the entry exists and resolves", () => {
		expect(
			runtimeSavedCheck({
				entry: "src/main.tsx",
				files: [
					main(
						'import { Screen } from "@rowcat/runtime";\nexport default function App() { return <Screen />; }',
					),
				],
			}),
		).toEqual({ status: "clean" });
	});

	it("a missing entry is a problem", () => {
		expect(
			runtimeSavedCheck({ entry: "src/main.tsx", files: [] }),
		).toMatchObject({ status: "problems" });
	});

	it("an unresolved import is a problem", () => {
		const check = runtimeSavedCheck({
			entry: "src/main.tsx",
			files: [
				main(
					'import { x } from "../missing";\nexport default function App() { return null; }',
				),
			],
		});
		expect(check).toMatchObject({ status: "problems" });
		if (check.status === "problems") expect(check.errors).toBeGreaterThan(0);
	});

	it("it can't catch type errors, which is why it's a structure check", () => {
		expect(
			runtimeSavedCheck({
				entry: "src/main.tsx",
				files: [
					main(
						'const n: number = "not a number";\nexport default function App() { return null; }',
					),
				],
			}),
		).toEqual({ status: "clean" });
	});
});
