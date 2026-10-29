import type { RuntimeTreeNode } from "@rowcat/authoring";
import { Button } from "@rowcat/ui-web/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@rowcat/ui-web/components/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { cn } from "@rowcat/ui-web/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
	ChevronRight,
	ChevronsDownUp,
	Copy,
	FileCode,
	FileCode2,
	FileInput,
	FilePlus2,
	Folder,
	FolderOpen,
	FolderPlus,
	MoreHorizontal,
	Pencil,
	Trash2,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Fragment, type KeyboardEvent, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { standardTransition } from "#/lib/motion/transitions.ts";
import { RUNTIME_EXPLORER_EMPTY, RUNTIME_STUDIO } from "../runtime-copy.ts";
import type {
	RuntimeExplorerEdit,
	RuntimeExplorerSelection,
} from "../runtime-workspace-state.ts";
import {
	type RuntimeExplorerCommandId,
	type RuntimeExplorerCommands,
	type RuntimeExplorerMenuItem,
	type RuntimeExplorerTarget,
	runtimeExplorerMenu,
} from "./commands.ts";

/**
 * Project explorer: one tree and seven operations.
 * - It is not a general file browser. It shows the virtual project owned by one draft, and the
 *   path rules reject `..`, so there is no up button or address bar.
 * - Three entry points, one definition. Right click, the overflow menu and the keyboard all call
 *   the items from runtimeExplorerMenu. The overflow menu must stay: right click is not reachable
 *   with coarse pointers (long press is a bonus of the primitive, not a guarantee), and keyboard
 *   users need a way to open a menu.
 * - Names are typed inline, not in a dialog. An earlier version used one path dialog for new
 *   file, new folder and rename, so renaming meant editing a path and a typo moved the file
 *   elsewhere. The user now types one name, and the parent is fixed by where the operation starts.
 * - No `role="tree"`, and that absence is deliberate. The ARIA tree pattern requires a full
 *   keyboard contract (roving tabindex, arrow navigation, expand and collapse keys). Implementing
 *   half would give assistive technology users a tree that does not behave as expected, which is
 *   worse than a list. Each row also has an overflow menu as a sibling, since this repo does not
 *   nest buttons in links or buttons, and tree children may only be treeitem or group. The list is
 *   therefore honest: nesting is shown by indentation, and each row's accessible name is the full
 *   path.
 * - Selection scrolls into view. The tab menu's `Reveal in explorer` expands the ancestor folders and
 *   selects the file, and if the row is off screen nothing seems to happen. The list scrolls with
 *   `nearest` only when the selection changes to a file. The lookup uses the file id
 *   (`data-file-id`), because a visible name can match another file and a rename would break it.
 * - The keyboard listens only inside the list. F2 and Delete are not attached to `window`,
 *   because Delete pressed inside Monaco would delete a file, which cannot be undone.
 * - Motion explains state changes in three cases: rows entering and leaving use `rowEnter` and
 *   `rowExit`, the active-file indicator slides between rows, and folder toggles only rotate the
 *   arrow. Children do not animate on expand, because they mount with the list and
 *   `initial={false}` skips the first render. Heights are not interpolated and children are not
 *   staggered.
 * - Deletion: the store is authoritative and motion follows it. A deleted row leaves for 120ms
 *   after liveQuery removes it from the list, and it cannot be pressed meanwhile (useExitGuard).
 *   Motion never keeps a deleted file alive.
 */

export interface RuntimeExplorerProps {
	tree: RuntimeTreeNode[];
	/** The file the editor is showing now. It is a separate axis from the explorer's selection. */
	activeFileId: string | null;
	selection: RuntimeExplorerSelection;
	expanded: string[];
	/** The name being typed right now. Only one edit can be open at a time. */
	edit: RuntimeExplorerEdit;
	/**
	 * Why the value cannot be used. The pure rules decide this; the component only draws the message.
	 */
	editIssue: string | null;
	/**
	 * A short confirmation, such as a successful copy. Failures do not appear here; the toast handles
	 * them.
	 */
	announcement: string;
	commands: RuntimeExplorerCommands;
	onToggleFolder: (path: string) => void;
	onSelect: (selection: RuntimeExplorerSelection) => void;
	onEditValue: (value: string) => void;
	onSubmitEdit: () => void;
	onCancelEdit: () => void;
}

