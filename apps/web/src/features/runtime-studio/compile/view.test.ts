import type { RuntimeDiagnostic } from "@rowcat/runtime-compiler";
import { describe, expect, it } from "vitest";
import type { RuntimeMarker } from "../editor/code-editor.tsx";
import { mergeRuntimeProblems } from "./problems.ts";
import {
	initialRuntimeCompileState,
	RUNTIME_COMPILE_STATUS,
	type RuntimeCompileState,
	runtimeCompileReducer,
} from "./state.ts";
import {
	deriveRuntimeCompileView,
	runtimeCompileActionable,
	runtimeCompileFamily,
	runtimeCompileLabel,
	runtimeCompileLabelParts,
} from "./view.ts";

/**
 * Checks that the two inputs (runtime analysis and Monaco diagnostics) yield one answer on screen.
 *
 * This property was broken for a while. The status came from runtime analysis alone, so a project
 * with a TypeScript error contradicted itself: `Problems` listed a ts2322 error while the summary
 * read `No problems`. No error is raised for that contradiction, and creators tend to trust the summary.
 */

const analysis = (
	diagnostics: readonly RuntimeDiagnostic[],
): RuntimeCompileState => ({
	...initialRuntimeCompileState,
	status:
		diagnostics.length > 0
			? RUNTIME_COMPILE_STATUS.problems
			: RUNTIME_COMPILE_STATUS.ready,
	diagnostics,
	modules: ["src/main.tsx"],
	requested: 1,
	settled: 1,
});

const runtimeDiagnostic = (
	severity: "error" | "warning",
	line = 1,
): RuntimeDiagnostic => ({
	code: "runtime_import_forbidden",
	severity,
	message: "npm packages can't be imported.",
	source: "policy",
	path: "src/main.tsx",
	line,
	column: 1,
});

const marker = (
	severity: "error" | "warning" | "info",
	line = 10,
): RuntimeMarker => ({
	fileId: "f_1",
	path: "src/main.tsx",
	line,
	column: 1,
	message: "Type 'number' is not assignable to type 'string'.",
	severity,
});

/**
 * Goes through the same path as the screen. If merging and de-duplication were skipped, this test
 * would not describe the screen.
 */
const view = (
	compile: RuntimeCompileState,
	markers: readonly RuntimeMarker[],
) =>
	deriveRuntimeCompileView({
		compile,
		problems: mergeRuntimeProblems({
			markers: [...markers],
			diagnostics: compile.diagnostics,
		}),
	});

describe("two sources become one answer", () => {
	it("Ready when both are clean", () => {
		const result = view(analysis([]), []);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.ready);
		expect(result.eligible).toBe(true);
		expect(runtimeCompileLabel(result)).toBe("No problems");
	});

	it("Problems even when only the runtime diagnostic errors", () => {
		const result = view(analysis([runtimeDiagnostic("error")]), []);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.problems);
		expect(result.eligible).toBe(false);
		expect(runtimeCompileLabel(result)).toBe("1 problem");
	});

	/**
	 * This one line is the whole fix in this slice. Runtime analysis does not check types, so it
	 * reports `ready` here, yet a full compile does not emit that project.
	 */
	it("Problems even with only a Monaco type error", () => {
		const result = view(analysis([]), [marker("error")]);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.problems);
		expect(result.eligible).toBe(false);
		expect(runtimeCompileLabel(result)).toBe("1 problem");
	});

	it("counts both together when both error", () => {
		const result = view(analysis([runtimeDiagnostic("error", 1)]), [
			marker("error", 10),
			marker("error", 11),
		]);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.problems);
		expect(result.errors).toBe(3);
		expect(runtimeCompileLabel(result)).toBe("3 problems");
	});
});

describe("warnings do not block", () => {
	/**
	 * The emit eligibility predicate matches the compiler's (`severity === "error"`). Blocking on
	 * warnings would force creators to fix things that need no fixing.
	 */
	it("eligible with only runtime warnings", () => {
		const result = view(analysis([runtimeDiagnostic("warning")]), []);
		expect(result.eligible).toBe(true);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.ready);
	});

	it("eligible with only Monaco warnings too", () => {
		const result = view(analysis([]), [marker("warning")]);
		expect(result.eligible).toBe(true);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.ready);
	});

	/**
	 * Eligible, but it does not write `No problems`. Saying there is no issue while `Problems` has a line
	 * would make the two claim different things.
	 */
	it("counts warnings even when eligible", () => {
		const result = view(analysis([]), [
			marker("warning", 10),
			marker("warning", 11),
		]);
		expect(runtimeCompileLabel(result)).toBe("2 warnings");
	});

	it("with errors it states errors, not warnings", () => {
		const result = view(analysis([]), [
			marker("error", 10),
			marker("warning", 11),
		]);
		expect(runtimeCompileLabel(result)).toBe("1 problem");
		expect(result.warnings).toBe(1);
	});

	/**
	 * Monaco's `info` markers are hints. `Problems` does not count them, so this view does not count
	 * them either.
	 */
	it("hints count toward neither number", () => {
		const result = view(analysis([]), [marker("info")]);
		expect(result).toMatchObject({ errors: 0, warnings: 0, eligible: true });
		expect(runtimeCompileLabel(result)).toBe("No problems");
	});
});

