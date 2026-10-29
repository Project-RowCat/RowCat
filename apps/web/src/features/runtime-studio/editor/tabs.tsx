import type { DraftRuntimeFile } from "@rowcat/authoring";
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
	Copy,
	FolderTree,
	ListX,
	MoreHorizontal,
	SquareX,
	X,
} from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import {
	isRuntimeTabCloseClick,
	type RuntimeTabCommandId,
	type RuntimeTabCommands,
	type RuntimeTabMenuItem,
	runtimeTabMenu,
} from "../commands/tab-commands.ts";
import { runtimeEditorTabLabels } from "../commands/tab-labels.ts";
import { RUNTIME_STUDIO } from "../runtime-copy.ts";

/**
 * Tab row for open files. It does not imitate a browser tab strip: no drag reordering and no
 * pinning. It answers two questions only: what is open, and what is being viewed.
 *
 * - Middle-click closes a tab. This is the one exception. It adds no state, no pointer capture,
 *   and no keyboard counterpart, because closing already has three paths (close button, menu,
 *   right-click). Drag reordering would need all four.
 * - Labels may not be the file name. Ambiguous names get just enough path prefix to tell them
 *   apart (runtime-tab-labels.ts). This is a pure function because the rule depends on the whole
 *   open list; one tab cannot choose its own label.
 * - The close button is a sibling of the tab button, not a child. Nesting interactive elements is
 *   invalid markup: the browser rewrites the tree (hydration mismatch), and keyboard and screen
 *   reader behavior differs. The context menu trigger wraps both, so the whole row takes
 *   right-clicks.
 * - There is one overflow menu at the end of the row, acting on the active tab. Per-tab menus
 *   would double the row width. Users who cannot right-click still reach these actions there.
 * - The Tabs primitive is not used. It owns the panels it points to (aria-controls), but these
 *   tabs point to the Monaco editor below, whose DOM Monaco owns. Using the primitive would need
 *   one panel per tab. Tablist semantics are added by hand.
 * - The active marker is one element that moves between siblings, like the primitive's
 *   Tabs.Indicator (MotionActiveIndicator). A per-tab underline would read as one turning off and
 *   another on, when the selection actually moved. Only the underline animates. The editor does not
 *   wait for it: the reducer sets the active file in the same render, and Monaco swaps the model in
 *   that commit (runtime-code-editor.tsx). Background, font weight and aria-selected also change in
 *   that render, so the active tab stays readable even if the animation drops frames or is skipped.
 */
