import { runtimeFileName, runtimeFolderOf } from "@rowcat/authoring";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Search } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import {
	highlightRuntimeMatch,
	type RuntimeTextMatchPart,
} from "../editor/text-match.ts";
import { RUNTIME_STUDIO } from "../runtime-copy.ts";
import { type RuntimeQuickOpenFile, searchRuntimeFiles } from "./quick-open.ts";

/**
 * Quick open is a path to files only, not a command palette. Keeping it narrow matters: once
 * operations are mixed in, ranking needs a rule per kind, and that rule cannot be explained to the
 * user.
 * - Opening a file goes through the reducer's `navigate` transition, the same one diagnostics
 *   use: tab opened and activated, explorer selected, ancestor folders expanded, editor focused,
 *   and the code pane shown on narrow screens. Writing those per call site would let one of them
 *   drift. Line is not passed, because this surface answers only which file.
 * - Uses combobox and listbox semantics. Focus stays in the input, and aria-activedescendant
 *   points at the selected row. Moving focus per row would break typing and make the browser scroll
 *   by its own rules.
 * - Rows are li elements with role option, not buttons, so an item is not read twice.
 * - Focus does not move on arrow keys, so the browser never scrolls the list. The component
 *   brings the selected row into view itself (`nearest`, so only the list scrolls).
 * - Matches are shown in weight and brightness, not as a background fill, because the selected
 *   row already has `bg-accent`. Highlighting only explains the ranking that `searchRuntimeFiles`
 *   decides, and it must not change the order.
 */
