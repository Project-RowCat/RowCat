import { RUNTIME_ENTRY_PATH } from "@rowcat/authoring";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { RUNTIME_COMPILER_VERSION } from "@rowcat/runtime-compiler";
import { RUNTIME_EXECUTION_LABEL } from "#/features/runtime-preview/runtime-preview-copy.ts";
import type { RuntimePreviewStatus } from "#/features/runtime-preview/runtime-preview-state.ts";
import { deferredTranslator } from "#/lib/i18n/current.ts";
import {
	type RuntimeCompileView,
	runtimeCompileLabel,
} from "../compile/view.ts";

const tr = deferredTranslator("runtimeStudio");

/**
 * The bottom panel's vocabulary and the facts the Runtime tab shows. There is no fake telemetry:
 * nothing like execution time, memory, FPS or request counts. Every value here is a fact answerable
 * now: the two package versions, entry file, file count, modules reachable from the entry, the
 * combined check status, and the preview execution status. Nothing measured is presented as
 * measured.
 */

/**
 * There are four tabs now. Console and State were removed earlier because they only drew an
 * 'available once the engine exists' line. They returned once execution produced real values:
 * console output, and the playthrough snapshot produced by useStoryState. Hook state is still
 * absent, because useState belongs to the VM and no channel exposes it. Adding a tab value requires
 * a label, since RUNTIME_PANEL_LABEL is a Record. The bottom panel's render branch must also cover
 * the whole vocabulary.
 */
export const RUNTIME_PANEL_TABS = [
	"problems",
	"console",
	"state",
	"runtime",
] as const;
export type RuntimePanelTab = (typeof RUNTIME_PANEL_TABS)[number];

/**
 * Tab names are English because authors already know these terms from other tools, not because of a
 * devtools convention. The Korean descriptions beside them carry the explanation. The label map is
 * a Record, so adding a tab breaks compilation until its label is added.
 */
export const RUNTIME_PANEL_LABEL: Record<RuntimePanelTab, string> = {
	problems: "Problems",
	console: "Console",
	state: "State",
	runtime: "Runtime",
};

/**
 * Text each tab shows when empty. It says why the tab is empty, not only that it is empty. A bare
 * 'nothing yet' would make the user think they did something wrong, with no way on screen to
 * resolve that. The Runtime tab has no empty copy, since it always shows known facts.
 * Filtered-to-nothing is a separate state (RUNTIME_STUDIO.problemsFilterEmpty). Merging the two
 * would tell an errors-only user there are no problems while warnings exist.
 */
export const RUNTIME_PROBLEMS_EMPTY = {
	get title() {
		return tr("problemsEmpty.title");
	},
	get body() {
		return tr("problemsEmpty.body");
	},
} as const;

/** Inputs for the Runtime tab's facts. Every value must be knowable now; nothing is measured. */
export interface RuntimeFactsInput {
	entry: string;
	fileCount: number;
	enabled: boolean;
	/** Module ids reachable from the entry point. Only runtime analysis can answer this. */
	modules: readonly string[];
	/**
	 * The combined check status from both sources. It is not the runtime analysis status alone: that
	 * half would contradict Problems (runtime-compile-view.ts).
	 */
	compile: RuntimeCompileView;
	/** Preview execution status, using the state machine's terms verbatim. */
	execution: RuntimePreviewStatus;
}

/**
 * Facts are identified by id, not by label. Branching on fact.label === 'Entry' would make that
 * string a contract: renaming a label would silently disable the open-entry action, with no compile
 * or test failure.
 */
export const RUNTIME_FACT_IDS = [
	"runtime-api",
	"compiler",
	"entry",
	"files",
	"modules",
	"compile",
	"execution",
	"attached",
] as const;
export type RuntimeFactId = (typeof RUNTIME_FACT_IDS)[number];

export interface RuntimeFact {
	id: RuntimeFactId;
	label: string;
	value: string;
}

/**
 * Only facts the code can actually know are recorded.
 * - The Runtime API and Compiler versions come from real constants. The earlier `Coming soon` (in
 *   preparation) text was a promise, not a value.
 * - Modules counts modules reachable from the entry point, not files. A file that is not
 *   connected is not compiled and appears nowhere else.
 * - Compile combines Monaco type diagnostics and runtime compiler errors. Its N is the error
 *   count Problems actually shows, so the two must agree.
 * - Execution is preview state, a separate axis. Compile can pass while running still needs a
 *   button press. Folding the two together would read 'no issues' as 'running'.
 */
export function runtimeFacts(input: RuntimeFactsInput): RuntimeFact[] {
	return [
		{
			id: "runtime-api",
			label: "Runtime API",
			value: `v${RUNTIME_API_VERSION}`,
		},
		{
			id: "compiler",
			label: "Compiler",
			value: `v${RUNTIME_COMPILER_VERSION}`,
		},
		{ id: "entry", label: "Entry", value: input.entry || RUNTIME_ENTRY_PATH },
		{ id: "files", label: "Project files", value: `${input.fileCount}` },
		{ id: "modules", label: "Modules", value: `${input.modules.length}` },
		{
			id: "compile",
			label: "Compile",
			value: runtimeCompileLabel(input.compile),
		},
		{
			id: "execution",
			label: "Execution",
			value: RUNTIME_EXECUTION_LABEL[input.execution],
		},
		{ id: "attached", label: "Attached", value: input.enabled ? "yes" : "no" },
	];
}