export function RuntimeEditorTabs({
	files,
	openIds,
	activeId,
	onSelect,
	commands,
}: {
	files: DraftRuntimeFile[];
	openIds: string[];
	activeId: string | null;
	onSelect: (fileId: string) => void;
	commands: RuntimeTabCommands;
}) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const byId = new Map(files.map((file) => [file.id, file]));
	/**
	 * Ids missing from the list are not rendered. The normal path has the reducer's sync removing
	 * them, but there can be one frame before that cleanup lands. A nameless tab drawn then would make
	 * the user read their file as having lost its name.
	 */
	const open = openIds
		.map((id) => byId.get(id))
		.filter((file): file is DraftRuntimeFile => file !== undefined);

	/**
	 * Labels are recounted on every render and are not memoized. The count is the number of open tabs
	 * (usually single digits), and the work is a few string slices. Memoizing would need a key built
	 * from the list on every render, which costs about as much as the computation.
	 */
	const labels = runtimeEditorTabLabels(open.map((file) => file.path));

	/**
	 * Brings the active tab into view. The row scrolls horizontally, so the active tab can be off
	 * screen, which is common when a file opens from diagnostics without any user scroll (new tabs
	 * append at the end). 'nearest' is intentional: a tab already visible does not move, so a manual
	 * scroll position is kept.
	 *
	 * The effect depends only on the identity of the active tab. Running on every list change would
	 * move the scroll when a neighboring tab closes. Smooth scrolling is not used either: this is
	 * alignment, not animation, so it does not consult the reduced-motion preference.
	 */
	const tabsRef = useRef(new Map<string, HTMLElement>());
	useEffect(() => {
		if (activeId === null) return;
		tabsRef.current
			.get(activeId)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeId]);

	if (open.length === 0) return null;

	const active = open.find((file) => file.id === activeId) ?? null;

	return (
		<div className="flex min-h-9 shrink-0 items-stretch border-b">
			<div
				role="tablist"
				aria-label={t("tabs.openFiles")}
				className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
			>
				{open.map((file, index) => {
					const selected = file.id === activeId;
					const items = runtimeTabMenu(
						{ fileId: file.id, path: file.path },
						open.length,
						commands,
					);
					return (
						<ContextMenu key={file.id}>
							<ContextMenuTrigger
								render={
									/*
									 * The middle-click target is the whole tab box. If only the label button had the handler,
									 * the space around the label and the close button would not respond, and users could not
									 * learn which part of the tab is the target.
									 *
									 * The box does not need focus, because closing already has three paths (close button,
									 * context menu, overflow menu) and those are the keyboard paths. This handler is a pointer
									 * convention only.
									 */
									// biome-ignore lint/a11y/noStaticElementInteractions: keyboard closing has its own three paths; this handler is a pointer convention.
									<div
										ref={(node) => {
											if (node) tabsRef.current.set(file.id, node);
											else tabsRef.current.delete(file.id);
										}}
										className={cn(
											"group relative flex shrink-0 items-center gap-1 border-e ps-3 pe-1",
											selected ? "bg-background" : "bg-muted/40",
										)}
										/*
										 * Closes the tab on middle-click. It uses auxclick, not click: a non-primary press does
										 * not fire click, so listening there would leave this action nonexistent. It is attached
										 * to the box on purpose, so pressing anywhere on the tab (label, close button, or gap)
										 * closes it.
										 *
										 * The right button also fires this event, so the button number is checked. Without the
										 * check, a user opening the context menu would lose the tab.
										 */
										onAuxClick={(event) => {
											if (!isRuntimeTabCloseClick(event.button)) return;
											event.preventDefault();
											commands.close(file.id);
										}}
										/*
										 * The middle button's default action is autoscroll, which starts on press. If it is not
										 * prevented, the tab closes while the cursor is still in scroll mode, and the next click
										 * ends the scroll.
										 */
										onMouseDown={(event) => {
											if (isRuntimeTabCloseClick(event.button))
												event.preventDefault();
										}}
									/>
								}
							>
								{/*
								 * The underline sits at the bottom edge of the tab box. The row scrolls horizontally
								 * (overflow-x-auto), so anything placed below the box would be clipped; the underline overlaps
								 * the row's bottom border instead. Its namespace is separate from other surfaces
								 * (runtime-editor-tab): on this screen it is normal for five surfaces to show an active marker
								 * at the same time.
								 */}
								{selected && (
									<MotionActiveIndicator
										group="runtime-editor-tab"
										className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground"
									/>
								)}
								<button
									type="button"
									role="tab"
									aria-selected={selected}
									/**
									 * The accessible name is the full path. The visible label lengthens only when names
									 * collide, and that check depends on what is open, so closing a tab can shorten it.
									 * Changing the name with the list would leave a screen reader user unable to tell whether
									 * it is the same tab.
									 */
									aria-label={file.path}
									title={file.path}
									className={cn(
										/*
										 * Keeps one name from taking the whole row. Path segments are capped at 64 characters, so
										 * a tab can grow to about 400px at fixed width. One such tab would push its neighbors out
										 * of the scrolling row, so the row could no longer show what is open. The truncated name
										 * is in title, which already holds the full path.
										 */
										"max-w-52 truncate py-1.5 font-mono text-xs",
										selected ? "font-medium" : "text-muted-foreground",
									)}
									onClick={() => onSelect(file.id)}
								>
									{labels[index]}
								</button>
								<button
									type="button"
									className="rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
									aria-label={t("tabs.close", { path: file.path })}
									onClick={() => commands.close(file.id)}
								>
									<X className="size-3.5" />
								</button>
							</ContextMenuTrigger>
							<ContextMenuContent className={TAB_MENU_WIDTH}>
								<TabMenuItems items={items} />
							</ContextMenuContent>
						</ContextMenu>
					);
				})}
			</div>

			{/*
			 * The overflow menu at the row end acts on the active tab. There is no represented no-active
			 * state, since an existing tab implies an active one. In a frame where the list is briefly out of
			 * sync, this renders nothing: opening a menu with no target is worse.
			 */}
			{active !== null && (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="size-8 shrink-0 self-center me-1"
								aria-label={`${active.path} ${RUNTIME_STUDIO.tabMenu}`}
							>
								<MoreHorizontal className="size-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end" className={TAB_MENU_WIDTH}>
						<TabMenuItems
							items={runtimeTabMenu(
								{ fileId: active.id, path: active.path },
								open.length,
								commands,
							)}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}

/**
 * The menu width is set explicitly, for the same reason as the explorer menu. The default follows
 * the anchor's width. The anchor is an icon button fixed at 128px, and subtracting padding would
 * break `Close other tabs` mid-word, since Korean default line breaking does that.
 */
const TAB_MENU_WIDTH = "min-w-44";

/**
 * Maps each command to an icon. Icons belong to the markup, not the command vocabulary
 * (runtime-tab-commands.ts), which must not know either container. The Record type makes adding a
 * command break compilation here, so an item without an icon cannot slip in silently.
 */
const TAB_COMMAND_ICON: Record<RuntimeTabCommandId, LucideIcon> = {
	close: X,
	"close-others": ListX,
	"close-all": SquareX,
	reveal: FolderTree,
	"copy-path": Copy,
};

/** Renders the items both menu containers share; the caller chooses the container. */
function TabMenuItems({ items }: { items: RuntimeTabMenuItem[] }) {
	return (
		<>
			{items.map((item) => {
				const Icon = TAB_COMMAND_ICON[item.id];
				return (
					<Fragment key={item.id}>
						{item.separatorBefore && <DropdownMenuSeparator />}
						<DropdownMenuItem disabled={item.disabled} onClick={item.run}>
							<Icon aria-hidden="true" />
							{/*
							 * Menu labels do not wrap. A label that wraps to two lines changes the item height, so the target
							 * a pointer aims at differs from row to row.
							 */}
							<span className="whitespace-nowrap">{item.label}</span>
						</DropdownMenuItem>
					</Fragment>
				);
			})}
		</>
	);
}
