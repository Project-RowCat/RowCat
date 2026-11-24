import type { NewDraftTool } from "@rowcat/authoring";
import { draftToolImportBlock, newDraftToolOf } from "@rowcat/authoring";
import type { ChatUserTool } from "@rowcat/chat";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLocalUserTools } from "#/lib/local-chat/hooks.ts";
import { toolKindLabel } from "./tool-fields.ts";

/**
 * Settings → Tools into this story: picks one of the author's own library tools and adds a copy of
 * it to the draft (`newDraftToolOf`). A copy, not a link: the published work must not change when
 * the author later edits their library, and readers never have that library.
 *
 * An `http` tool can be picked only when a story could publish it: a localhost address and no
 * headers (`draftToolImportBlock`). Others are listed with the reason on the row — an endpoint the
 * author controls would receive other people's conversations, and header values would reach every
 * reader — because hiding the row would leave the author wondering where their tool went.
 *
 * The dialog does not close on its own after a pick, so several tools can be brought in one visit;
 * each pick says so on its row.
 */
export function ToolFromLibraryDialog({
	open,
	onOpenChange,
	disabled,
	draftNames,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The draft is at its tool cap. */
	disabled: boolean;
	/** Names already in this draft, so a second copy is marked instead of silently duplicated. */
	draftNames: ReadonlySet<string>;
	onPick: (input: NewDraftTool) => void;
}) {
	const { t } = useTranslation("create");
	const { items, loading } = useLocalUserTools();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("toolLibraryPick.title")}</DialogTitle>
					<DialogDescription>
						{t("toolLibraryPick.description")}
					</DialogDescription>
				</DialogHeader>

				{loading ? null : items.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("toolLibraryPick.empty")}{" "}
						<Link to="/settings/tools" className="underline">
							{t("toolLibraryPick.openSettings")}
						</Link>
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{items.map((tool) => (
							<LibraryRow
								key={tool.id}
								tool={tool}
								disabled={disabled}
								inDraft={draftNames.has(tool.tool.declaration.name)}
								onPick={onPick}
							/>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}

function LibraryRow({
	tool,
	disabled,
	inDraft,
	onPick,
}: {
	tool: ChatUserTool;
	disabled: boolean;
	inDraft: boolean;
	onPick: (input: NewDraftTool) => void;
}) {
	const { t } = useTranslation("create");
	const input = newDraftToolOf(tool.tool);
	const block = draftToolImportBlock(tool.tool);
	const { declaration, action } = tool.tool;

	return (
		<li className="flex items-start justify-between gap-3 rounded-md border p-3">
			<div className="min-w-0">
				<p className="flex items-center gap-2">
					<span className="truncate font-mono text-sm font-medium">
						{declaration.name}
					</span>
					<Badge variant="secondary">
						{action.kind === "http" && block !== null
							? t("toolLibraryPick.http")
							: toolKindLabel(action.kind)}
					</Badge>
				</p>
				<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
					{declaration.description}
				</p>
				{block !== null && (
					<p className="mt-1 text-xs text-muted-foreground">
						{block === "http_headers"
							? t("toolLibraryPick.httpHeaders")
							: t("toolLibraryPick.httpNotLocal")}
					</p>
				)}
				{input !== null && inDraft && (
					<p className="mt-1 text-xs text-muted-foreground">
						{t("toolLibraryPick.inDraft")}
					</p>
				)}
			</div>
			<Button
				size="sm"
				variant="outline"
				disabled={input === null || disabled || inDraft}
				onClick={() => {
					if (input) onPick(input);
				}}
			>
				{t("toolLibraryPick.add")}
			</Button>
		</li>
	);
}
