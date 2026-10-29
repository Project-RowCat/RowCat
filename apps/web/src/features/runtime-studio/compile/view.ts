import { translator } from "#/lib/i18n/current.ts";
import type { RuntimeProblem } from "./problems.ts";
import {
	RUNTIME_COMPILE_STATUS,
	type RuntimeCompileState,
	type RuntimeCompileStatus,
} from "./state.ts";

/**
 * The single inspection status the screen draws. Two inputs must yield one answer.
 *
 * It answers whether this project can produce an artifact right now, which depends on both inputs.
 * A full compile passes type checking, so while any TypeScript error remains, nothing is emitted
 * (`hasBlockingError` in `compile.ts`).
 *
 * The status once came from runtime analysis alone, so the screen contradicted itself: `Problems`
 * listed a ts2322 error while the summary read `No problems`. No error is raised for that, and creators
 * tend to trust the summary.
 *
 * The input is the merged list `Problems` actually draws, not the separate marker sets. That list
 * already folds duplicates at the same position (`runtime-problems.ts`), so the count here is the
 * count creators can see. Counting the two sources separately would allow `Problems` to show three
 * lines while the summary says four.
 *
 * Warnings do not block. The emit predicate matches the compiler's: only `severity === "error"`
 * counts. Blocking on warnings would force unnecessary fixes, while folding warnings into `No problems`
 * would contradict the `Problems` lines. So eligibility and wording are separated: the project is
 * eligible, and the wording counts the warnings.
 *
 * No `Running`, `Running`, or `Live` appears anywhere. Even when compilation passes, this build
 * executes nothing, and `Execution` stays `unavailable` (`runtime-panels.ts`).
 */

export interface RuntimeCompileView {
	status: RuntimeCompileStatus;
	/** Number of blocking problems, computed after both inputs are merged. */
	errors: number;
	warnings: number;
	/**
	 * Would a full compile produce an artifact right now? False while idle or checking. Drawing
	 * unknown state as eligible would let screens built in that interval promise a pass.
	 */
	eligible: boolean;
}

const count = (
	problems: readonly RuntimeProblem[],
	severity: "error" | "warning",
): number =>
	problems.reduce(
		(total, problem) => (problem.severity === severity ? total + 1 : total),
		0,
	);

export function deriveRuntimeCompileView({
	compile,
	problems,
}: {
	compile: RuntimeCompileState;
	problems: readonly RuntimeProblem[];
}): RuntimeCompileView {
	const errors = count(problems, "error");
	const warnings = count(problems, "warning");

	/**
	 * The checker's own failure is not something the creator can fix, so it must be shown first.
	 * Counting errors in this state and drawing `N problems` would push creators to edit their own code.
	 */
	if (compile.status === RUNTIME_COMPILE_STATUS.failed)
		return {
			status: RUNTIME_COMPILE_STATUS.failed,
			errors,
			warnings,
			eligible: false,
		};

	/**
	 * If runtime analysis has not answered yet, the screen should say so. Monaco's diagnostics may
	 * already exist at this point, since its worker does not wait for our debounce. Drawing `N problems`
	 * from that half alone would make the count jump again each time runtime diagnostics arrive, 250ms
	 * later. The count is carried, but the wording says in progress.
	 */
	if (
		compile.status === RUNTIME_COMPILE_STATUS.idle ||
		compile.status === RUNTIME_COMPILE_STATUS.checking
	)
		return { status: compile.status, errors, warnings, eligible: false };

	return {
		status:
			errors > 0
				? RUNTIME_COMPILE_STATUS.problems
				: RUNTIME_COMPILE_STATUS.ready,
		errors,
		warnings,
		eligible: errors === 0,
	};
}

/**
 * Whether this state has anything to press, that is, whether `Problems` will draw any line. Opening
 * the list is useful only if it has content; an empty panel teaches users to stop pressing. True
 * when a blocking error exists, a warning exists, or the checker itself failed. The last is
 * included because that failure is drawn as a line too, so the creator can read what failed even
 * though they cannot fix it. `No problems` stays a quiet state. A button that does nothing would make
 * this line decoration, not status, and the affordance would not stand out when a real error
 * appears.
 */
