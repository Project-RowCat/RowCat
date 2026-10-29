import { RUNTIME_PREVIEW } from "#/features/runtime-preview/runtime-preview-copy.ts";
import type { RuntimePreviewControls } from "#/features/runtime-preview/runtime-preview-state.ts";
import { RUNTIME_PANEL_LABEL, type RuntimePanelTab } from "../layout/panels.ts";
import { RUNTIME_STUDIO } from "../runtime-copy.ts";
import { runtimeShortcutLabel } from "./use-shortcuts.ts";

/**
 * Decides the command palette's contents without rendering. It answers which operations exist and,
 * for each, whether it can run now and, if not, why.
 * - Files never appear here. The palette's first row opens quick-open, which has its own list and
 *   ranking. Mixing them would make the order differ by kind.
 * - No run function lives here. The caller's handler table is typed as Record<RuntimeCommandId,
 *   () => void>, so a command added without a handler fails to compile.
 * - An operation with no meaning right now is hidden. A blocked operation stays listed, disabled,
 *   with its reason.
 */

export const RUNTIME_COMMAND_IDS = [
	"quick-open",
	"preview-run",
	"preview-restart",
	"preview-stop",
	"preview-reset-playthrough",
	"preview-reset-persistent",
	"panel-problems",
	"panel-console",
	"panel-state",
	"panel-runtime",
	"panel-close",
	"toggle-explorer",
	"toggle-preview",
	"reset-layout",
	"new-file",
	"new-folder",
	"open-entry",
] as const;

export type RuntimeCommandId = (typeof RUNTIME_COMMAND_IDS)[number];

export interface RuntimeCommand {
	id: RuntimeCommandId;
	label: string;
	/**
	 * Label for the shortcut on this platform, shown in menu hints. Null when there is no shortcut;
	 * never invent one.
	 */
	shortcut: string | null;
	/** Why the command cannot run right now, in one line. Null when it can run. */
	disabledReason: string | null;
}

export interface RuntimeCommandContext {
	/**
	 * The preview operations the current preview state allows. Copied directly from
	 * `runtimePreviewControls`.
	 */
	preview: RuntimePreviewControls;
	/**
	 * Whether the preview can run without a blocking error. When false, run and restart remain visible
	 * but disabled.
	 */
	previewEligible: boolean;
	explorerVisible: boolean;
	previewVisible: boolean;
	panel: RuntimePanelTab | null;
	/** Whether the entry file exists. If not, the open-entry command is left out of the list. */
	entryExists: boolean;
}

/**
 * Maps each panel tab to its open command id. Adding a tab kind breaks compilation here until it is
 * mapped.
 */
const PANEL_COMMAND: Record<RuntimePanelTab, RuntimeCommandId> = {
	problems: "panel-problems",
	console: "panel-console",
	state: "panel-state",
	runtime: "panel-runtime",
};

/**
 * The palette list in display order. The order is meaningful. Find, run, panel, layout, create. It
 * is not alphabetical: an empty query shows this order, so the most frequent actions (finding
 * files, re-running the preview) come first.
 */
