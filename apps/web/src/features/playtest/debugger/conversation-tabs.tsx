import {
	CHAT_PROMPT_BLOCK_SOURCE,
	type ChatLoreDecision,
	type ChatPromptBlockSource,
	type ConversationTurnRecord,
	cacheReadings,
	formatCount,
	formatDuration,
	inputTokenReading,
	outputTokenReading,
	type TokenReading,
	turnDurationMs,
} from "@rowcat/chat";
import { APP_NAME } from "@rowcat/domain";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useTranslation } from "react-i18next";
import {
	debugNoPromptCopy,
	discardReasonLabel,
	lorePositionLabel,
	loreReasonLabel,
	promptBlockLabel,
	promptSourceLabel,
	turnStatusLabel,
} from "./debug-copy.ts";
import {
	DebugCode,
	DebugEmpty,
	DebugField,
	DebugHint,
	DebugSection,
	DebugUnknown,
} from "./debug-primitives.tsx";

/**
 * The conversation lane's three panes: Prompt, Lore and Generation. All three draw one turn: the
 * selected one, not the current state. Showing the fifth request's prompt to someone looking at the
 * third response would give a wrong basis with no error. The assembled prompt is not split again.
 * Blocks are named by the assembler before the string is built (prompt-trace.ts in @rowcat/chat).
 * This file has no split on blank lines and no header regex.
 */

const SOURCE_TONE: Record<ChatPromptBlockSource, string> = {
	platform: "bg-muted text-muted-foreground",
	creator: "bg-primary/10 text-primary",
	viewer: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	narration: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
};

function SourceBadge({ source }: { source: ChatPromptBlockSource }) {
	return (
		<span
			className={cn(
				"shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
				SOURCE_TONE[source],
			)}
		>
			{promptSourceLabel(source)}
		</span>
	);
}

