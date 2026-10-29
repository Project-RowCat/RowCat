import type { ChatRoom, ChatUsageOutcome } from "@rowcat/chat";
import { chatUsageView } from "@rowcat/chat";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "#/lib/i18n/format.ts";
import { useLocalMessages } from "#/lib/local-chat/hooks.ts";

/**
 * Read-only facts about this conversation. The panel has no controls on purpose: a control here
 * would change the premises of a conversation already in progress. The rule is read-only, not
 * immutable, because the usage table changes every time a response finishes.
 *
 * It sits apart from the generation settings pane. Those settings answer "what do I make this with"
 * and are operated by everyone; this panel answers "what was this conversation" and is only opened
 * by someone who suspects an odd turn.
 *
 * Protected prompts stay hidden. `promptProtected` is a protection boundary, not a display
 * preference, so there is no "show original" item.
 *
 * The source story is not fetched. The room's seed is the source of truth for its content, and a
 * conversation started from a since-unpublished story still reads its own facts.
 *
 * No dividers between rows: the list is at most three rows, and a rule that long only draws
 * attention to itself. Labels align on one vertical line instead. Developer metadata (room id,
 * revision, HLC) is not drawn; this is conversation information, not a record viewer.
 */
export function RoomSettingsInfo({ room }: { room: ChatRoom }) {
	const { t } = useTranslation(["chat", "common"]);
	return (
		<div className="flex flex-col gap-6">
			<dl className="flex flex-col gap-4">
				<InfoRow label={t("info.startedFrom")}>
					{room.originStoryId ? (
						<Link
							to="/stories/$storyId"
							params={{ storyId: room.originStoryId }}
							className="underline underline-offset-2"
						>
							{t("info.viewTheOriginalStory")}
						</Link>
					) : (
						t("info.thisConversationDidnTStart")
					)}
				</InfoRow>
				{/*
				 * Rating and prompt protection are facts that cannot be toggled, so they are not
				 * switches. Both are inherited from the story, and flipping either here would change
				 * the premises of the safety guards.
				 *
				 * Rows that do not apply are not drawn. A "not applicable" placeholder would leave
				 * most conversations showing two empty cells.
				 */}
				{room.adult && (
					<InfoRow label={t("info.rating")}>
						{t("info.thisConversationStartedFromAn")}
					</InfoRow>
				)}
				{room.promptProtected && (
					<InfoRow label={t("info.prompt")}>
						{t("info.theCreatorProtectedThisStory")}
					</InfoRow>
				)}
			</dl>
			<RoomUsage roomId={room.id} />
		</div>
	);
}

/**
 * One label-and-value row that stacks on narrow screens. On wide screens the baseline is aligned
 * (`items-baseline`). Top alignment would pin the label to the top of a two-line value (prompt
 * protection) and misalign it with the first line.
 */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
			<dt className="shrink-0 text-sm text-muted-foreground sm:w-20">
				{label}
			</dt>
			<dd className="min-w-0 text-sm break-words">{children}</dd>
		</div>
	);
}

/**
 * Recent usage: the tokens this conversation actually spent.
 *
 * Counting lives in the shared pure function (`chatUsageView`). Adding `?? 0` here would count
 * responses that reported no usage as responses that spent nothing, so every total would come out
 * smaller than the truth.
 *
 * The window is the most recent page and did not widen when the table moved, because the question
 * is unchanged: did tokens spike on a recent turn? Counting the whole room would answer "how much
 * has this conversation spent in total", which needs a period and a sort and belongs to another
 * screen. Mobile uses the same page size (`lib/local-data/use-room-messages.ts`); different windows
 * would make the same conversation's totals differ between apps with no error.
 *
 * The screen states what it counted (see `The last N replies` below). Totals drawn without the window size
 * would read as covering the whole conversation.
 *
 * Money is not shown. Provider prices are not facts this app knows, and multiplying tokens by a
 * price would go stale the day the price changes. The bill for a directly connected key lives in
 * that provider's own console.
 */