describe("the count matches Problems", () => {
	/**
	 * Duplicates at the same position are already folded by the merge, and RowCat's judgment wins.
	 * Counting each source separately would allow a state where `Problems` shows one line but the
	 * summary counts two.
	 */
	it("does not count duplicates at the same place twice", () => {
		const compile = analysis([runtimeDiagnostic("error", 3)]);
		const markers = [marker("error", 3)];
		const problems = mergeRuntimeProblems({
			markers,
			diagnostics: compile.diagnostics,
		});
		expect(problems).toHaveLength(1);
		expect(view(compile, markers).errors).toBe(1);
	});
});

describe("before it answers", () => {
	it("waiting to check if it never ran", () => {
		const result = view(initialRuntimeCompileState, []);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.idle);
		expect(runtimeCompileLabel(result)).toBe("Waiting to check");
	});

	/**
	 * Unknown state is not drawn as eligible. Promising a pass before checking finishes would make any
	 * screen drawn in that interval lie.
	 */
	it("not eligible before analysis", () => {
		expect(view(initialRuntimeCompileState, []).eligible).toBe(false);
	});

	/**
	 * Monaco's worker does not wait for our debounce, so diagnostics can exist during `checking`. The
	 * count is carried, but the wording says in progress. Otherwise the number would jump once more
	 * every 250ms.
	 */
	it("while checking it counts but says it's in progress", () => {
		const checking: RuntimeCompileState = {
			...initialRuntimeCompileState,
			status: RUNTIME_COMPILE_STATUS.checking,
			requested: 2,
			settled: 1,
		};
		const result = view(checking, [marker("error")]);
		expect(result.errors).toBe(1);
		expect(result.eligible).toBe(false);
		expect(runtimeCompileLabel(result)).toBe("Checking…");
	});
});

describe("the checker's own failure", () => {
	const failed: RuntimeCompileState = {
		...initialRuntimeCompileState,
		status: RUNTIME_COMPILE_STATUS.failed,
		diagnostics: [
			{
				code: "runtime_api_version_unsupported",
				severity: "error",
				message: "Couldn't run the runtime checker.",
				source: "runtime",
			},
		],
		requested: 1,
		settled: 1,
	};

	/**
	 * Not folded into a `N problems` count: the creator cannot fix this, and that count would push them to
	 * edit their own code.
	 */
	it("does not fold into a problem count", () => {
		const result = view(failed, [marker("error")]);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.failed);
		expect(runtimeCompileLabel(result)).toBe("Check failed");
		expect(result.eligible).toBe(false);
	});
});

describe("copy", () => {
	/**
	 * If `Running` (Running) appeared in this table, creators would read their code as running. This
	 * build has no execution engine.
	 */
	it("does not imply running", () => {
		const labels = (
			[
				RUNTIME_COMPILE_STATUS.idle,
				RUNTIME_COMPILE_STATUS.checking,
				RUNTIME_COMPILE_STATUS.ready,
				RUNTIME_COMPILE_STATUS.problems,
				RUNTIME_COMPILE_STATUS.failed,
			] as const
		)
			.flatMap((status) => [
				runtimeCompileLabel({
					status,
					errors: 0,
					warnings: 0,
					eligible: false,
				}),
				runtimeCompileLabel({
					status,
					errors: 2,
					warnings: 3,
					eligible: false,
				}),
			])
			.join("\n");
		for (const promise of [
			"run",
			"build",
			"Running",
			"Live",
			"Runtime ready",
			"soon",
		])
			expect(labels).not.toContain(promise);
	});
});

/**
 * The header status is pressable only when there is something to press. If it were pressable with
 * nothing there, the user would get an empty panel and stop pressing it, which would hide the
 * affordance for when a real error appears.
 */
describe("is there something to press", () => {
	const view = (
		status: (typeof RUNTIME_COMPILE_STATUS)[keyof typeof RUNTIME_COMPILE_STATUS],
		errors: number,
		warnings: number,
	) => ({ status, errors, warnings, eligible: false });

	it("no problems stays a quiet state", () => {
		expect(
			runtimeCompileActionable(view(RUNTIME_COMPILE_STATUS.ready, 0, 0)),
		).toBe(false);
	});

	it("pressable with errors", () => {
		expect(
			runtimeCompileActionable(view(RUNTIME_COMPILE_STATUS.problems, 2, 0)),
		).toBe(true);
	});

	/** Warnings are also drawn as lines in `Problems`, so opening it shows something. */
	it("pressable with only warnings", () => {
		expect(
			runtimeCompileActionable(view(RUNTIME_COMPILE_STATUS.ready, 0, 3)),
		).toBe(true);
	});

	/** The checker's own failure is also drawn as one line in the list. */
	it("a check failure is pressable even with no count", () => {
		expect(
			runtimeCompileActionable(view(RUNTIME_COMPILE_STATUS.failed, 0, 0)),
		).toBe(true);
	});

	/** Unknown state is not made pressable; there is nothing to count yet. */
	it("nothing to press before checking", () => {
		expect(
			runtimeCompileActionable(view(RUNTIME_COMPILE_STATUS.idle, 0, 0)),
		).toBe(false);
	});
});