export function RuntimeQuickOpenDialog({
	open,
	files,
	onOpenChange,
	onPick,
}: {
	open: boolean;
	/** All source files in the project, not only the open ones. */
	files: readonly RuntimeQuickOpenFile[];
	onOpenChange: (open: boolean) => void;
	/**
	 * Passes the path too, since the opener must expand ancestor folders and the value is already
	 * here.
	 */
	onPick: (fileId: string, path: string) => void;
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

	const results = useMemo(
		() => searchRuntimeFiles(files, query),
		[files, query],
	);

	/**
	 * When the list shrinks, the cursor can point past its end. The index is clamped once, into a
	 * single value, because clamping at render time could make Enter and the highlighted row disagree.
	 */
	const selected =
		results.length === 0 ? -1 : Math.min(cursor, results.length - 1);

	/**
	 * Scrolls the selected row into view. The effect depends on both the index and the row id. An
	 * index alone would miss a query change that replaces the whole list while the index stays 0,
	 * leaving the new top result off screen. Lookup is by id, since per-row refs would keep stale
	 * entries for removed rows that nothing deletes.
	 */
	const selectedId = selected === -1 ? null : results[selected].id;
	useEffect(() => {
		if (selectedId === null) return;
		/**
		 * The element id is built inline from the list id rather than through `optionId`. `optionId` is
		 * recreated on every render, so it cannot be an effect dependency. Omitting it from the
		 * dependency list leaves that fact recorded only in this comment.
		 */
		document
			.getElementById(`${listId}-${selected}`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [listId, selected, selectedId]);

	const pick = (index: number) => {
		const file = results[index];
		if (!file) return;
		onPick(file.id, file.path);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/*
			 * Anchored to the top. The box grows downward as results appear, and centering would split that
			 * growth above and below, moving the input while typing.
			 *
			 * The height is capped here, not with DIALOG_VIEWPORT_BOUND. The box already has its own scroll
			 * area (input pinned, only results scroll). An outer bound would add a second scroll container,
			 * so the whole box would move again once the list reached its end. `dvh` follows the real height
			 * when the soft keyboard is up.
			 */}
			<DialogContent
				showCloseButton={false}
				className="top-[12dvh] flex max-h-[70dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
			>
				<DialogTitle className="sr-only">
					{RUNTIME_STUDIO.quickOpen}
				</DialogTitle>
				<DialogDescription className="sr-only">
					{RUNTIME_STUDIO.quickOpenPlaceholder}
				</DialogDescription>

				<div className="flex shrink-0 items-center gap-2 border-b px-3">
					<Search
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
					<input
						/*
						 * This input is the surface the user just opened. Without focus, they would have to press
						 * once more to get into it.
						 */
						autoFocus
						type="text"
						role="combobox"
						/*
						 * The list is marked collapsed when empty. Marking it expanded would point `aria-controls` at
						 * a listbox that is not rendered, and assistive tech would announce something there but read
						 * nothing.
						 */
						aria-expanded={results.length > 0}
						aria-controls={results.length > 0 ? listId : undefined}
						aria-autocomplete="list"
						aria-activedescendant={
							selected === -1 ? undefined : optionId(selected)
						}
						aria-label={RUNTIME_STUDIO.quickOpen}
						placeholder={RUNTIME_STUDIO.quickOpenPlaceholder}
						value={query}
						spellCheck={false}
						autoComplete="off"
						className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
						onChange={(event) => {
							setQuery(event.target.value);
							/**
							 * When the query changes, the top result is the answer. Keeping the previous index would
							 * select an unrelated row.
							 */
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
							 * Escape is not handled here. The dialog already receives that key, and handling it in two
							 * places would leave one side unaware of why the other closed.
							 */
						}}
					/>
				</div>

				{results.length === 0 ? (
					<p className="px-4 py-6 text-sm text-muted-foreground">
						{RUNTIME_STUDIO.quickOpenEmpty}
					</p>
				) : (
					<ul
						id={listId}
						// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox children must be options, and ul/li shows that structure most honestly. Using a div would blur the markup and leave the role unchanged.
						role="listbox"
						aria-label={RUNTIME_STUDIO.quickOpenResults}
						className="min-h-0 flex-1 overflow-y-auto py-1"
					>
						{results.map((file, index) => (
							<QuickOpenRow
								key={file.id}
								id={optionId(index)}
								path={file.path}
								query={query}
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
 * One result row: file name first, folder second.
 *
 * A single full-path label would put same-named files at different x positions, so names cannot be
 * scanned vertically. Root-level files have no folder part, and nothing is drawn in its place: an
 * empty fragment would make the row look truncated, with no way on screen to resolve that.
 *
 * A truncated folder is readable with the mouse through `title`. The row text already contains both
 * name and folder, so no separate aria-label is added; it would be read twice.
 */
function QuickOpenRow({
	id,
	path,
	query,
	selected,
	onPick,
	onHover,
}: {
	id: string;
	path: string;
	/** The typed text. Used only for highlighting, never for ranking. */
	query: string;
	selected: boolean;
	onPick: () => void;
	onHover: () => void;
}) {
	const folder = runtimeFolderOf(path);
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: The keyboard is handled by the input (arrow keys select, Enter opens). This row never receives focus, so a key handler here would never be called.
		<li
			id={id}
			// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox children must be options. A button inside would make the item be read twice, once as the option and once as the button.
			role="option"
			/*
			 * This list follows the aria-activedescendant pattern: focus stays in the input and rows are not
			 * in the Tab order. The input receives all keyboard control (arrow keys and Enter).
			 */
			tabIndex={-1}
			aria-selected={selected}
			className={cn(
				"mx-1 flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5",
				selected && "bg-accent",
			)}
			onClick={onPick}
			onMouseMove={onHover}
		>
			<span className="shrink-0 font-mono text-[13px]">
				<MatchedText text={runtimeFileName(path)} query={query} />
			</span>
			{folder !== "" && (
				<span
					className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
					title={folder}
				>
					<MatchedText text={folder} query={query} />
				</span>
			)}
		</li>
	);
}

/**
 * Matched characters are distinguished by weight and brightness only, not by a background fill. The
 * selected row already has `bg-accent`, so a fill would disappear exactly on that row. Brightness
 * also gives the dimmed folder text the same contrast rule.
 *
 * Not a `<mark>` element: it needs an extra rule to clear the browser's default background, and
 * screen readers would announce 'highlight' on each fragment, splitting one file name into three
 * reads. Joined fragments always equal the original text (`runtime-text-match.ts`), so the text
 * read is unchanged.
 */
function MatchedText({ text, query }: { text: string; query: string }) {
	const parts: RuntimeTextMatchPart[] = highlightRuntimeMatch(text, query);
	return (
		<>
			{parts.map((part, index) =>
				part.matched ? (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: A fragment is a position within this string, not an item with an identity. The same text can occur twice, so a value-based key would collide.
						key={index}
						className="font-semibold text-foreground"
					>
						{part.text}
					</span>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: same as above.
					<Fragment key={index}>{part.text}</Fragment>
				),
			)}
		</>
	);
}