export function RuntimeExplorer(props: RuntimeExplorerProps) {
	const { commands, edit, selection } = props;
	const listRef = useRef<HTMLDivElement | null>(null);

	/**
	 * The signal is the selected file's id alone. If the effect reran on every tree change, another
	 * tab's edit arriving would scroll the list and lose the position the user was looking at.
	 */
	const selectedFileId = selection?.kind === "file" ? selection.fileId : null;
	useEffect(() => {
		if (selectedFileId === null) return;
		const escaped =
			typeof CSS !== "undefined" && typeof CSS.escape === "function"
				? CSS.escape(selectedFileId)
				: selectedFileId;
		listRef.current
			?.querySelector(`[data-file-id="${escaped}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [selectedFileId]);

	/**
	 * Keyboard operations on the selected row. Events from input fields pass through: inside an inline
	 * edit, Delete erases text and does not delete a file. Menus and dialogs are portals outside this
	 * container, so their events never reach this handler.
	 */
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (edit !== null) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable)
		)
			return;
		if (selection === null || selection.kind !== "file") return;
		const file = findFile(props.tree, selection.fileId);
		if (!file) return;
		if (event.key === "F2") {
			event.preventDefault();
			commands.startRenameFile(file.fileId, file.path);
			return;
		}
		if (event.key === "Delete") {
			event.preventDefault();
			commands.requestDeleteFile(file.fileId, file.path);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex items-center justify-between gap-1 border-b px-3 py-2">
				<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{RUNTIME_STUDIO.explorer}
				</h2>
				<div className="flex items-center gap-0.5">
					{/*
					 * Root has two creation operations. Creating inside a folder belongs to that folder's menu. Asking
					 * for a destination here would need an extra dialog that repeats what inline input does, since the
					 * creation point is the parent.
					 */}
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						aria-label={RUNTIME_STUDIO.newFile}
						title={RUNTIME_STUDIO.newFile}
						onClick={() => commands.startCreateFile("")}
					>
						<FilePlus2 className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						aria-label={RUNTIME_STUDIO.newFolder}
						title={RUNTIME_STUDIO.newFolder}
						onClick={() => commands.startCreateFolder("")}
					>
						<FolderPlus className="size-4" />
					</Button>
					{/*
					 * `Collapse all` operates on the whole list, so it lives in the root menu. It has no separate icon
					 * because this row is narrow (three cells), and the operation is not pressed as often as creating
					 * a file.
					 */}
					<RowMenu
						label={RUNTIME_STUDIO.explorer}
						items={runtimeExplorerMenu({ kind: "root" }, commands)}
						className="opacity-100"
					/>
				</div>
			</header>

			{/*
			 * The list and the empty space below it share one context menu. Without right click on empty
			 * space, a project with no files would have no way to reach that menu.
			 */}
			<ContextMenu>
				<ContextMenuTrigger
					/**
					 * A menu opened on empty space belongs to the root, so any previously selected target must be
					 * cleared.
					 */
					onContextMenu={(event) => {
						if (event.target === event.currentTarget) props.onSelect(null);
					}}
					render={
						/*
						 * This key handler does not make the box operable. The box has no tabIndex or role, and focus
						 * stays on the row buttons. The handler receives keys bubbling up from those buttons in one
						 * place, since a handler on each row would repeat this logic per row. Attaching it to
						 * `window` would let Delete inside Monaco delete a file.
						 */
						// biome-ignore lint/a11y/noStaticElementInteractions: this is a delegation layer, not an interactive element (see the comment above).
						<div
							ref={listRef}
							className="min-h-0 flex-1 overflow-auto py-1"
							onKeyDown={onKeyDown}
						/>
					}
				>
					{props.tree.length === 0 && edit === null ? (
						<EmptyExplorer commands={commands} />
					) : (
						<ul aria-label={RUNTIME_STUDIO.explorer}>
							{/*
							 * `initial={false}` means rows present when the list opens do not animate in. Only rows added
							 * afterward animate in: a file just created, or one brought in by sync. `mode='popLayout'` is
							 * not used; no list in this repository uses it (see 'when touching lists' in
							 * `docs/motion/ARCHITECTURE.md`). Removal and fill are sequential: opacity finishes first, then
							 * the remaining rows take the space (movement is not interpolated).
							 */}
							<AnimatePresence initial={false}>
								{/* When creating at the root, the input is the list's first row. */}
								{edit !== null &&
									edit.kind !== "rename-file" &&
									edit.parent === "" && (
										<li key="edit">
											<EditRow
												level={1}
												edit={edit}
												issue={props.editIssue}
												onChange={props.onEditValue}
												onSubmit={props.onSubmitEdit}
												onCancel={props.onCancelEdit}
											/>
										</li>
									)}
								{props.tree.map((node) => (
									<TreeRow
										key={nodeKey(node)}
										node={node}
										level={1}
										{...props}
									/>
								))}
							</AnimatePresence>
						</ul>
					)}
				</ContextMenuTrigger>
				<ContextMenuContent className={MENU_WIDTH}>
					<MenuItems items={runtimeExplorerMenu({ kind: "root" }, commands)} />
				</ContextMenuContent>
			</ContextMenu>

			{/*
			 * A short confirmation. It is an `<output>` element, so it carries `status` weight rather than
			 * failure weight, and it takes no space when there is no sentence.
			 */}
			<output className="px-3 text-xs text-muted-foreground empty:hidden">
				{props.announcement}
			</output>
		</div>
	);
}

/**
 * Empty explorer: the things you can do appear together with it.
 *
 * No large onboarding card. This column is about 240px wide, with no room for an illustration and
 * paragraphs. This screen also appears not only the first time, but after every file has been
 * deleted.
 */
function EmptyExplorer({ commands }: { commands: RuntimeExplorerCommands }) {
	return (
		<div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
			<p className="text-xs text-muted-foreground">
				{RUNTIME_EXPLORER_EMPTY.title}
			</p>
			<div className="flex flex-wrap items-center justify-center gap-1">
				<Button
					variant="outline"
					size="sm"
					onClick={() => commands.startCreateFile("")}
				>
					<FilePlus2 className="size-3.5" />
					{RUNTIME_STUDIO.newFile}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => commands.startCreateFolder("")}
				>
					<FolderPlus className="size-3.5" />
					{RUNTIME_STUDIO.newFolder}
				</Button>
			</div>
		</div>
	);
}

/**
 * The key for a row: files are keyed by id, folders by path.
 *
 * Files are not keyed by path because renaming is a path change. Keyed by path, presence would read
 * a rename as delete plus create, and the same file would vanish and reappear. Folders have no
 * record, so the path is their only identity; a folder and a file can never share a path.
 */
const nodeKey = (node: RuntimeTreeNode): string =>
	node.kind === "file" ? `file:${node.fileId}` : `folder:${node.path}`;

/** Walks the tree to find one file. Needed because keyboard handling holds only the selected id. */
function findFile(
	nodes: readonly RuntimeTreeNode[],
	fileId: string,
): { fileId: string; path: string } | null {
	for (const node of nodes) {
		if (node.kind === "file") {
			if (node.fileId === fileId) return { fileId, path: node.path };
			continue;
		}
		const found = findFile(node.children, fileId);
		if (found) return found;
	}
	return null;
}

/**
 * Indentation is an inline style, because depth is a value and cannot be expressed as a utility
 * class.
 */
const indentOf = (level: number) => ({ paddingInlineStart: `${level * 12}px` });

/**
 * The row surface: one rounded pill.
 *
 * This highlight once ran edge to edge, and that shape reads as a table, not a list. With no
 * boundary between rows, the surface does not say where one item ends. Stepping in from the sides
 * and rounding the corners gives the highlighted row its own boundary. This is also why the
 * editor's explorer uses the same shape.
 *
 * The surface belongs to the outer box. On the inner button, the overflow trigger at the right end
 * would fall outside the highlight, and the row would look half-highlighted as soon as the pointer
 * moved over it.
 */
const ROW_SURFACE =
	"relative mx-1 flex items-center gap-1 rounded-md pe-1 transition-colors";

/**
 * The file the editor is currently showing. It is an edge rule, not a surface, because selection
 * and activity can diverge: right-click selects without opening, so the two often sit on different
 * rows.
 *
 * Both once filled the row, and the only difference between the two fills was brightness, which
 * disappears with the theme. The emphasis was even reversed, with the just-pressed row faint and
 * the open file strong.
 *
 * Selected keeps the surface (immediate, strongest). Active is an edge rule plus a bold name that
 * moves between rows through a shared `MotionActiveIndicator`. Its horizontal position does not
 * depend on depth, so it moves vertically only. It is absolutely positioned and `aria-hidden`, so
 * row height does not change.
 */
const ACTIVE_RAIL_CLASS =
	"absolute inset-y-1 start-0 w-0.5 rounded-full bg-primary";

/**
 * The file icon is derived from the extension and is not stored in the record. The editor picks its
 * grammar from the same value (see the header of `runtime.ts`). Another basis here would diverge
 * after a rename: the list would show a TSX icon while the editor opens the file as TS.
 */
const fileIcon = (path: string): LucideIcon =>
	path.endsWith(".tsx") ? FileCode2 : FileCode;

/**
 * The glyph is decorative and has no name. The row's accessible name is already the full path,
 * which includes the extension. Naming the glyph would make screen readers announce 'TSX file'
 * before reading `src/main.tsx`.
 */
function FileGlyph({ path, className }: { path: string; className?: string }) {
	const Icon = fileIcon(path);
	return <Icon aria-hidden="true" className={className} />;
}

/**
 * The menu width is set explicitly because the anchor is a 24px icon button. `DropdownMenuContent`
 * defaults to `w-(--anchor-width) min-w-32`. The anchor here is the row's overflow trigger
 * (`size-6`), so the width locks at 128px. After subtracting the icon, gaps, side padding, and
 * shortcut column, about 50px remains for the label, and `Rename` broke across two lines. Korean line
 * breaking can split mid-word, so narrowing breaks words directly.
 *
 * The context menu uses the same value. Its anchor is a single point, but if the two containers'
 * widths differed, the same item would draw at different sizes in right-click and overflow menus,
 * and review would not catch it.
 */
const MENU_WIDTH = "min-w-44";

/**
 * Maps each command to its icon. The table lives here, not in the vocabulary
 * (`runtime-explorer-commands.ts`): iconography is markup's job, and that module must know neither
 * container (the chat row menu has the same shape).
 *
 * Because this is a `Record`, adding a command breaks compilation here, so an item without an icon
 * cannot slip in silently.
 */
const COMMAND_ICON: Record<RuntimeExplorerCommandId, LucideIcon> = {
	open: FileInput,
	"new-file": FilePlus2,
	"new-folder": FolderPlus,
	rename: Pencil,
	"copy-path": Copy,
	delete: Trash2,
	"collapse-all": ChevronsDownUp,
};

function TreeRow({
	node,
	level,
	...props
}: RuntimeExplorerProps & { node: RuntimeTreeNode; level: number }) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const { commands, edit } = props;
	/**
	 * Presses are blocked while exiting, via presence state (`exit-guard.ts`). Attaching it to the
	 * animation target would never apply in a tab that does not deliver frames, which is exactly when
	 * a removed row stays longest. The hook needs a component, so this row is a component rather than
	 * being expanded inline inside `map`.
	 */
	const exiting = useExitGuard();

	if (node.kind === "folder") {
		const open = props.expanded.includes(node.path);
		const selected =
			props.selection?.kind === "folder" && props.selection.path === node.path;
		const target: RuntimeExplorerTarget = { kind: "folder", path: node.path };
		const items = runtimeExplorerMenu(target, commands);

		return (
			<m.li
				initial={rowEnter.initial}
				animate={rowEnter.animate}
				exit={rowExit}
				transition={rowEnter.transition}
				style={exiting}
			>
				<ContextMenu>
					<ContextMenuTrigger
						render={
							<div
								className={cn(
									"group",
									ROW_SURFACE,
									"hover:bg-accent/70",
									/**
									 * Selection takes the surface, using the same rule as file rows (see the header of
									 * `ACTIVE_RAIL_CLASS`).
									 */
									selected && "bg-accent",
								)}
							/>
						}
						/**
						 * Right-click selects rather than opens. The menu opens with the folder selected, so the
						 * screen shows where `New file` will be created.
						 */
						onContextMenu={() =>
							props.onSelect({ kind: "folder", path: node.path })
						}
					>
						<button
							type="button"
							style={indentOf(level)}
							/**
							 * The accessible name is the path, not the visible label. Indentation conveys hierarchy only
							 * visually.
							 */
							aria-label={node.path}
							aria-expanded={open}
							className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 text-start text-sm"
							onClick={() => {
								props.onSelect({ kind: "folder", path: node.path });
								props.onToggleFolder(node.path);
							}}
						>
							{/*
							 * The chevron and the folder glyph say different things: the chevron is open/closed state, the
							 * glyph says this is a folder. Merging them would make a collapsed folder indistinguishable from
							 * a file in the same column.
							 *
							 * The chevron is one element and rotates. Expanding is frequent, so the 90-degree turn is the
							 * only motion that signals a state change; children do not move. There is no `initial`, so it
							 * does not rotate on mount, since an expanded folder that spins open on first render would look
							 * like something the user did. It rotates with `standard` only when the value changes. Under
							 * reduced motion it is placed at its position; `aria-expanded` conveys the state.
							 */}
							<m.span
								aria-hidden="true"
								className="inline-flex shrink-0 text-muted-foreground"
								animate={{ rotate: open ? 90 : 0 }}
								transition={standardTransition}
							>
								<ChevronRight className="size-3.5" />
							</m.span>
							{open ? (
								<FolderOpen
									aria-hidden="true"
									className="size-3.5 shrink-0 text-muted-foreground"
								/>
							) : (
								<Folder
									aria-hidden="true"
									className="size-3.5 shrink-0 text-muted-foreground"
								/>
							)}
							{/*
							 * The pointer's way to read a truncated name. Screen reader users already hear the full path
							 * from the row's accessible name.
							 */}
							<span className="truncate ps-0.5 font-medium" title={node.path}>
								{node.name}
							</span>
						</button>
						<RowMenu
							label={t("explorer.folder", { name: node.name })}
							items={items}
						/>
					</ContextMenuTrigger>
					<ContextMenuContent className={MENU_WIDTH}>
						<MenuItems items={items} />
					</ContextMenuContent>
				</ContextMenu>

				{/*
				 * Children of a collapsed folder are not rendered, rather than hidden. CSS hiding would leave
				 * those rows in the accessibility tree and the Tab order, so keyboard users would keep passing
				 * through rows inside a collapsed folder.
				 */}
				{open && (
					<ul>
						{/*
						 * This list's presence mounts together with the list, so rows present on expansion do not
						 * animate in; only rows added later enter (see the header above). The create input is a child of
						 * presence but does not move (the `li` stays as is). That slot is the action the user just
						 * started, so the hand should land on it immediately, with no reason to make it wait for an
						 * entrance.
						 */}
						<AnimatePresence initial={false}>
							{edit !== null &&
								edit.kind !== "rename-file" &&
								edit.parent === node.path && (
									<li key="edit">
										<EditRow
											level={level + 1}
											edit={edit}
											issue={props.editIssue}
											onChange={props.onEditValue}
											onSubmit={props.onSubmitEdit}
											onCancel={props.onCancelEdit}
										/>
									</li>
								)}
							{node.children.map((child) => (
								<TreeRow
									key={nodeKey(child)}
									node={child}
									level={level + 1}
									{...props}
								/>
							))}
						</AnimatePresence>
					</ul>
				)}
			</m.li>
		);
	}

	/**
	 * A file being renamed shows an input in place of its row; the two are never shown together. The
	 * swap happens inside the same `m.li`. A sibling input would make presence read it as delete plus
	 * create: the old row would fade out beside the new input, and the list would grow and shrink by a
	 * row. The row should change only its own content, and that is what happens.
	 */
	const renaming =
		edit !== null && edit.kind === "rename-file" && edit.fileId === node.fileId;

	const active = props.activeFileId === node.fileId;
	const selected =
		props.selection?.kind === "file" && props.selection.fileId === node.fileId;
	const target: RuntimeExplorerTarget = {
		kind: "file",
		fileId: node.fileId,
		path: node.path,
	};
	const items = runtimeExplorerMenu(target, commands);

	return (
		<m.li
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={exiting}
		>
			{renaming && edit !== null ? (
				<EditRow
					level={level}
					edit={edit}
					issue={props.editIssue}
					onChange={props.onEditValue}
					onSubmit={props.onSubmitEdit}
					onCancel={props.onCancelEdit}
				/>
			) : (
				<ContextMenu>
					<ContextMenuTrigger
						render={
							<div
								className={cn(
									"group",
									ROW_SURFACE,
									"hover:bg-accent/70",
									/**
									 * Each axis gets a different mark: selection is a surface, active is an edge rule (see the
									 * header of `ACTIVE_RAIL_CLASS`). If both filled the surface, the only cue for which is
									 * which would be brightness, which the theme can erase. The selection surface changes
									 * immediately: the answer to what was just pressed must not lag.
									 */
									selected && "bg-accent",
								)}
							/>
						}
						onContextMenu={() =>
							props.onSelect({ kind: "file", fileId: node.fileId })
						}
					>
						{/*
						 * The active mark: a single rule that moves between rows (see the header of `ACTIVE_RAIL_CLASS`).
						 * Its name space is distinct from other surfaces (`runtime-explorer-active`).
						 */}
						{active && (
							<MotionActiveIndicator
								group="runtime-explorer-active"
								className={ACTIVE_RAIL_CLASS}
							/>
						)}
						<button
							type="button"
							style={indentOf(level)}
							/**
							 * The key used to find this row again. `Reveal in explorer` looks it up by this value. Searching by
							 * visible name would match an arbitrary one of two same-named files.
							 */
							data-file-id={node.fileId}
							/**
							 * The accessible name is the full path. Only the file name is visible, and indentation
							 * conveys hierarchy only to sighted users. Without the path, `src/main.tsx` and
							 * `lib/main.tsx` would read as the same row.
							 */
							aria-label={node.path}
							/**
							 * Is this the file open now? It is list selection state, so `aria-current` is the right
							 * attribute.
							 */
							aria-current={active ? "true" : undefined}
							className={cn(
								"flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 text-start text-sm",
								active && "font-medium",
							)}
							onClick={() => commands.open(node.fileId)}
						>
							{/* Pushes by the arrow slot's width so the file glyph starts in the same column as folder glyphs. */}
							<span className="w-3.5 shrink-0" />
							<FileGlyph
								path={node.path}
								className={cn(
									"size-3.5 shrink-0",
									active ? "text-foreground" : "text-muted-foreground",
								)}
							/>
							<span
								className="truncate ps-0.5 font-mono text-[13px]"
								title={node.path}
							>
								{node.name}
							</span>
						</button>
						<RowMenu label={node.path} items={items} />
					</ContextMenuTrigger>
					<ContextMenuContent className={MENU_WIDTH}>
						<MenuItems items={items} />
					</ContextMenuContent>
				</ContextMenu>
			)}
		</m.li>
	);
}

/**
 * The contents of a row that takes a name. The `li` is supplied by the caller.
 *
 * Blur means cancel. Silently creating on blur would hand someone who clicked elsewhere a file they
 * did not intend to create, named with half-typed text. `Enter` is the only path that creates.
 *
 * Rename has no `li` of its own: the rename input must sit in the same row as the file it renames,
 * so presence does not read it as a new row (`TreeRow`). The create input has its own `li` but does
 * not move. This slot has no entrance, since it is the action the user just started; the hand
 * should land on it directly, with neither width nor position interpolated.
 */
function EditRow({
	level,
	edit,
	issue,
	onChange,
	onSubmit,
	onCancel,
}: {
	level: number;
	edit: NonNullable<RuntimeExplorerEdit>;
	issue: string | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const errorId = useId();
	const label =
		edit.kind === "create-folder"
			? RUNTIME_STUDIO.newFolder
			: edit.kind === "create-file"
				? RUNTIME_STUDIO.newFile
				: RUNTIME_STUDIO.rename;

	return (
		<div
			style={indentOf(level)}
			className="mx-1 flex flex-col gap-0.5 py-0.5 pe-1"
		>
			<div className="flex min-w-0 items-center gap-1">
				{/* The icon says what is being created first, because there is no name yet. */}
				<span className="w-3.5 shrink-0" />
				{edit.kind === "create-folder" ? (
					<FolderOpen
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground"
					/>
				) : edit.kind === "create-file" ? (
					<FileCode2
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground"
					/>
				) : (
					<FileGlyph
						path={edit.value}
						className="size-3.5 shrink-0 text-muted-foreground"
					/>
				)}
				{/*
				 * The label is not a visible row. In a 240px column, a visible label would take as much space as
				 * the input. The input's accessible name says what it creates instead.
				 */}
				<input
					// biome-ignore lint/a11y/noAutofocus: This input is the action the user just started. Without focus, the user would have to click into the field they opened to create something a second time.
					autoFocus
					aria-label={label}
					value={edit.value}
					spellCheck={false}
					autoComplete="off"
					aria-invalid={issue !== null}
					aria-describedby={issue !== null ? errorId : undefined}
					className={cn(
						"min-w-0 flex-1 rounded-sm border bg-background px-1.5 py-0.5 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
						issue !== null && "border-destructive",
					)}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onCancel}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							onSubmit();
							return;
						}
						if (event.key === "Escape") {
							event.preventDefault();
							onCancel();
						}
					}}
				/>
			</div>
			{/*
			 * The failure lives next to the input. This field stays after a failure, so there is no reason
			 * to send it to a toast. `role='alert'` is not used: the message changes with every keystroke,
			 * and in that noise even the last failure would go unread.
			 */}
			{issue !== null && (
				<p id={errorId} className="ps-8 text-xs break-words text-destructive">
					{issue}
				</p>
			)}
		</div>
	);
}

/**
 * The row's overflow menu, the path for people who cannot right-click.
 *
 * It is not placed inside the link. The trigger is a sibling of the row button, and layout alone
 * makes the pair look like one row (the chat list uses the same shape for the same reason). On
 * coarse pointers it is always visible: if it appeared only on hover, touch devices could never
 * reach these actions.
 *
 * Its items are the same list as the context menu. Base UI's `ContextMenu` re-exports `Menu`'s
 * parts (`ContextMenu.Item === Menu.Item`), so `DropdownMenuItem` has the same role and keyboard
 * behavior in both containers.
 */
function RowMenu({
	label,
	items,
	className,
}: {
	label: string;
	items: RuntimeExplorerMenuItem[];
	className?: string;
}) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							"size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 data-[popup-open]:opacity-100",
							className,
						)}
						aria-label={t("explorer.menu", { label })}
					>
						<MoreHorizontal className="size-3.5" />
					</Button>
				}
			/>
			<DropdownMenuContent align="end" className={MENU_WIDTH}>
				<MenuItems items={items} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function MenuGlyph({ id }: { id: RuntimeExplorerCommandId }) {
	const Icon = COMMAND_ICON[id];
	return <Icon aria-hidden="true" />;
}

/** The items shared by both containers. The caller picks the container. */
function MenuItems({ items }: { items: RuntimeExplorerMenuItem[] }) {
	return (
		<>
			{items.map((item) => (
				<Fragment key={item.id}>
					{item.separatorBefore && <DropdownMenuSeparator />}
					<DropdownMenuItem
						variant={item.destructive ? "destructive" : "default"}
						onClick={item.run}
					>
						<MenuGlyph id={item.id} />
						{/*
						 * Menu labels do not wrap. Every word in this list is short, and a two-line label would change
						 * the item's height, so the target the pointer aims at would differ from row to row. The width is
						 * already secured by `MENU_WIDTH` above.
						 */}
						<span className="whitespace-nowrap">{item.label}</span>
						{item.shortcut && (
							<span className="ms-auto ps-4 text-xs text-muted-foreground">
								{item.shortcut}
							</span>
						)}
					</DropdownMenuItem>
				</Fragment>
			))}
		</>
	);
}