function RoomUsage({ roomId }: { roomId: string }) {
	const { t } = useTranslation(["chat", "common"]);
	const { messages } = useLocalMessages(roomId);
	const usage = chatUsageView(messages);
	if (usage.rows.length === 0) return null;

	return (
		<section className="border-t pt-4">
			<h3 className="text-xs font-medium text-muted-foreground">
				{t("info.recentUsage")}
			</h3>
			{/*
			 * State what was counted. The window size is left out of the sentence because it is the
			 * screen's own detail; stating the number of responses counted makes that number the scope.
			 */}
			<p className="mt-1 text-sm text-muted-foreground">
				{t("info.recentCount", { count: usage.rows.length })}
				{usage.unreported > 0 &&
					t("info.unreported", { count: usage.unreported })}
			</p>
			<dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
				<UsageTotal label={t("info.input")} value={usage.totals.inputTokens} />
				<UsageTotal
					label={t("info.cachedInput")}
					value={usage.totals.cachedInputTokens}
				/>
				<UsageTotal
					label={t("info.output")}
					value={usage.totals.outputTokens}
				/>
			</dl>
			{/*
			 * The per-turn rows are the point of this table. Totals alone cannot show which turn
			 * spiked, which is why this list exists. Most recent first.
			 *
			 * The end state sits beside the model name. Users reported output stopping midway, and
			 * this place had nothing to read; the value was already on the record (see the header of
			 * `chatUsageView`). Normal completions say nothing, so the two that matter are not buried
			 * under a marker on every row.
			 */}
			<ul className="mt-3 flex flex-col gap-1">
				{usage.rows.map((row) => (
					<li
						key={row.messageId}
						className="flex items-baseline justify-between gap-4 text-sm tabular-nums"
					>
						<span className="flex min-w-0 items-baseline gap-2">
							<span className="min-w-0 truncate text-muted-foreground">
								{row.model ?? t("info.unknownModel")}
							</span>
							<UsageOutcome outcome={row.outcome} />
						</span>
						<span className="text-muted-foreground">
							{/*
							 * Each value is labelled. Two bare numbers side by side would make the reader
							 * work out which is input. With no axes at all, state that fact: an empty
							 * cell cannot be told apart from zero.
							 */}
							{row.inputTokens === undefined &&
							row.outputTokens === undefined ? (
								t("info.usageNotReported")
							) : (
								<span className="text-foreground">
									{formatUsageAxis(t("info.input"), row.inputTokens)}
									{formatUsageAxis(` · ${t("info.output")}`, row.outputTokens)}
								</span>
							)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * How the turn ended. A normal finish says nothing.
 *
 * Only two words on purpose. `Cut at the limit` is fixed by raising the response length
 * or continuing; `Interrupted` folds stop, connection loss and provider failure into one word.
 * Splitting them here would make this panel depend on the failure vocabulary of the failure ladder.
 */
function UsageOutcome({ outcome }: { outcome: ChatUsageOutcome }) {
	const { t } = useTranslation(["chat", "common"]);
	if (outcome === "complete") return null;
	return (
		<span className="shrink-0 text-muted-foreground text-xs">
			{outcome === "truncated"
				? t("info.cutAtTheLimit")
				: t("info.interrupted")}
		</span>
	);
}

/** Unknown axes are not drawn. `0` would claim the axis was unused, which is a different claim. */
function UsageTotal({ label, value }: { label: string; value?: number }) {
	if (value === undefined) return null;
	return (
		<div className="flex items-baseline gap-2">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="tabular-nums">{formatNumber(value)}</dd>
		</div>
	);
}

/** One axis inside a row. An axis with no value draws nothing, label included. */
function formatUsageAxis(label: string, value?: number): string {
	return value === undefined ? "" : `${label} ${formatNumber(value)}`;
}
