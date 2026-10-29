import type { ChatSearchRange, ChatSearchResult } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Search } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "#/lib/format/relative-time.ts";
import { translator } from "#/lib/i18n/current.ts";
import { useRoomSearch } from "./use-room-search.ts";

/**
 * Find within a room. This dialog searches only this room's messages stored on this device. There
 * is no search endpoint and none should be added: the query and results do not leave the device by
 * request, log, or address bar.
 *
 * - Markdown is not rendered. Previews are plain-text slices of the stored source. Bold or links
 *   in results would make the displayed text differ from what the user typed, so a hit could not be
 *   explained. dangerouslySetInnerHTML is not used in this file.
 * - In-progress responses are not searched. Unsaved streams are not search targets; they enter
 *   results through the store subscription once committed.
 * - Results are not cached. Only the identity of the chosen result goes up to the parent; nothing
 *   remains after close.
 * - The query is not remembered. Closing discards it, because a query worth keeping is one that
 *   must not be stored.
 * - Only corner radius and the idle state of the search field follow the conversation screen's
 *   design language. Behaviour is intentionally unchanged (local-only search, narrow-screen sheet,
 *   previews, keyboard, jump flow).
 */

/** Assistant lines get no name, since the assistant may be several characters. */
const speakerLabel = (result: ChatSearchResult): string =>
	result.role === "user"
		? result.speaker || translator("chat")("search.me")
		: translator("chat")("search.other");

export function ChatSearchDialog({
	roomId,
	/**
	 * The same value again re-focuses the input, for when the shortcut is pressed while the dialog is
	 * already open.
	 */
	focusToken,
	onSelect,
	onClose,
}: {
	roomId: string;
	focusToken: number;
	/**
	 * The chosen result, and the room's live message count at that moment (used to compute the window
	 * to jump to).
	 */
	onSelect: (result: ChatSearchResult, total: number) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const { view, total, loading, stale, showMore } = useRoomSearch(
		roomId,
		query,
	);

	/**
	 * Pressing the shortcut again selects the current query, like the browser's find. The same effect
	 * runs once on open, which places the caret in the input.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependency is a signal, not a value; without it a second shortcut press does nothing.
	useEffect(() => {
		const frame = requestAnimationFrame(() => inputRef.current?.select());
		return () => cancelAnimationFrame(frame);
	}, [focusToken]);

	const trimmed = query.trim();

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				/*
				 * Does not close on focus-out. The dialog is often left and returned to while open (copying
				 * what was found elsewhere), and losing the query would force a retype. A press outside still
				 * closes, since that is a direct action on this dialog.
				 *
				 * This differs from the management dialogs, which also ignore outside-press
				 * (lib/dialog/dismiss.ts). Those hold irreversible actions or unsaved edits; here the loss is
				 * one line that is quick to retype.
				 */
				if (!next && details.reason !== "focus-out") onClose();
			}}
		>
			<DialogContent
				/*
				 * Opens with the caret in the input. With the default (the popup itself), the user would need
				 * one more press before typing, and when opened by shortcut that extra press reads as 'the
				 * shortcut did not work'.
				 */
				initialFocus={inputRef}
				/*
				 * Narrow screens get a sheet anchored to the bottom; wide screens get a centered window. It
				 * uses the same shape as the other conversation dialogs (room settings, memory), since dialogs
				 * opened from the same header appearing in different places would be noise.
				 */
				placement="adaptive"
				className="top-auto bottom-0 flex max-h-[85dvh] w-full max-w-full flex-col gap-0 rounded-t-2xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-h-[min(32rem,85vh)] sm:max-w-lg sm:rounded-2xl"
			>
				<DialogHeader className="border-b px-5 py-4 text-left">
					<DialogTitle>{t("dialog.findInConversation")}</DialogTitle>
					<DialogDescription>
						{t("dialog.searchesTheMessagesStoredIn")}
					</DialogDescription>
				</DialogHeader>

				<div className="relative px-5 pt-4">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-8 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							/*
							 * Enter goes to the first result. Result rows are buttons, so Tab alone reaches them, but
							 * search is usually for the top match.
							 */
							if (event.key !== "Enter") return;
							const first = view.results[0];
							if (!first) return;
							event.preventDefault();
							onSelect(first, total);
						}}
						aria-label={t("dialog.findInConversation")}
						// Keeps browser autocomplete and spellcheck from receiving conversation content.
						autoComplete="off"
						spellCheck={false}
						placeholder={t("dialog.searchTerms")}
						className="rounded-full border-border/60 bg-muted/30 pl-9 transition-[background-color,border-color,box-shadow] focus-visible:bg-background"
					/>
				</div>

				{/*
				 * Status line: where the result count is read out for users who do not see the screen. polite,
				 * so it does not interrupt typing.
				 */}
				<p
					aria-live="polite"
					// Fading means the results shown are not yet for the text just typed.
					className={cn(
						"px-5 pt-2 text-xs text-muted-foreground transition-opacity",
						stale && "opacity-60",
					)}
				>
					{!trimmed
						? t("dialog.enterWhatToFindIn")
						: loading
							? t("dialog.readingTheConversation")
							: view.matched === 0
								? t("dialog.noResults")
								: t("search.count", { count: view.matched })}
				</p>

				<div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-4">
					<ul className="flex flex-col gap-0.5">
						{view.results.map((result) => (
							<li key={result.messageId}>
								<button
									type="button"
									onClick={() => onSelect(result, total)}
									className="flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
								>
									<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
										<span className="font-medium">{speakerLabel(result)}</span>
										<span aria-hidden="true">·</span>
										<time dateTime={result.createdAt}>
											{relativeTime(result.createdAt)}
										</time>
									</span>
									{/*
									 * Two lines at most. The preview is already trimmed by a pure function at both ends, but on a
									 * narrow width even that slice wraps to four lines.
									 */}
									<span className="line-clamp-2 text-sm break-words text-foreground">
										<Snippet
											text={result.snippet}
											ranges={result.matchRanges}
										/>
									</span>
								</button>
							</li>
						))}
					</ul>

					{view.hasMore && (
						<div className="flex justify-center pt-2">
							<Button variant="outline" size="sm" onClick={showMore}>
								{t("dialog.showMore")}
							</Button>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Slices the string and wraps the match in <mark>; no HTML is injected. These characters were
 * written by others or by the model, and none has a reason to run on this page (same rule as
 * message-row.tsx).
 *
 * The ranges are the coordinates the pure function returns, used as-is. Do not search for the match
 * again on screen: running indexOf here would create a second normalisation rule that would
 * eventually diverge.
 */
function Snippet({
	text,
	ranges,
}: {
	text: string;
	ranges: ChatSearchRange[];
}) {
	const parts: ReactNode[] = [];
	let at = 0;
	for (const range of ranges) {
		if (range.start > at)
			parts.push(
				<Fragment key={`plain-${at}`}>{text.slice(at, range.start)}</Fragment>,
			);
		parts.push(
			<mark
				key={`mark-${range.start}`}
				className="rounded bg-primary/25 px-0.5 text-foreground"
			>
				{text.slice(range.start, range.end)}
			</mark>,
		);
		at = range.end;
	}
	parts.push(<Fragment key={`plain-${at}`}>{text.slice(at)}</Fragment>);
	return <>{parts}</>;
}
