import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	RuntimePreviewConsole,
	RuntimePreviewConsoleEntry,
} from "#/features/runtime-preview/runtime-preview-console.ts";
import { RUNTIME_PREVIEW } from "#/features/runtime-preview/runtime-preview-copy.ts";
import type { RuntimePreviewStatus } from "#/features/runtime-preview/runtime-preview-state.ts";
import {
	type StoryStateRow,
	storyStateRows,
} from "#/features/runtime-preview/runtime-preview-story-state.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { contentEnter, contentExit } from "#/lib/motion/surface-content.ts";
import {
	filterRuntimeProblems,
	RUNTIME_PROBLEM_FILTERS,
	type RuntimeProblem,
	type RuntimeProblemFilter,
	runtimeProblemLocation,
} from "../compile/problems.ts";
import type { RuntimeCompileView } from "../compile/view.ts";
import { RUNTIME_STUDIO } from "../runtime-copy.ts";
import {
	RUNTIME_PANEL_LABEL,
	RUNTIME_PANEL_TABS,
	RUNTIME_PROBLEMS_EMPTY,
	type RuntimePanelTab,
	runtimeFacts,
} from "./panels.ts";

/**
 * - Bottom tool panel with tab slots and a collapsed state, following developer-tool conventions.
 *   It shows no invented metrics (no run time, memory, frame or request counts).
 * - Runtime tab lists only facts answerable now (runtimeFacts in runtime-panels.ts). Console
 *   draws only lines the preview worker actually sent. While nothing has run, it is empty and says
 *   why.
 * - Collapsed by default. It opens from the header check status, never while typing, because
 *   mid-edit syntax errors are normal and would reopen it constantly.
 * - Geometry changes instantly and only content fades (surface-content.ts). Panel height equals
 *   the Monaco height, and animating it would relayout the editor every frame.
 * - Only the tab and filter active indicators, problem row enter and exit (unordered), and the
 *   list-to-empty-state swap move.
 * - Rows are keyed by problem.key, so filtering never turns one diagnostic into another.
 */