/**
 * The header draws the sentence in pieces: the number rolls, and the word changes only when the
 * answer changes. Joining the pieces must always give one sentence. If they diverged, the readable
 * text (`runtimeCompileLabel`) and the drawn text would differ, and only assistive technology would
 * show it.
 */
describe("sentence pieces", () => {
	const views = [
		{
			status: RUNTIME_COMPILE_STATUS.idle,
			errors: 0,
			warnings: 0,
			eligible: false,
		},
		{
			status: RUNTIME_COMPILE_STATUS.checking,
			errors: 2,
			warnings: 1,
			eligible: false,
		},
		{
			status: RUNTIME_COMPILE_STATUS.ready,
			errors: 0,
			warnings: 0,
			eligible: true,
		},
		{
			status: RUNTIME_COMPILE_STATUS.ready,
			errors: 0,
			warnings: 3,
			eligible: true,
		},
		{
			status: RUNTIME_COMPILE_STATUS.problems,
			errors: 12,
			warnings: 1,
			eligible: false,
		},
		{
			status: RUNTIME_COMPILE_STATUS.failed,
			errors: 1,
			warnings: 0,
			eligible: false,
		},
	] as const;

	it("joining the pieces gives the sentence", () => {
		for (const view of views) {
			const parts = runtimeCompileLabelParts(view);
			expect(`${parts.before}${parts.count ?? ""}${parts.after}`).toBe(
				runtimeCompileLabel(view),
			);
		}
	});

	it("only counted sentences have a number to roll", () => {
		expect(runtimeCompileLabelParts(views[4]).count).toBe("12");
		expect(runtimeCompileLabelParts(views[3]).count).toBe("3");
		expect(runtimeCompileLabelParts(views[2]).count).toBeNull();
		expect(runtimeCompileLabelParts(views[1]).count).toBeNull();
		expect(runtimeCompileLabelParts(views[5]).count).toBeNull();
	});

	/**
	 * `checking` is not an answer. Runtime analysis restarts on every keystroke, so if this value
	 * varied, the header's word would flow throughout typing. The test checks that pending and
	 * checking share one value, and that the four answers differ.
	 */
	it("waiting and checking are the same value, and the four answers differ", () => {
		expect(runtimeCompileFamily(views[0])).toBe("pending");
		expect(runtimeCompileFamily(views[1])).toBe("pending");
		expect(
			new Set(views.slice(2).map((view) => runtimeCompileFamily(view))).size,
		).toBe(4);
	});
});

describe("after an edit the earlier success doesn't remain eligibility", () => {
	/**
	 * Publishing happens outside the studio. Creators trust the word they last saw, go to the draft
	 * editor, and publish. So a `No problems` shown for code that was just edited is the worst case: it
	 * carries straight into publishing. A `No problems` left over from code no longer on screen disappears
	 * on the next keystroke.
	 *
	 * Both pieces must hold together. The reducer switches to `checking` immediately on edit (not
	 * after the debounce; `use-runtime-compile.ts` sends `start` before `setTimeout`), and the screen
	 * grants no eligibility in that state. Checking each piece separately would leave both tests green
	 * even if the line joining them were removed.
	 */
	it("an edit after success loses eligibility at once", () => {
		const settled = analysis([]);
		expect(view(settled, []).eligible).toBe(true);

		const edited = runtimeCompileReducer(settled, {
			type: "start",
			requestId: settled.requested + 1,
		});
		const result = view(edited, []);
		expect(result.status).toBe(RUNTIME_COMPILE_STATUS.checking);
		expect(result.eligible).toBe(false);
		expect(runtimeCompileLabel(result)).not.toBe("No problems");
	});

	/**
	 * After a newer result is in place, an earlier analysis arriving late must not roll the screen
	 * back. The request number is the whole judgment. This test checks that the staleness check also
	 * gates the screen's eligibility; the reducer alone does not show what the screen drew.
	 */
	it("an earlier result arriving late does not roll back the screen", () => {
		const started = runtimeCompileReducer(initialRuntimeCompileState, {
			type: "start",
			requestId: 1,
		});
		const edited = runtimeCompileReducer(started, {
			type: "start",
			requestId: 2,
		});
		const fresh = runtimeCompileReducer(edited, {
			type: "settle",
			requestId: 2,
			result: {
				diagnostics: [runtimeDiagnostic("error")],
				modules: ["src/main.tsx"],
			},
		});
		expect(view(fresh, []).eligible).toBe(false);

		/** An analysis of pre-edit code finishes only now; that code is no longer on screen. */
		const late = runtimeCompileReducer(fresh, {
			type: "settle",
			requestId: 1,
			result: { diagnostics: [], modules: ["src/main.tsx"] },
		});
		expect(late).toBe(fresh);
		expect(view(late, []).eligible).toBe(false);
		expect(runtimeCompileLabel(view(late, []))).toBe("1 problem");
	});
});