export const runtimeCompileActionable = (view: RuntimeCompileView): boolean =>
	view.status === RUNTIME_COMPILE_STATUS.failed ||
	view.errors > 0 ||
	view.warnings > 0;

/**
 * The status line sentence, split into pieces: a numbered sentence has its number as a separate
 * piece. The header rolls that number (`AnimatedCount`): going from `2 problems` to `3 problems` moves only
 * the number, not the sentence. Emitting one sentence would force the screen to split it again, and
 * any divergence from these rules would make readable and drawn text differ. So the sentence
 * (`runtimeCompileLabel`) is derived from these pieces rather than kept as a second copy. `count`
 * is null for sentences with no number to roll.
 */
export interface RuntimeCompileLabelParts {
	before: string;
	count: string | null;
	after: string;
}

export function runtimeCompileLabelParts(
	view: RuntimeCompileView,
): RuntimeCompileLabelParts {
	const t = translator("runtimeStudio");
	switch (view.status) {
		case RUNTIME_COMPILE_STATUS.idle:
			return { before: t("compile.idle"), count: null, after: "" };
		case RUNTIME_COMPILE_STATUS.checking:
			return { before: t("compile.checking"), count: null, after: "" };
		case RUNTIME_COMPILE_STATUS.ready:
			return view.warnings > 0
				? countedParts(
						t("compile.warnings", { count: view.warnings, value: SLOT }),
						view.warnings,
					)
				: { before: t("compile.clean"), count: null, after: "" };
		case RUNTIME_COMPILE_STATUS.problems:
			return countedParts(
				t("compile.problems", { count: view.errors, value: SLOT }),
				view.errors,
			);
		case RUNTIME_COMPILE_STATUS.failed:
			return { before: t("compile.failed"), count: null, after: "" };
	}
}

/**
 * Where the number sits in a counted sentence. The dictionary places it (word order differs by
 * locale), so the sentence is rendered with a marker in the number's place and split there; the
 * count itself still chooses the plural form.
 */
const SLOT = "\u0000";

function countedParts(
	sentence: string,
	count: number,
): RuntimeCompileLabelParts {
	const at = sentence.indexOf(SLOT);
	if (at < 0) return { before: sentence, count: null, after: "" };
	return {
		before: sentence.slice(0, at),
		count: String(count),
		after: sentence.slice(at + SLOT.length),
	};
}

/**
 * The one sentence the status line draws. `N warnings` is kept apart from `No problems` on purpose. Both are
 * eligible, but writing `No problems` while warnings exist would make the `Problems` lines and the
 * summary say different things. That mismatch is exactly what this slice fixed.
 */
export function runtimeCompileLabel(view: RuntimeCompileView): string {
	const parts = runtimeCompileLabelParts(view);
	return `${parts.before}${parts.count ?? ""}${parts.after}`;
}

/**
 * The axis along which the sentence changes; the header's word alternation uses this value as its
 * key. The raw state is not the key because of `checking`: runtime analysis restarts on every
 * keystroke, so the state flips between `checking` and `problems` throughout editing. Drawing each
 * flip as a word change would make this line a constantly moving element while typing (see the
 * always-running decoration rule in `docs/motion/ARCHITECTURE.md`). Here `checking` and `idle`
 * share one value meaning 'no answer yet'. The screen swaps the word only when the answer changes;
 * the text still changes to `Checking…`, it just does not move.
 */
export type RuntimeCompileFamily =
	| "pending"
	| "ready"
	| "warnings"
	| "problems"
	| "failed";

export function runtimeCompileFamily(
	view: RuntimeCompileView,
): RuntimeCompileFamily {
	switch (view.status) {
		case RUNTIME_COMPILE_STATUS.idle:
		case RUNTIME_COMPILE_STATUS.checking:
			return "pending";
		case RUNTIME_COMPILE_STATUS.ready:
			return view.warnings > 0 ? "warnings" : "ready";
		case RUNTIME_COMPILE_STATUS.problems:
			return "problems";
		case RUNTIME_COMPILE_STATUS.failed:
			return "failed";
	}
}