export function RuntimeBottomPanel({
	panel,
	problems,
	entry,
	fileCount,
	enabled,
	modules,
	compile,
	entryExists,
	execution,
	console,
	storyState,
	persistentState,
	onSelect,
	onOpenProblem,
	onOpenEntry,
	onClearConsole,
}: {
	/** `null` means the panel is collapsed. */
	panel: RuntimePanelTab | null;
	problems: RuntimeProblem[];
	entry: string;
	fileCount: number;
	enabled: boolean;
	/** Module ids reachable from the entry point. Only runtime analysis can answer this. */
	modules: readonly string[];
	compile: RuntimeCompileView;
	/**
	 * Whether the file exists at that path. This gates the open action: when the file is missing, the
	 * value is shown but not clickable, because a button that does nothing is worse. The missing entry
	 * point is already stated by a Problems row.
	 */
	entryExists: boolean;
	/** Preview execution status. The Runtime tab's `Execution` row renders it. */
	execution: RuntimePreviewStatus;
	/** Lines sent by the preview worker. This is a bounded buffer. */
	console: RuntimePreviewConsole;
	/** The current preview playthrough. It is the first section of the State tab. */
	storyState: RuntimeStoryStateSnapshot;
	/** The long-lived preview state. It is the second section of the same State tab. */
	persistentState: RuntimePersistentStateSnapshot;
	onSelect: (panel: RuntimePanelTab | null) => void;
	onOpenProblem: (problem: RuntimeProblem) => void;
	/**
	 * Jumps to the entry file. It goes through the same navigate transition as quick open and
	 * diagnostics.
	 */
	onOpenEntry: () => void;
	onClearConsole: () => void;
}) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const open = panel !== null;

	/**
	 * The severity filter for the Problems list is screen state, not workspace state. It is not in the
	 * reducer and not persisted. Nothing revisits it, and saving it would show an empty list to
	 * someone who filtered to errors in a project that now has only warnings.
	 */
	const [filter, setFilter] = useState<RuntimeProblemFilter>("all");

	return (
		<section
			aria-label={RUNTIME_STUDIO.panel}
			className="flex min-h-0 shrink-0 flex-col border-t bg-card"
		>
			<div
				role="tablist"
				aria-label={RUNTIME_STUDIO.panel}
				className="flex shrink-0 items-center gap-1 px-2 py-1"
			>
				{RUNTIME_PANEL_TABS.map((tab) => {
					const active = panel === tab;
					return (
						<button
							key={tab}
							type="button"
							role="tab"
							aria-selected={active}
							className={cn(
								"relative rounded-md px-2.5 py-1 text-xs font-medium",
								active
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							/**
							 * Clicking an open tab again collapses it. The close button sits at the far right, but
							 * toggling in place is quicker to reverse.
							 */
							onClick={() => onSelect(active ? null : tab)}
						>
							{/*
							 * The active face is one element that moves between sibling tabs. While collapsed, no tab is
							 * active and no indicator shows; on open it appears on the chosen tab. Its name space is separate
							 * from the severity filter below, and both may be on at once.
							 */}
							{active && (
								<MotionActiveIndicator
									group="runtime-panel-tab"
									className="absolute inset-0 rounded-md bg-accent"
								/>
							)}
							<span className="relative">{RUNTIME_PANEL_LABEL[tab]}</span>
							{/*
							 * The badge uses the same values as the header sentence. A single total would put `Problems 3`
							 * beside `1 problem`, which count different things. Counts are split by severity so each number
							 * states what it counts. No notification badge: the number measures density, not urgency, and it
							 * is normally non-zero while coding.
							 */}
							{tab === "problems" && compile.errors > 0 && (
								<span className="relative ms-1.5 text-destructive">
									<span className="sr-only">
										{t("bottomPanel.errorPrefix")}
									</span>
									{compile.errors}
								</span>
							)}
							{tab === "problems" && compile.warnings > 0 && (
								<span className="relative ms-1.5 text-muted-foreground">
									<span className="sr-only">
										{t("bottomPanel.warningPrefix")}
									</span>
									{compile.warnings}
								</span>
							)}
						</button>
					);
				})}
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="icon"
					className="size-7"
					aria-label={
						open ? RUNTIME_STUDIO.closePanel : RUNTIME_STUDIO.openPanel
					}
					onClick={() => onSelect(open ? null : "problems")}
				>
					{open ? (
						<ChevronDown className="size-4" />
					) : (
						<ChevronUp className="size-4" />
					)}
				</Button>
			</div>

			{open && (
				/*
				 * Content fades in only when the panel opens. Switching tabs keeps the box mounted and changes
				 * only the inner content, so it does not fade again. `key` is deliberately not set to the tab.
				 */
				<m.div
					role="tabpanel"
					initial={contentEnter.initial}
					animate={contentEnter.animate}
					transition={contentEnter.transition}
					className="min-h-0 flex-1 overflow-auto"
				>
					{panel === "problems" ? (
						<ProblemsList
							problems={problems}
							filter={filter}
							onFilter={setFilter}
							onOpen={onOpenProblem}
						/>
					) : panel === "console" ? (
						<ConsoleList console={console} onClear={onClearConsole} />
					) : panel === "state" ? (
						<StateList
							storyState={storyState}
							persistentState={persistentState}
						/>
					) : (
						<RuntimeFacts
							entry={entry}
							fileCount={fileCount}
							enabled={enabled}
							modules={modules}
							compile={compile}
							entryExists={entryExists}
							execution={execution}
							onOpenEntry={onOpenEntry}
						/>
					)}
				</m.div>
			)}
		</section>
	);
}

/**
 * The State tab shows the two lifetimes as two sections. Values arrive as JSON already validated
 * twice, so this list never runs author code (no toString, toJSON or inspect). A trusted formatter
 * in runtime-preview-story-state.ts does the formatting. The two lifetimes are not merged: the same
 * key can exist in both, and merging would hide which one `Reset play` clears. useState is omitted
 * because it is session-only and would make three lifetimes look like one. The lifetime line above
 * the list states that this is studio memory, not product storage, so a refreshed user does not
 * read the loss as a bug.
 */
function StateList({
	storyState,
	persistentState,
}: {
	storyState: RuntimeStoryStateSnapshot;
	persistentState: RuntimePersistentStateSnapshot;
}) {
	const playthrough = storyStateRows(storyState);
	const persistent = storyStateRows(persistentState);
	if (playthrough.length === 0 && persistent.length === 0)
		return (
			<p className="px-3 py-6 text-center text-xs text-muted-foreground">
				{RUNTIME_PREVIEW.stateEmpty}
			</p>
		);
	return (
		<div className="flex flex-col">
			<p className="shrink-0 border-b px-3 py-1 text-[11px] text-muted-foreground">
				{RUNTIME_PREVIEW.stateScope}
			</p>
			<StateSection
				title={RUNTIME_PREVIEW.statePlaythrough}
				hint={RUNTIME_PREVIEW.statePlaythroughHint}
				rows={playthrough}
			/>
			<StateSection
				title={RUNTIME_PREVIEW.statePersistent}
				hint={RUNTIME_PREVIEW.statePersistentHint}
				rows={persistent}
			/>
		</div>
	);
}

/**
 * Renders each section even when empty. Hiding it would make 'no data yet' look the same as 'this
 * lifetime does not exist', and authors need to tell those apart.
 */
function StateSection({
	title,
	hint,
	rows,
}: {
	title: string;
	hint: string;
	rows: StoryStateRow[];
}) {
	return (
		<section className="flex flex-col border-b last:border-b-0">
			<header className="flex items-baseline gap-2 px-3 py-1.5">
				<h3 className="font-medium text-xs">{title}</h3>
				<p className="text-[11px] text-muted-foreground">{hint}</p>
			</header>
			{rows.length === 0 ? (
				<p className="px-3 pb-2 text-[11px] text-muted-foreground">—</p>
			) : (
				<ul className="flex flex-col border-t">
					{rows.map((row) => (
						<StateRow key={row.key} row={row} />
					))}
				</ul>
			)}
		</section>
	);
}

function StateRow({ row }: { row: StoryStateRow }) {
	return (
		<li className="border-b px-3 py-1.5 last:border-b-0">
			<p className="flex items-baseline gap-1.5 text-xs">
				<span className="font-mono font-medium">{row.key}</span>
				<span className="font-mono text-[11px] text-muted-foreground">
					{RUNTIME_PREVIEW.stateVersion(row.version)}
				</span>
			</p>
			{/*
			 * Values use `<pre>`: the formatter's line breaks and indentation are the only structure, and
			 * collapsing them would flatten nested state into one unreadable line. Wide values scroll
			 * horizontally inside their own box; the panel never scrolls sideways.
			 */}
			<pre className="mt-0.5 overflow-x-auto font-mono text-[11px] leading-snug text-muted-foreground">
				{row.text}
			</pre>
		</li>
	);
}

/**
 * Each diagnostic row puts the message on its own line, with severity and location below. A
 * three-column row had the message in the narrowest column, which was squeezed first. Severity is
 * written as text as well as color, since color alone makes errors and warnings look the same to
 * some users, and they need different fixes. Rows are not cards: a face and border per row would
 * fill the panel with five diagnostics. Rows animate presence: new rows rise 4px and leaving rows
 * fade (list-motion.ts). A leaving row is not clickable (useExitGuard, which needs a component,
 * hence the li). Rows do not use layout animation, since one compile can move thirty rows at once.
 */
function ProblemRow({
	problem,
	onOpen,
}: {
	problem: RuntimeProblem;
	onOpen: (problem: RuntimeProblem) => void;
}) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const error = problem.severity === "error";
	const exiting = useExitGuard();

	return (
		<m.li
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={exiting}
		>
			{/*
			 * Clicking a problem opens its file and goes to the line (navigate). A problem without a file
			 * cannot
			 * be clicked, since there is nothing to open. Rendering it disabled is better than a control that
			 * does nothing.
			 */}
			<button
				type="button"
				disabled={problem.path === ""}
				className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-start hover:bg-accent disabled:hover:bg-transparent"
				onClick={() => onOpen(problem)}
			>
				<span className="text-xs leading-snug break-words">
					{problem.message}
				</span>
				<span className="flex min-w-0 max-w-full items-baseline gap-1.5 text-[11px]">
					<span
						className={cn(
							"shrink-0 font-medium",
							error ? "text-destructive" : "text-muted-foreground",
						)}
					>
						{error ? t("bottomPanel.error") : t("bottomPanel.warning")}
					</span>
					<span
						aria-hidden="true"
						className="shrink-0 text-muted-foreground/60"
					>
						·
					</span>
					{/*
					 * The location shows only what is known (runtimeProblemLocation). Filling in 1:1 would look like a
					 * real position, and the reader would hunt for the cause on line 1.
					 * Paths have no break points, so they wrap between segments to avoid horizontal overflow in a
					 * narrow
					 * panel.
					 */}
					<span className="min-w-0 font-mono break-all text-muted-foreground">
						{runtimeProblemLocation(problem)}
					</span>
				</span>
			</button>
		</m.li>
	);
}