export function runtimeCommands(
	context: RuntimeCommandContext,
): RuntimeCommand[] {
	const commands: RuntimeCommand[] = [
		{
			id: "quick-open",
			label: RUNTIME_STUDIO.quickOpen,
			shortcut: runtimeShortcutLabel("p"),
			disabledReason: null,
		},
	];

	/**
	 * Run and restart are mutually exclusive. The preview header reads the same table
	 * (`runtimePreviewControls`), so the palette must not show both. Showing both would contradict the
	 * screen, and one of them would do nothing when pressed.
	 */
	const notEligible = context.previewEligible
		? null
		: RUNTIME_PREVIEW.notEligible;
	if (context.preview.run)
		commands.push({
			id: "preview-run",
			label: RUNTIME_PREVIEW.run,
			shortcut: runtimeShortcutLabel("Enter"),
			disabledReason: notEligible,
		});
	if (context.preview.restart)
		commands.push({
			id: "preview-restart",
			label: RUNTIME_PREVIEW.restart,
			shortcut: runtimeShortcutLabel("Enter"),
			disabledReason: notEligible,
		});
	if (context.preview.stop)
		commands.push({
			id: "preview-stop",
			label: RUNTIME_PREVIEW.stop,
			shortcut: null,
			disabledReason: null,
		});
	/**
	 * Both reset entries are always listed. Resetting a stopped preview means the next run starts from
	 * scratch, which is always possible. Like the preview header, this ignores eligibility, since
	 * clearing saved state needs no compile.
	 */
	commands.push(
		{
			id: "preview-reset-playthrough",
			label: RUNTIME_PREVIEW.resetPlaythrough,
			shortcut: null,
			disabledReason: null,
		},
		{
			id: "preview-reset-persistent",
			label: RUNTIME_PREVIEW.resetPersistent,
			shortcut: null,
			disabledReason: null,
		},
	);

	/** Panel tabs that are already open are not listed, because opening them would change nothing. */
	for (const tab of ["problems", "console", "state", "runtime"] as const)
		if (context.panel !== tab)
			commands.push({
				id: PANEL_COMMAND[tab],
				label: `${RUNTIME_PANEL_LABEL[tab]} ${RUNTIME_STUDIO.open}`,
				shortcut: null,
				disabledReason: null,
			});
	if (context.panel !== null)
		commands.push({
			id: "panel-close",
			label: RUNTIME_STUDIO.closePanel,
			shortcut: null,
			disabledReason: null,
		});

	commands.push(
		{
			id: "toggle-explorer",
			label: context.explorerVisible
				? RUNTIME_STUDIO.hideExplorer
				: RUNTIME_STUDIO.showExplorer,
			shortcut: runtimeShortcutLabel("b"),
			disabledReason: null,
		},
		{
			id: "toggle-preview",
			label: context.previewVisible
				? RUNTIME_STUDIO.hidePreview
				: RUNTIME_STUDIO.showPreview,
			shortcut: null,
			disabledReason: null,
		},
		{
			id: "reset-layout",
			label: RUNTIME_STUDIO.resetLayout,
			shortcut: null,
			disabledReason: null,
		},
		{
			id: "new-file",
			label: RUNTIME_STUDIO.newFile,
			shortcut: null,
			disabledReason: null,
		},
		{
			id: "new-folder",
			label: RUNTIME_STUDIO.newFolder,
			shortcut: null,
			disabledReason: null,
		},
	);

	/**
	 * No open-entry command when the entry file is missing; pressing it would do nothing. The Runtime
	 * panel makes the same call (`entryExists`).
	 */
	if (context.entryExists)
		commands.push({
			id: "open-entry",
			label: RUNTIME_STUDIO.openEntry,
			shortcut: null,
			disabledReason: null,
		});

	return commands;
}

/**
 * Ranks commands by the query in two tiers only: the name starts with the query, then the name
 * contains it. The file search's five-stage ranking is not reused, since commands have no paths and
 * the list is small. Ties keep the original list order rather than sorting by name length, because
 * that order already encodes how often each action is used. The sort is stable. An empty query
 * returns every command.
 */
export function searchRuntimeCommands(
	commands: readonly RuntimeCommand[],
	query: string,
): RuntimeCommand[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...commands];
	return commands
		.map((command, index) => ({
			command,
			index,
			rank: rankOf(command.label.toLowerCase(), needle),
		}))
		.filter((entry) => entry.rank !== 2)
		.sort((left, right) =>
			left.rank !== right.rank
				? left.rank - right.rank
				: left.index - right.index,
		)
		.map((entry) => entry.command);
}

const rankOf = (label: string, needle: string): 0 | 1 | 2 =>
	label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : 2;
