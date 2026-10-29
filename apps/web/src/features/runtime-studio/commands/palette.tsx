import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Command } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { RUNTIME_STUDIO } from "../runtime-copy.ts";
import {
	type RuntimeCommand,
	type RuntimeCommandContext,
	type RuntimeCommandId,
	runtimeCommands,
	searchRuntimeCommands,
} from "./registry.ts";

/**
 * The command palette is the keyboard path to studio operations. Its purpose is discovery, not new
 * operations: every listed item already exists on screen, and running it calls the caller's handler
 * table. New operations are found by name here instead of adding header icons (see
 * runtime-studio-header.tsx).
 * - Markup and key conventions match runtime-quick-open-dialog.tsx: combobox and listbox, focus
 *   stays in the input, aria-activedescendant, and options rather than buttons. The two lists are
 *   not merged, because files and commands cannot share an explainable ranking.
 * - Disabled rows stay selectable but cannot run (aria-disabled, not removed). Skipping them with
 *   arrow keys would desync the cursor from what is shown and hide why the action is blocked. That
 *   reason, `fix the problems first to run`, is the only thing keeping the row in the list.
 * - No motion. Results change on every keystroke, and nothing is layered over the dialog's
 *   entrance, as in quick open.
 */
export function RuntimeCommandPalette({
	open,
	context,
	onOpenChange,
	onRun,
}: {
	open: boolean;
	context: RuntimeCommandContext;
	onOpenChange: (open: boolean) => void;
	/** Called with the chosen command id. This component does not know what any command does. */
	onRun: (id: RuntimeCommandId) => void;
}) {
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState(0);
	const listId = useId();
	const optionId = (index: number) => `${listId}-${index}`;

	/**
	 * Reopening starts fresh. A leftover query would make the list irrelevant to the current intent.
	 */
	useEffect(() => {
		if (open) {
			setQuery("");
			setCursor(0);
		}
	}, [open]);

	/**
	 * The list follows live state while open, so a running command's row should switch to `Stop`. A
	 * snapshot taken when the palette opened would make the pressed command disagree with the current
	 * state.
	 */
	const commands = useMemo(() => runtimeCommands(context), [context]);
	const results = useMemo(
		() => searchRuntimeCommands(commands, query),
		[commands, query],
	);

	const selected =
		results.length === 0 ? -1 : Math.min(cursor, results.length - 1);
	const selectedId = selected === -1 ? null : results[selected].id;
	useEffect(() => {
		if (selectedId === null) return;
		document
			.getElementById(`${listId}-${selected}`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [listId, selected, selectedId]);

	/** A blocked command neither closes the palette nor runs. Its reason stays visible on that row. */
	const pick = (index: number) => {
		const command = results[index];
		if (!command || command.disabledReason !== null) return;
		onRun(command.id);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="top-[12dvh] flex max-h-[70dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
			>
				<DialogTitle className="sr-only">
					{RUNTIME_STUDIO.commandPalette}
				</DialogTitle>
				<DialogDescription className="sr-only">
					{RUNTIME_STUDIO.commandPalettePlaceholder}
				</DialogDescription>

				<div className="flex shrink-0 items-center gap-2 border-b px-3">
					<Command
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
					<input
						autoFocus
						type="text"
						role="combobox"
						aria-expanded={results.length > 0}
						aria-controls={results.length > 0 ? listId : undefined}
						aria-autocomplete="list"
						aria-activedescendant={
							selected === -1 ? undefined : optionId(selected)
						}
						aria-label={RUNTIME_STUDIO.commandPalette}
						placeholder={RUNTIME_STUDIO.commandPalettePlaceholder}
						value={query}
						spellCheck={false}
						autoComplete="off"
						className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
						onChange={(event) => {
							setQuery(event.target.value);
							setCursor(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setCursor((at) =>
									results.length === 0 ? 0 : (at + 1) % results.length,
								);
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setCursor((at) =>
									results.length === 0
										? 0
										: (at - 1 + results.length) % results.length,
								);
								return;
							}
							if (event.key === "Enter") {
								event.preventDefault();
								pick(selected);
							}
							/**
							 * The dialog container handles `Escape`. Handling it in two places would leave one side
							 * unaware of why the other closed.
							 */
						}}
					/>
				</div>

				{results.length === 0 ? (
					<p className="px-4 py-6 text-sm text-muted-foreground">
						{RUNTIME_STUDIO.commandPaletteEmpty}
					</p>
				) : (
					<ul
						id={listId}
						// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox children must be options, and ul/li shows that structure most honestly. This is the same call as in quick open.
						role="listbox"
						aria-label={RUNTIME_STUDIO.commandPaletteResults}
						className="min-h-0 flex-1 overflow-y-auto py-1"
					>
						{results.map((command, index) => (
							<CommandRow
								key={command.id}
								id={optionId(index)}
								command={command}
								selected={index === selected}
								onPick={() => pick(index)}
								onHover={() => setCursor(index)}
							/>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}

/**
 * One command row: name on the left, shortcut at the far right.
 *
 * A blocked row shows its reason on a line under the name. Grey text alone only tells the user it
 * cannot run, and they would then search the screen for the next step.
 *
 * No match highlighting here. The list is about twenty short names, so why a row remains is already
 * visible. File paths need highlighting because they are long and overlap.
 */
function CommandRow({
	id,
	command,
	selected,
	onPick,
	onHover,
}: {
	id: string;
	command: RuntimeCommand;
	selected: boolean;
	onPick: () => void;
	onHover: () => void;
}) {
	const disabled = command.disabledReason !== null;
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: The keyboard is handled by the input (arrow keys select, Enter runs). This row never receives focus, so a key handler here would never be called.
		<li
			id={id}
			// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox children must be options. A button inside would make the item be read twice.
			role="option"
			tabIndex={-1}
			aria-selected={selected}
			aria-disabled={disabled || undefined}
			className={cn(
				"mx-1 flex items-baseline gap-3 rounded-md px-2 py-1.5",
				disabled ? "cursor-default" : "cursor-pointer",
				selected && "bg-accent",
			)}
			onClick={onPick}
			onMouseMove={onHover}
		>
			<span className="min-w-0 flex-1">
				<span
					className={cn(
						"block truncate text-sm",
						disabled && "text-muted-foreground",
					)}
				>
					{command.label}
				</span>
				{command.disabledReason !== null && (
					<span className="mt-0.5 block text-xs text-muted-foreground">
						{command.disabledReason}
					</span>
				)}
			</span>
			{command.shortcut !== null && (
				<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
					{command.shortcut}
				</span>
			)}
		</li>
	);
}
