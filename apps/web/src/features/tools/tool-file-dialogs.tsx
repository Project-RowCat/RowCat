import {
	buildChatToolFile,
	type ChatToolFileEntry,
	type ChatToolImportChoice,
	type ChatToolImportWrites,
	type ChatUserTool,
	chatToolFileName,
	chatToolFileTooLarge,
	chatToolImportChoices,
	chatToolImportWrites,
	defaultChatToolImportChoice,
	planChatToolImport,
	readChatToolFile,
	serializeChatToolFile,
} from "@rowcat/chat";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	toolFormIssueOf,
	toolImportStatusLabel,
	toolKindLabel,
} from "./tool-form.ts";

/**
 * Export and import of tool files. The file rules (what a file never carries, what an import may
 * do) live in `tool-file.ts` in @rowcat/chat; this file reads and writes bytes and draws the
 * choices that module allows.
 */

/**
 * Export: choose tools, download one file. The header sentence is shown before the download, not
 * after: the person exporting must know the recipient will receive a tool without its key, while
 * they can still decide to tell them.
 */
export function ToolExportDialog({
	tools,
	onClose,
}: {
	tools: readonly ChatUserTool[];
	onClose: () => void;
}) {
	const { t } = useTranslation(["tools", "common"]);
	const baseId = useId();
	const [selected, setSelected] = useState<ReadonlySet<string>>(
		() => new Set(tools.map((tool) => tool.id)),
	);
	const [failure, setFailure] = useState<string | null>(null);

	const chosen = tools.filter((tool) => selected.has(tool.id));
	const exported = buildChatToolFile(chosen.map((tool) => tool.tool));
	const allSelected = chosen.length === tools.length;

	const toggle = (id: string, on: boolean): void =>
		setSelected((current) => {
			const next = new Set(current);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});

	const download = (): void => {
		if (chosen.length === 0) return;
		try {
			const blob = new Blob([serializeChatToolFile(exported.file)], {
				type: "application/json",
			});
			downloadFile(blob, chatToolFileName(exported.file.tools));
			onClose();
		} catch (error) {
			console.error("[tools] couldn't export tools", error);
			setFailure(t("exportDialog.failed"));
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, false)) onClose();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}>
				<DialogHeader className="min-w-0">
					<DialogTitle>{t("exportDialog.title")}</DialogTitle>
					<DialogDescription>{t("exportDialog.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex min-w-0 flex-col gap-3 text-sm">
					<div className="flex items-center gap-2">
						<Checkbox
							id={`${baseId}-all`}
							checked={allSelected}
							onCheckedChange={(checked) =>
								setSelected(
									checked === true
										? new Set(tools.map((tool) => tool.id))
										: new Set(),
								)
							}
						/>
						<label htmlFor={`${baseId}-all`} className="font-medium">
							{t("exportDialog.selectAll")}
						</label>
					</div>
					<ul className="flex flex-col gap-1.5 border-t pt-3">
						{tools.map((tool) => (
							<li key={tool.id}>
								<div className="flex min-w-0 items-center gap-2">
									<Checkbox
										id={`${baseId}-${tool.id}`}
										checked={selected.has(tool.id)}
										onCheckedChange={(checked) =>
											toggle(tool.id, checked === true)
										}
									/>
									<label
										htmlFor={`${baseId}-${tool.id}`}
										className="truncate font-mono"
									>
										{tool.tool.declaration.name}
									</label>
									<Badge variant="secondary">
										{toolKindLabel(tool.tool.action.kind)}
									</Badge>
								</div>
							</li>
						))}
					</ul>
					{exported.strippedHeaders.length > 0 && (
						<p className="rounded-md bg-muted/50 p-2 text-muted-foreground">
							{t("exportDialog.strippedHeaders", {
								list: exported.strippedHeaders
									.map((header) => `${header.tool} (${header.header})`)
									.join(", "),
							})}
						</p>
					)}
					{chosen.length === 0 && (
						<p className="text-muted-foreground">
							{t("exportDialog.nothingSelected")}
						</p>
					)}
					{failure && (
						<p role="alert" className="text-destructive">
							{failure}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common:actions.cancel")}
					</Button>
					<Button onClick={download} disabled={chosen.length === 0}>
						{t("exportDialog.download")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type ImportPhase =
	| { kind: "idle" }
	| { kind: "reading" }
	| { kind: "failed"; message: string }
	| { kind: "ready"; entries: ChatToolFileEntry[] };

/**
 * Import: pick a file, read it, show what each entry is and what will happen to it, then write.
 *
 * The plan is derived from the live library on every render rather than frozen when the file was
 * read. A tool with the same name can arrive by sync while this dialog is open; a frozen "new"
 * would then create a second tool with that name. Choices are keyed by entry index, and a choice
 * the fresh plan no longer allows is treated as skip by `chatToolImportWrites`, so a stale choice
 * can never overwrite or duplicate.
 *
 * Nothing preselects `replace` (`defaultChatToolImportChoice`): overwriting one's own tool is
 * always a deliberate pick.
 */
export function ToolImportDialog({
	library,
	onClose,
	onApply,
}: {
	library: readonly ChatUserTool[];
	onClose: () => void;
	onApply: (writes: ChatToolImportWrites) => Promise<void>;
}) {
	const { t } = useTranslation(["tools", "common"]);
	const inputRef = useRef<HTMLInputElement>(null);
	const [phase, setPhase] = useState<ImportPhase>({ kind: "idle" });
	const [choices, setChoices] = useState<Record<number, ChatToolImportChoice>>(
		{},
	);
	const [applying, setApplying] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const applyingRef = useRef(false);

	const plan = useMemo(
		() =>
			phase.kind === "ready" ? planChatToolImport(phase.entries, library) : [],
		[phase, library],
	);
	const writes = chatToolImportWrites(plan, library, choices);
	const count = writes.create.length + writes.replace.length;

	const read = async (file: File): Promise<void> => {
		setFailure(null);
		setChoices({});
		/*
		 * The size is refused before the text is read. Reading a stray video into memory only to
		 * refuse it would stall the tab first.
		 */
		if (chatToolFileTooLarge(file.size)) {
			setPhase({
				kind: "failed",
				message: t("importDialog.failure.too_large"),
			});
			return;
		}
		setPhase({ kind: "reading" });
		try {
			const result = readChatToolFile(await file.text());
			setPhase(
				result.ok
					? { kind: "ready", entries: result.entries }
					: {
							kind: "failed",
							message: t(`importDialog.failure.${result.reason}`),
						},
			);
		} catch (error) {
			console.error("[tools] couldn't read the tool file", error);
			setPhase({ kind: "failed", message: t("importDialog.readFailed") });
		}
	};

	const apply = async (): Promise<void> => {
		if (applyingRef.current || count === 0) return;
		applyingRef.current = true;
		setApplying(true);
		setFailure(null);
		try {
			await onApply(writes);
			onClose();
		} catch (error) {
			console.error("[tools] couldn't import tools", error);
			setFailure(t("importDialog.applyFailed"));
		} finally {
			applyingRef.current = false;
			setApplying(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, applying)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={applying}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-xl`}
			>
				<DialogHeader className="min-w-0">
					<DialogTitle>{t("importDialog.title")}</DialogTitle>
					<DialogDescription>{t("importDialog.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex min-w-0 flex-col gap-3 text-sm">
					<input
						ref={inputRef}
						type="file"
						accept=".json,application/json"
						className="sr-only"
						tabIndex={-1}
						aria-hidden="true"
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							// Cleared so choosing the same file again (after fixing it) fires a change.
							event.currentTarget.value = "";
							if (file) void read(file);
						}}
					/>
					{phase.kind === "reading" && (
						<output aria-live="polite">{t("importDialog.reading")}</output>
					)}
					{phase.kind === "failed" && (
						<p role="alert" className="text-destructive">
							{phase.message}
						</p>
					)}
					{phase.kind === "ready" && (
						<ul className="flex flex-col gap-2">
							{plan.map((item) => (
								<ImportRow
									key={item.entry.index}
									item={item}
									choice={
										choices[item.entry.index] ??
										defaultChatToolImportChoice(item)
									}
									disabled={applying}
									onChoose={(choice) =>
										setChoices((current) => ({
											...current,
											[item.entry.index]: choice,
										}))
									}
								/>
							))}
						</ul>
					)}
					{failure && (
						<p role="alert" className="text-destructive">
							{failure}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => inputRef.current?.click()}
						disabled={applying || phase.kind === "reading"}
					>
						{t("importDialog.choose")}
					</Button>
					{phase.kind === "ready" && (
						<Button
							onClick={() => void apply()}
							disabled={applying || count === 0}
						>
							{applying
								? t("importDialog.applying")
								: count === 0
									? t("importDialog.applyNone")
									: t("importDialog.apply", { count })}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ImportRow({
	item,
	choice,
	disabled,
	onChoose,
}: {
	item: ReturnType<typeof planChatToolImport>[number];
	choice: ChatToolImportChoice;
	disabled: boolean;
	onChoose: (choice: ChatToolImportChoice) => void;
}) {
	const { t } = useTranslation("tools");
	const { entry, status } = item;
	const allowed = chatToolImportChoices(item);
	const name = entry.ok
		? entry.tool.declaration.name
		: (entry.name ?? t("importDialog.unnamed"));
	const choiceItems = allowed.map((value) => ({
		value,
		label: t(`importDialog.choice.${value}`),
	}));

	return (
		<li className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<span className="truncate font-medium font-mono">{name}</span>
				{entry.ok && (
					<Badge variant="secondary">
						{toolKindLabel(entry.tool.action.kind)}
					</Badge>
				)}
				<span
					className={
						status === "invalid"
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{toolImportStatusLabel(status)}
				</span>
			</div>
			{entry.ok && entry.http && (
				<div className="flex flex-col gap-0.5 text-xs">
					{/*
					 * The origin is the part to read before importing an http tool: it is where the model's
					 * arguments, written from the importer's own conversation, will be sent.
					 */}
					<p className="text-amber-700 dark:text-amber-400">
						{t("importDialog.sendsTo", { origin: entry.http.origin })}
					</p>
					{entry.http.headersToFill.length > 0 && (
						<p className="text-muted-foreground">
							{t("importDialog.headersToFill", {
								headers: entry.http.headersToFill.join(", "),
							})}
						</p>
					)}
				</div>
			)}
			{!entry.ok && (
				<ul className="flex flex-col gap-0.5 text-destructive text-xs">
					{entry.issues.map((issue) => (
						<li key={issue}>{toolFormIssueOf(issue).message}</li>
					))}
				</ul>
			)}
			{allowed.length > 1 && (
				<Select
					value={choice}
					items={choiceItems}
					disabled={disabled}
					onValueChange={(next) =>
						next !== null && onChoose(next as ChatToolImportChoice)
					}
				>
					<SelectTrigger
						size="sm"
						className="w-44"
						aria-label={t("importDialog.choiceLabel", { name })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{choiceItems.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</li>
	);
}

/** A download the browser saves under our name; the object URL is released once the click is handed off. */
function downloadFile(file: Blob, fileName: string): void {
	const url = URL.createObjectURL(file);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
