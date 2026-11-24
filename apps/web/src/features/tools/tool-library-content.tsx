import type { ChatUserTool } from "@rowcat/chat";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Link } from "@tanstack/react-router";
import { FileDown, FileUp, MoreHorizontal, Plus, Wrench } from "lucide-react";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalUserTools } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { ToolDeleteDialog } from "./tool-delete-dialog.tsx";
import { ToolEditorDialog } from "./tool-editor-dialog.tsx";
import { ToolExportDialog, ToolImportDialog } from "./tool-file-dialogs.tsx";
import { toolKindLabel, toolOrigin } from "./tool-form.ts";
import { ToolLibrarySkeleton } from "./tool-library-skeleton.tsx";
import { useToolLibrary } from "./use-tool-library.ts";

/**
 * The private part of the tool library: list, empty state, create, edit, delete, export, import.
 * Loaded only in the browser (tool-settings-page.tsx imports it lazily inside ClientOnly), so tool
 * names, addresses and header values never reach the server HTML.
 *
 * The order is the store's (`sortUserTools`, most recently edited first), the same order the room
 * settings view and the registry read, so a tool is in the same place on every screen.
 */

type Target =
	| { kind: "create" }
	| { kind: "edit"; tool: ChatUserTool }
	| { kind: "delete"; tool: ChatUserTool }
	| { kind: "export" }
	| { kind: "import" };

export function ToolLibraryContent() {
	const { t } = useTranslation("tools");
	const { status } = useChatScope();
	const { items, loading } = useLocalUserTools();
	const library = useToolLibrary();
	const [target, setTarget] = useState<Target | null>(null);
	const close = (): void => setTarget(null);

	/*
	 * Identity could not be confirmed, so no store can open. Not loading: folding it in would show a
	 * placeholder forever on a dropped session (the persona library has the same branch).
	 */
	if (status === "unavailable")
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Wrench />
					</EmptyMedia>
					<EmptyTitle>{t("library.unavailableTitle")}</EmptyTitle>
					<EmptyDescription>{t("library.unavailableBody")}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Link
						to="/login"
						search={{ redirect: "/settings/tools" }}
						className={buttonVariants({ variant: "default", size: "sm" })}
					>
						{t("library.signIn")}
					</Link>
				</EmptyContent>
			</Empty>
		);

	if (loading) return <ToolLibrarySkeleton />;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap justify-end gap-2">
				{/*
				 * Import is offered even with an empty library: receiving someone's file is a common way to
				 * get a first tool. Export needs something to export.
				 */}
				<Button
					size="sm"
					variant="outline"
					onClick={() => setTarget({ kind: "import" })}
					disabled={!library.ready}
				>
					<FileUp aria-hidden="true" />
					{t("library.import")}
				</Button>
				{items.length > 0 && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => setTarget({ kind: "export" })}
					>
						<FileDown aria-hidden="true" />
						{t("library.export")}
					</Button>
				)}
				<Button
					size="sm"
					onClick={() => setTarget({ kind: "create" })}
					disabled={!library.ready}
				>
					<Plus aria-hidden="true" />
					{t("library.create")}
				</Button>
			</div>

			<AnimatePresence initial={false}>
				{items.length === 0 ? (
					<m.div
						key="empty"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={rowEnter.transition}
					>
						<Empty className="border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<Wrench />
								</EmptyMedia>
								<EmptyTitle>{t("library.emptyTitle")}</EmptyTitle>
								<EmptyDescription>{t("library.emptyBody")}</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button
									variant="outline"
									onClick={() => setTarget({ kind: "create" })}
									disabled={!library.ready}
								>
									<Plus aria-hidden="true" />
									{t("library.createFirst")}
								</Button>
							</EmptyContent>
						</Empty>
					</m.div>
				) : (
					<m.div
						key="list"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={rowEnter.transition}
					>
						<LayoutGroup>
							<ul className="flex flex-col gap-2">
								<AnimatePresence initial={false}>
									{items.map((tool) => (
										<ToolRow
											key={tool.id}
											tool={tool}
											onEdit={() => setTarget({ kind: "edit", tool })}
											onDelete={() => setTarget({ kind: "delete", tool })}
										/>
									))}
								</AnimatePresence>
							</ul>
						</LayoutGroup>
					</m.div>
				)}
			</AnimatePresence>

			{target?.kind === "create" && (
				<ToolEditorDialog
					tool={null}
					library={items}
					onClose={close}
					onSave={async (patch) => {
						await library.create(patch);
					}}
				/>
			)}
			{target?.kind === "edit" && (
				<ToolEditorDialog
					tool={target.tool}
					library={items}
					onClose={close}
					onSave={(patch) => library.update(target.tool.id, patch)}
					onDelete={() => setTarget({ kind: "delete", tool: target.tool })}
				/>
			)}
			{target?.kind === "delete" && (
				<ToolDeleteDialog
					name={target.tool.tool.declaration.name}
					onClose={close}
					onDelete={() => library.remove(target.tool.id)}
				/>
			)}
			{target?.kind === "export" && (
				<ToolExportDialog tools={items} onClose={close} />
			)}
			{target?.kind === "import" && (
				<ToolImportDialog
					library={items}
					onClose={close}
					onApply={library.applyImport}
				/>
			)}
		</div>
	);
}

/**
 * The row itself is not a button (no detail screen); actions live in the overflow menu, as in the
 * persona library. The address of an http tool is on the row, not hidden in the editor: it is
 * where conversation-derived text goes, and that should be visible while skimming.
 */
function ToolRow({
	tool,
	onEdit,
	onDelete,
}: {
	tool: ChatUserTool;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation(["tools", "common"]);
	const exiting = useExitGuard();
	const { declaration, action } = tool.tool;
	const origin = toolOrigin(tool.tool);

	return (
		<m.li
			layout="position"
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={exiting}
			className="flex items-start gap-3 rounded-lg border p-4"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<p className="truncate font-medium font-mono">{declaration.name}</p>
					<Badge variant="secondary">{toolKindLabel(action.kind)}</Badge>
				</div>
				<p className="line-clamp-2 whitespace-pre-line text-muted-foreground text-sm">
					{declaration.description}
				</p>
				<p className="text-muted-foreground text-xs">
					{tool.enabledByDefault
						? t("library.onByDefault")
						: t("library.offByDefault")}
					{origin && (
						<>
							{" · "}
							<span className="break-all">
								{t("library.reaches", { origin })}
							</span>
						</>
					)}
				</p>
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("library.manage", { name: declaration.name })}
						>
							<MoreHorizontal aria-hidden="true" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onEdit}>
						{t("library.edit")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onDelete}>
						{t("common:actions.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</m.li>
	);
}