/**
 * The severity filter has three terms and no counts. Repeating the counts here would show the same
 * two values a third time (header, tab label, here), and repeated numbers stop being read. It uses
 * aria-pressed toggle buttons, not a radio group. A radio group implies arrow-key movement and
 * roving tabindex; implementing half of that is worse than toggles that each take Tab focus.
 */
function ProblemFilters({
	filter,
	onChange,
}: {
	filter: RuntimeProblemFilter;
	onChange: (filter: RuntimeProblemFilter) => void;
}) {
	return (
		/*
		 * The fieldset is used for its accessible name, not for form semantics. The group needs a name so
		 * the three toggles are not read only as `Error` and `Warning` without saying what they filter. A div
		 * with role=group would do the same, but the native element already carries that role.
		 */
		<fieldset
			aria-label={RUNTIME_STUDIO.problemsFilter}
			className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1"
		>
			{RUNTIME_PROBLEM_FILTERS.map((id) => {
				const active = filter === id;
				return (
					<button
						key={id}
						type="button"
						aria-pressed={active}
						className={cn(
							"relative rounded-md px-2 py-0.5 text-[11px] font-medium",
							active
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => onChange(id)}
					>
						{/*
						 * The active face moves between the three filter choices. Filtering itself is immediate: the list
						 * changes in the same render and the face follows. The current choice is conveyed first by
						 * aria-pressed and text color.
						 */}
						{active && (
							<MotionActiveIndicator
								group="runtime-problems-filter"
								className="absolute inset-0 rounded-md bg-accent"
							/>
						)}
						<span className="relative">{PROBLEM_FILTER_LABEL[id]}</span>
					</button>
				);
			})}
		</fieldset>
	);
}

/**
 * The label map is a Record, so adding a filter value breaks compilation here. Without that, a new
 * filter would render as a silent empty control, since chip labels and command icons share the same
 * shape.
 */
const PROBLEM_FILTER_LABEL: Record<RuntimeProblemFilter, string> = {
	all: RUNTIME_STUDIO.problemsFilterAll,
	errors: RUNTIME_STUDIO.problemsFilterErrors,
	warnings: RUNTIME_STUDIO.problemsFilterWarnings,
};

/**
 * The Problems list has two empty states.
 * - No problems at all: says why the list is empty, and no filter is drawn.
 * - Nothing left after filtering: says that other severities have problems, and the filter stays.
 *   Merging them would tell someone filtering to errors, with warnings present, that there are no
 *   problems, which is false. The filter is not drawn when there are no problems, since a control
 *   with nothing to choose wastes vertical space borrowed from the editor. List and empty state
 *   share one slot. When the last problem goes, the list leaves first and the empty state arrives
 *   after (mode='wait', opacity only). The filtered-empty sentence only enters, because when a
 *   filter is cleared the returning rows matter most, and exit would only delay them.
 */
function ProblemsList({
	problems,
	filter,
	onFilter,
	onOpen,
}: {
	problems: readonly RuntimeProblem[];
	filter: RuntimeProblemFilter;
	onFilter: (filter: RuntimeProblemFilter) => void;
	onOpen: (problem: RuntimeProblem) => void;
}) {
	const shown = filterRuntimeProblems(problems, filter);

	return (
		<AnimatePresence initial={false} mode="wait">
			{problems.length === 0 ? (
				<m.div
					key="empty"
					initial={contentEnter.initial}
					animate={contentEnter.animate}
					exit={contentExit}
					transition={contentEnter.transition}
					className="px-4 py-6"
				>
					<p className="text-sm font-medium">{RUNTIME_PROBLEMS_EMPTY.title}</p>
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{RUNTIME_PROBLEMS_EMPTY.body}
					</p>
				</m.div>
			) : (
				<m.div
					key="list"
					initial={contentEnter.initial}
					animate={contentEnter.animate}
					exit={contentExit}
					transition={contentEnter.transition}
					className="flex min-h-0 flex-col"
				>
					<ProblemFilters filter={filter} onChange={onFilter} />
					{/*
					 * The presence wrapper is here because the outer initial={false} freezes the whole subtree
					 * (docs/motion/ARCHITECTURE.md). Without this layer, the empty-state sentence and rows mounted
					 * later
					 * would lose their enter animation. Rows already present when the list opens still do not animate
					 * in.
					 */}
					<AnimatePresence initial={false}>
						{shown.length === 0 ? (
							<m.p
								key="filter-empty"
								initial={contentEnter.initial}
								animate={contentEnter.animate}
								transition={contentEnter.transition}
								className="px-4 py-6 text-xs text-muted-foreground"
							>
								{RUNTIME_STUDIO.problemsFilterEmpty}
							</m.p>
						) : (
							<ul key="rows" className="min-h-0 divide-y">
								<AnimatePresence initial={false}>
									{shown.map((problem) => (
										<ProblemRow
											key={problem.key}
											problem={problem}
											onOpen={onOpen}
										/>
									))}
								</AnimatePresence>
							</ul>
						)}
					</AnimatePresence>
				</m.div>
			)}
		</AnimatePresence>
	);
}

/**
 * The known-facts table is read-only, not a dashboard. Only `Entry` is clickable: it is the one
 * value that points to another place, and the route there already exists (quick open and
 * diagnostics). If every row were clickable, users would learn that clicks do nothing, and then
 * stop clicking `Entry` too.
 */
function RuntimeFacts({
	entry,
	fileCount,
	enabled,
	modules,
	compile,
	entryExists,
	execution,
	onOpenEntry,
}: {
	entry: string;
	fileCount: number;
	enabled: boolean;
	modules: readonly string[];
	compile: RuntimeCompileView;
	entryExists: boolean;
	execution: RuntimePreviewStatus;
	onOpenEntry: () => void;
}) {
	return (
		<dl className="grid gap-x-6 gap-y-2 px-4 py-4 text-xs sm:grid-cols-[auto_1fr]">
			{runtimeFacts({
				entry,
				fileCount,
				enabled,
				modules,
				compile,
				execution,
			}).map((fact) => (
				<div key={fact.id} className="contents">
					<dt className="text-muted-foreground">{fact.label}</dt>
					{/*
					 * The entry path appears in this table. It has no spaces, so it cannot wrap, and on a narrow screen
					 * that one line pushes the panel sideways.
					 */}
					{fact.id === "entry" && entryExists ? (
						<dd className="min-w-0">
							{/*
							 * The accessible name includes what the button does. aria-label is not used to replace the visible
							 * text (the path), because the spoken name and the visible text would then differ. This is the same
							 * pattern as the header check status.
							 */}
							<button
								type="button"
								className="rounded-sm text-start font-mono break-words underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								onClick={onOpenEntry}
							>
								{fact.value}
								<span className="sr-only">, {RUNTIME_STUDIO.openEntry}</span>
							</button>
						</dd>
					) : (
						<dd className="min-w-0 font-mono break-words">{fact.value}</dd>
					)}
				</div>
			))}
		</dl>
	);
}

/**
 * The Console shows worker lines verbatim. Severity is written as text too, as in Problems. Runtime
 * diagnostics are labeled apart from logs: runtime_duplicate_key comes from the runtime, not from
 * the author's output. If lines were dropped, the first line states how many. Silently dropping
 * them would make 'why is the first line missing' unanswerable. Lines have no motion. The list can
 * receive hundreds of lines per second, and per-line enter animation would turn it into moving
 * decoration.
 */
function ConsoleList({
	console,
	onClear,
}: {
	console: RuntimePreviewConsole;
	onClear: () => void;
}) {
	if (console.entries.length === 0 && console.dropped === 0)
		return (
			<div className="px-4 py-6">
				<p className="text-xs leading-relaxed text-muted-foreground">
					{RUNTIME_PREVIEW.consoleEmpty}
				</p>
			</div>
		);
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-[11px] text-muted-foreground">
				{console.dropped > 0 && (
					<span>{RUNTIME_PREVIEW.consoleDropped(console.dropped)}</span>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="ms-auto h-6 gap-1 px-2 text-[11px]"
					onClick={onClear}
				>
					<Trash2 className="size-3" aria-hidden="true" />
					{RUNTIME_PREVIEW.consoleClear}
				</Button>
			</div>
			<ol className="min-h-0 divide-y font-mono text-xs">
				{console.entries.map((entry) => (
					<ConsoleRow key={entry.id} entry={entry} />
				))}
			</ol>
		</div>
	);
}

const CONSOLE_KIND_LABEL: Record<RuntimePreviewConsoleEntry["kind"], string> = {
	log: "log",
	warn: "warn",
	error: "error",
	diagnostic: RUNTIME_PREVIEW.diagnosticLabel,
};

function ConsoleRow({ entry }: { entry: RuntimePreviewConsoleEntry }) {
	const tone =
		entry.kind === "error"
			? "text-destructive"
			: entry.kind === "warn" || entry.kind === "diagnostic"
				? "text-amber-700 dark:text-amber-400"
				: "text-muted-foreground";
	return (
		<li className="flex items-start gap-2 px-3 py-1">
			<span className={cn("shrink-0 font-medium", tone)}>
				{CONSOLE_KIND_LABEL[entry.kind]}
			</span>
			<span className="min-w-0 whitespace-pre-wrap break-words">
				{entry.code !== null && (
					<span className="text-muted-foreground">{entry.code} </span>
				)}
				{entry.component !== null && (
					<span className="text-muted-foreground">[{entry.component}] </span>
				)}
				{entry.text}
			</span>
		</li>
	);
}