export function PromptTab({ turn }: { turn: ConversationTurnRecord }) {
	const { t } = useTranslation(["playtest", "common"]);
	if (turn.prompt === null || turn.request === null)
		return <DebugEmpty {...debugNoPromptCopy()} />;

	const { prompt, request } = turn;
	return (
		<div className="flex flex-col gap-1">
			{turn.truncated && (
				<p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
					{t("conversationTabs.someTextWasCutBecause")}
				</p>
			)}

			<DebugSection
				title={t("conversationTabs.systemPrompt")}
				trailing={
					<span className="text-[11px] text-muted-foreground">
						{t("debug.blocks", {
							count: prompt.blocks.length,
							chars: formatCount(request.system.length),
						})}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					{prompt.blocks.map((block) => (
						<DebugCode
							key={block.id}
							noun="block"
							value={block.text}
							label={
								<span className="flex items-center gap-1.5">
									<SourceBadge source={CHAT_PROMPT_BLOCK_SOURCE[block.id]} />
									{promptBlockLabel(block.id)}
									<span className="font-mono text-[10px] text-muted-foreground">
										{block.id}
									</span>
								</span>
							}
						/>
					))}
				</div>
			</DebugSection>

			<DebugSection
				title={t("conversationTabs.messages")}
				trailing={
					<span className="text-[11px] text-muted-foreground">
						{t("debug.messages", {
							count: request.messages.length,
							window: prompt.historyLength,
						})}
					</span>
				}
			>
				<div className="flex flex-col gap-2">
					{request.messages.map((message, index) => (
						<DebugCode
							// biome-ignore lint/suspicious/noArrayIndexKey: The array is a fixed snapshot of one request, so position is identity.
							key={index}
							noun="message"
							value={message.content}
							label={
								<span className="flex items-center gap-1.5">
									<span className="font-mono text-[10px] text-muted-foreground">
										{index}
									</span>
									{message.role}
									{message.toolCallName && (
										<span className="text-muted-foreground">
											· {message.toolCallName}
										</span>
									)}
								</span>
							}
						/>
					))}
				</div>
			</DebugSection>

			{/*
			 * `Raw` is the assembled result, not the HTTP body sent to the provider. The two are not given one
			 * name
			 * because the body is an object carrying credentials, and this screen never receives it
			 * (safeChatRequestDebug).
			 */}
			<DebugSection title={t("conversationTabs.rawTheAssembledRequest")}>
				<DebugCode
					noun="request"
					value={JSON.stringify(request, null, 2)}
					label={t("conversationTabs.providerNeutralRequestCredentialsHave")}
				/>
			</DebugSection>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Lore
 * ══════════════════════════════════════════════════════════════════════════ */

function LoreRow({ decision }: { decision: ChatLoreDecision }) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<li className="border-t py-2 first:border-t-0">
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span
					className={cn(
						"shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
						decision.active
							? "bg-primary/10 text-primary"
							: "bg-muted text-muted-foreground",
					)}
				>
					{decision.active
						? t("conversationTabs.included")
						: t("conversationTabs.notIncluded")}
				</span>
				<span className="font-mono text-[11px] text-muted-foreground">
					{decision.id}
				</span>
				<span className="min-w-0 flex-1 truncate text-xs">
					{decision.keys.length > 0 ? (
						decision.keys.join(" · ")
					) : (
						<span className="text-muted-foreground">
							{t("conversationTabs.noKeys")}
						</span>
					)}
				</span>
			</div>
			<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
				<span>{loreReasonLabel(decision.reason)}</span>
				{decision.matchedKey !== null && (
					<span className="font-mono">
						{t("debug.matchedKey", { key: decision.matchedKey })}
					</span>
				)}
				<span>{lorePositionLabel(decision.position)}</span>
				<span>order {decision.order}</span>
				<span>
					{t("debug.chars", { count: formatCount(decision.contentLength) })}
				</span>
				{decision.injectedIndex !== null && (
					<span>
						{t("debug.injectedOrder", { n: decision.injectedIndex + 1 })}
					</span>
				)}
			</div>
			{decision.content !== null && (
				<div className="mt-1.5">
					<DebugCode noun="lore" value={decision.content} />
				</div>
			)}
		</li>
	);
}

export function LoreTab({ turn }: { turn: ConversationTurnRecord }) {
	const { t } = useTranslation(["playtest", "common"]);
	if (turn.prompt === null) return <DebugEmpty {...debugNoPromptCopy()} />;
	const decisions = turn.prompt.lore;
	if (decisions.length === 0)
		return (
			<DebugEmpty
				title={t("conversationTabs.thisStoryHasNoLore")}
				body={t("conversationTabs.loreEntriesAreInjectedInto")}
			/>
		);

	const active = decisions.filter((decision) => decision.active).length;
	return (
		<div className="flex flex-col gap-1">
			<DebugSection
				title={t("conversationTabs.scannedText")}
				trailing={
					<span className="text-[11px] text-muted-foreground">
						{t("debug.matchedOf", { count: decisions.length, active })}
					</span>
				}
			>
				{/*
				 * Shows the text the verdict scanned. Half of 'why was this not triggered?' is answered here: if a
				 * key
				 * is present but did not trigger, that keyword sits outside this window.
				 */}
				<DebugCode
					noun="scanText"
					value={turn.prompt.loreScanText || t("conversationTabs.empty")}
				/>
			</DebugSection>
			<DebugSection title={t("conversationTabs.decision")}>
				<ul>
					{decisions.map((decision) => (
						<LoreRow key={decision.id} decision={decision} />
					))}
				</ul>
			</DebugSection>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Generation
 * ══════════════════════════════════════════════════════════════════════════ */

function TokenField({
	label,
	reading,
}: {
	label: string;
	reading: TokenReading | null;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	if (reading === null)
		return (
			<DebugField label={label}>
				<DebugUnknown />
			</DebugField>
		);
	return (
		<DebugField
			label={label}
			hint={
				reading.source === "provider" ? (
					<DebugHint>{t("conversationTabs.providerReported")}</DebugHint>
				) : (
					<DebugHint tone="warn">
						{t("conversationTabs.estimatedFromCharacterCount")}
					</DebugHint>
				)
			}
		>
			{formatCount(reading.value)}
		</DebugField>
	);
}

export function GenerationTab({ turn }: { turn: ConversationTurnRecord }) {
	const { t } = useTranslation(["playtest", "common"]);
	const duration = turnDurationMs(turn);
	const cache = cacheReadings(turn.usage);
	return (
		<div className="flex flex-col gap-1">
			<DebugSection title={t("conversationTabs.turn")}>
				<DebugField label="turn id">
					<span className="text-muted-foreground">{turn.turnId}</span>
				</DebugField>
				<DebugField label={t("conversationTabs.status")}>
					{turnStatusLabel(turn.status)}
				</DebugField>
				<DebugField label={t("conversationTabs.start")}>
					{new Date(turn.startedAt).toISOString()}
				</DebugField>
				<DebugField label={t("conversationTabs.end")}>
					{turn.endedAt === null ? (
						<DebugUnknown />
					) : (
						new Date(turn.endedAt).toISOString()
					)}
				</DebugField>
				<DebugField label={t("conversationTabs.duration")}>
					{duration === null ? <DebugUnknown /> : formatDuration(duration)}
				</DebugField>
				<DebugField label={t("conversationTabs.endReason")}>
					{turn.end ?? <DebugUnknown />}
				</DebugField>
				<DebugField label={t("conversationTabs.providerFinishReason")}>
					{turn.finishReason ?? <DebugUnknown />}
				</DebugField>
				<DebugField label={t("conversationTabs.committedMessage")}>
					{turn.messageId ?? <DebugUnknown />}
				</DebugField>
			</DebugSection>

			<DebugSection title={t("conversationTabs.execution")}>
				{turn.execution === null ? (
					<p className="py-2 text-xs text-muted-foreground">
						{t("conversationTabs.thisTurnNeverReachedA")}
					</p>
				) : (
					<>
						<DebugField label={t("conversationTabs.provider")}>
							{turn.execution.target.provider}
						</DebugField>
						<DebugField label={t("conversationTabs.model")}>
							{turn.execution.target.model}
						</DebugField>
						<DebugField
							label={t("conversationTabs.billingPath")}
							hint={
								turn.execution.managed ? undefined : <DebugHint>BYO</DebugHint>
							}
						>
							{turn.execution.managed
								? t("debug.managed", { app: APP_NAME })
								: t("conversationTabs.directConnection")}
						</DebugField>
						<DebugField label={t("conversationTabs.reasoningEffort")}>
							{turn.execution.reasoningEffort ?? <DebugUnknown />}
						</DebugField>
						<DebugField label={t("conversationTabs.responseLength")}>
							{turn.execution.responseLength ?? <DebugUnknown />}
						</DebugField>
						<DebugField label={t("conversationTabs.outputCap")}>
							{t("debug.tokens", {
								count: formatCount(turn.execution.maxOutputTokens),
							})}
						</DebugField>
						{/*
						 * The rating is the result of the work's rating combined with the viewer's eligibility. This screen
						 * does
						 * not recompute it; the assembly reports the rating the request was actually sent at.
						 */}
						<DebugField label={t("conversationTabs.ratingDecision")}>
							{turn.execution.allAges
								? t("conversationTabs.allAges")
								: t("conversationTabs.adult")}
						</DebugField>
						<DebugField label={t("conversationTabs.narrationPack")}>
							{turn.execution.narrationApplied
								? t("conversationTabs.applied")
								: t("conversationTabs.notApplied")}
						</DebugField>
					</>
				)}
			</DebugSection>

			<DebugSection
				title={t("conversationTabs.size")}
				trailing={
					turn.usage === null ? (
						<DebugHint tone="warn">
							{t("conversationTabs.theProviderDidnTReport")}
						</DebugHint>
					) : undefined
				}
			>
				<DebugField label={t("conversationTabs.inputCharacters")}>
					{turn.inputCharacters === null ? (
						<DebugUnknown />
					) : (
						formatCount(turn.inputCharacters)
					)}
				</DebugField>
				<DebugField label={t("conversationTabs.replyCharacters")}>
					{turn.outputCharacters === null ? (
						<DebugUnknown />
					) : (
						formatCount(turn.outputCharacters)
					)}
				</DebugField>
				<TokenField
					label={t("conversationTabs.inputTokens")}
					reading={inputTokenReading(turn)}
				/>
				<TokenField
					label={t("conversationTabs.outputTokens")}
					reading={outputTokenReading(turn)}
				/>
				{/*
				 * The cache value is not estimated. Without a provider-reported figure there is no way to derive it
				 * from
				 * character count, and filling in 0 would make 'not used' and 'unknown' the same value.
				 */}
				{cache.map((reading) => (
					<DebugField
						key={reading.kind}
						label={
							reading.kind === "read"
								? t("conversationTabs.readFromCache")
								: t("conversationTabs.writtenToCache")
						}
						hint={
							<DebugHint>{t("conversationTabs.providerReported")}</DebugHint>
						}
					>
						{formatCount(reading.value)}
					</DebugField>
				))}
			</DebugSection>

			{turn.failure !== null && (
				<DebugSection title={t("conversationTabs.failure")}>
					<DebugField label={t("conversationTabs.exceptionName")}>
						{turn.failure.name}
					</DebugField>
					<DebugField label={t("conversationTabs.code")}>
						{turn.failure.code ?? <DebugUnknown />}
					</DebugField>
					{/*
					 * Provider raw text does not reach this surface. Only the sentences our table selects are shown
					 * (generation-debug.ts).
					 */}
					<p className="pt-1 text-xs text-muted-foreground">
						{turn.failure.summary}
					</p>
				</DebugSection>
			)}

			{turn.discardReason !== null && (
				<DebugSection title={t("conversationTabs.whyItWasnTSaved")}>
					<p className="py-1 text-xs text-muted-foreground">
						{discardReasonLabel(turn.discardReason)}
					</p>
				</DebugSection>
			)}
		</div>
	);
}
