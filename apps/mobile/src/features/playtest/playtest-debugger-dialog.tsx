import {
	CHAT_PROMPT_BLOCK_LABEL,
	type ChatLoreDecision,
	type ConversationDebugState,
	type ConversationTurnRecord,
	cacheReadings,
	DEBUG_NO_EVENT_COPY,
	DEBUG_NO_PROMPT_COPY,
	DEBUG_NO_TURN_COPY,
	DISCARD_REASON_LABEL,
	debugTurnOptions,
	formatCount,
	formatDuration,
	inputTokenReading,
	outputTokenReading,
	PLAYTEST_DEBUG_TAB_LABEL,
	PLAYTEST_DEBUG_TABS,
	type PlaytestDebugTab,
	resolveSelectedTurn,
	type TokenReading,
	TURN_STATUS_LABEL,
	turnDurationMs,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	Badge,
	Dialog,
	EmptyState,
	IconButton,
	Notice,
	Select,
	SelectOption,
	Separator,
	Text,
} from "@rowcat/ui-native";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCopyMessage } from "../chat/messages/use-copy.ts";
import {
	PLAYTEST_DEBUGGER,
	PLAYTEST_DEBUGGER_STATE_UNAVAILABLE,
	PLAYTEST_DEBUGGER_TRUNCATED,
} from "./playtest-copy.ts";

/**
 * Inspector for playtests: the same record as web, presented for a narrow screen.
 *
 * The meaning of the record lives in one place (`@rowcat/chat`'s `debug-trace.ts` and
 * `debug-view.ts`). This file owns only the layout: which pane holds what, what collapses, and what
 * is shown first. If both apps carried their own copy of those rules, they would drift in fixed
 * directions: one side might present an estimated token count as if the provider had reported it,
 * or silently swap a vanished turn for a different one.
 *
 * ## The container is `Dialog size="full"`
 *
 * The content is the full prompt and an event list, which does not fit in a centered box. It is not
 * a sheet, because this interaction cannot answer whether rising from the bottom earns its place
 * (see the presentation table in `docs/design/ARCHITECTURE.md`). The condition dialog made the same
 * call.
 *
 * ## Panes and turns are `Select`, not web's tabs
 *
 * Five panes laid out horizontally would clip their names on a narrow screen, and the turn list
 * grows. Both are value choices bound to a trigger, so `Select` is the answer in that table.
 *
 * ## There is no `State` pane here
 *
 * This app has no studio, and a playtest of a runtime-enabled draft does **not build a
 * conversation** (`PLAYTEST_RUNTIME` says so and sends the user back to the editor). So there is no
 * runtime state to draw. The absence is not something left unbuilt; this app simply has no such
 * branch.
 */

/** The panes this app can answer. `state` is dropped for the reason in the header. */
const MOBILE_TABS = PLAYTEST_DEBUG_TABS.filter((tab) => tab !== "state");

function CopyButton({ value, noun }: { value: string; noun: string }) {
	const copy = useCopyMessage(value, noun);
	return (
		<IconButton
			icon={copy.state === "copied" ? "check" : "copy"}
			label={copy.label}
			onPress={copy.copy}
		/>
	);
}

/** A name and value on one line. Shows `—` when there is no value; never filled with 0. */
function Field({
	label,
	value,
	hint,
}: {
	label: string;
	value: string | null;
	/** Short cue beside the value (`Estimated`, `Provider-reported`). */
	hint?: string;
}) {
	return (
		<View style={style.field}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
			<View style={style.fieldValue}>
				<Text variant="label">{value ?? "—"}</Text>
				{hint ? <Badge variant="outline" label={hint} /> : null}
			</View>
		</View>
	);
}

/**
 * Raw text block: collapsible and copyable.
 *
 * Expansion is deliberately not remembered. The state here does not persist anything, so the next
 * selection starts collapsed, which is correct: a new value should first show its summary.
 */
function CodeBlock({
	label,
	value,
	noun = "value",
}: {
	label?: ReactNode;
	value: string;
	noun?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const clipped = expanded || value.length <= 400;
	return (
		<View style={style.code}>
			<View style={style.codeHead}>
				{label ? (
					<Text variant="caption" style={style.codeLabel}>
						{label}
					</Text>
				) : null}
				<IconButton
					icon={expanded ? "chevron-up" : "chevron-down"}
					label={
						expanded ? PLAYTEST_DEBUGGER.collapse : PLAYTEST_DEBUGGER.expand
					}
					onPress={() => setExpanded((open) => !open)}
				/>
				<CopyButton value={value} noun={noun} />
			</View>
			<Text variant="caption" tone="muted-foreground" style={style.codeBody}>
				{clipped ? value : `${value.slice(0, 400)}…`}
			</Text>
		</View>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<View style={style.section}>
			<Text variant="caption" tone="muted-foreground">
				{title}
			</Text>
			{children}
		</View>
	);
}

function TokenField({
	label,
	reading,
}: {
	label: string;
	reading: TokenReading | null;
}) {
	if (reading === null) return <Field label={label} value={null} />;
	return (
		<Field
			label={label}
			value={formatCount(reading.value)}
			hint={
				reading.source === "provider"
					? PLAYTEST_DEBUGGER.exact
					: PLAYTEST_DEBUGGER.estimated
			}
		/>
	);
}

function PromptPane({ turn }: { turn: ConversationTurnRecord }) {
	if (turn.prompt === null || turn.request === null)
		return (
			<EmptyState
				title={DEBUG_NO_PROMPT_COPY.title}
				description={DEBUG_NO_PROMPT_COPY.body}
			/>
		);
	return (
		<View>
			{turn.truncated ? (
				<Notice tone="muted" message={PLAYTEST_DEBUGGER_TRUNCATED} />
			) : null}
			<Section title={PLAYTEST_DEBUGGER.systemPrompt}>
				{turn.prompt.blocks.map((block) => (
					<CodeBlock
						key={block.id}
						noun={PLAYTEST_DEBUGGER.blockNoun}
						label={CHAT_PROMPT_BLOCK_LABEL[block.id]}
						value={block.text}
					/>
				))}
			</Section>
			<Separator />
			<Section title={PLAYTEST_DEBUGGER.messages}>
				{turn.request.messages.map((message, index) => (
					<CodeBlock
						// biome-ignore lint/suspicious/noArrayIndexKey: each request is a fixed snapshot, so position is the identity.
						key={index}
						noun={PLAYTEST_DEBUGGER.messageNoun}
						label={`${index} · ${message.role}`}
						value={message.content}
					/>
				))}
			</Section>
		</View>
	);
}

const LORE_REASON_LABEL: Record<ChatLoreDecision["reason"], string> = {
	constant: "Always",
	"key-match": "Key matched",
	"no-key-match": "No key matched",
	"no-keys": "No keys (never matches)",
	"empty-content": "Empty body",
};

function LorePane({ turn }: { turn: ConversationTurnRecord }) {
	if (turn.prompt === null)
		return (
			<EmptyState
				title={DEBUG_NO_PROMPT_COPY.title}
				description={DEBUG_NO_PROMPT_COPY.body}
			/>
		);
	if (turn.prompt.lore.length === 0)
		return (
			<EmptyState
				title={PLAYTEST_DEBUGGER.noLoreTitle}
				description={PLAYTEST_DEBUGGER.noLoreBody}
			/>
		);
	return (
		<View>
			<Section title={PLAYTEST_DEBUGGER.scanText}>
				<CodeBlock
					noun={PLAYTEST_DEBUGGER.scanNoun}
					value={turn.prompt.loreScanText || PLAYTEST_DEBUGGER.emptyValue}
				/>
			</Section>
			<Separator />
			{turn.prompt.lore.map((decision) => (
				<View key={decision.id} style={style.loreRow}>
					<View style={style.loreHead}>
						<Badge
							variant={decision.active ? "default" : "outline"}
							label={
								decision.active
									? PLAYTEST_DEBUGGER.loreActive
									: PLAYTEST_DEBUGGER.loreInactive
							}
						/>
						<Text variant="label" style={style.loreKeys}>
							{decision.keys.length > 0
								? decision.keys.join(" · ")
								: PLAYTEST_DEBUGGER.noKeys}
						</Text>
					</View>
					<Text variant="caption" tone="muted-foreground">
						{LORE_REASON_LABEL[decision.reason]}
						{decision.matchedKey === null
							? ""
							: ` · ${PLAYTEST_DEBUGGER.matchedKey} ${decision.matchedKey}`}
						{` · ${formatCount(decision.contentLength)} characters`}
					</Text>
					{decision.content === null ? null : (
						<CodeBlock
							noun={PLAYTEST_DEBUGGER.loreNoun}
							value={decision.content}
						/>
					)}
				</View>
			))}
		</View>
	);
}

function GenerationPane({ turn }: { turn: ConversationTurnRecord }) {
	const duration = turnDurationMs(turn);
	return (
		<View>
			<Section title={PLAYTEST_DEBUGGER.turn}>
				<Field
					label={PLAYTEST_DEBUGGER.status}
					value={TURN_STATUS_LABEL[turn.status]}
				/>
				<Field
					label={PLAYTEST_DEBUGGER.duration}
					value={duration === null ? null : formatDuration(duration)}
				/>
				<Field label={PLAYTEST_DEBUGGER.end} value={turn.end} />
				<Field
					label={PLAYTEST_DEBUGGER.finishReason}
					value={turn.finishReason}
				/>
			</Section>
			<Separator />
			<Section title={PLAYTEST_DEBUGGER.execution}>
				{turn.execution === null ? (
					<Text variant="caption" tone="muted-foreground">
						{PLAYTEST_DEBUGGER.noExecution}
					</Text>
				) : (
					<>
						<Field
							label={PLAYTEST_DEBUGGER.model}
							value={turn.execution.target.model}
						/>
						<Field
							label={PLAYTEST_DEBUGGER.provider}
							value={turn.execution.target.provider}
						/>
						<Field
							label={PLAYTEST_DEBUGGER.reasoning}
							value={turn.execution.reasoningEffort}
						/>
						<Field
							label={PLAYTEST_DEBUGGER.responseLength}
							value={turn.execution.responseLength}
						/>
						<Field
							label={PLAYTEST_DEBUGGER.rating}
							value={
								turn.execution.allAges
									? PLAYTEST_DEBUGGER.allAges
									: PLAYTEST_DEBUGGER.adult
							}
						/>
					</>
				)}
			</Section>
			<Separator />
			<Section title={PLAYTEST_DEBUGGER.size}>
				<Field
					label={PLAYTEST_DEBUGGER.outputCharacters}
					value={
						turn.outputCharacters === null
							? null
							: formatCount(turn.outputCharacters)
					}
				/>
				<TokenField
					label={PLAYTEST_DEBUGGER.inputTokens}
					reading={inputTokenReading(turn)}
				/>
				<TokenField
					label={PLAYTEST_DEBUGGER.outputTokens}
					reading={outputTokenReading(turn)}
				/>
				{cacheReadings(turn.usage).map((reading) => (
					<Field
						key={reading.kind}
						label={
							reading.kind === "read"
								? PLAYTEST_DEBUGGER.cacheRead
								: PLAYTEST_DEBUGGER.cacheWrite
						}
						value={formatCount(reading.value)}
						hint={PLAYTEST_DEBUGGER.exact}
					/>
				))}
			</Section>
			{turn.failure === null ? null : (
				<>
					<Separator />
					<Section title={PLAYTEST_DEBUGGER.failure}>
						<Field
							label={PLAYTEST_DEBUGGER.errorName}
							value={turn.failure.name}
						/>
						<Field
							label={PLAYTEST_DEBUGGER.errorCode}
							value={turn.failure.code}
						/>
						{/*
						 * The provider's raw text never reaches this pane. What is shown is a
						 * sentence chosen by our table (`features/chat/generation/debug.ts`).
						 */}
						<Text variant="caption" tone="muted-foreground">
							{turn.failure.summary}
						</Text>
					</Section>
				</>
			)}
			{turn.discardReason === null ? null : (
				<>
					<Separator />
					<Section title={PLAYTEST_DEBUGGER.notSaved}>
						<Text variant="caption" tone="muted-foreground">
							{DISCARD_REASON_LABEL[turn.discardReason]}
						</Text>
					</Section>
				</>
			)}
		</View>
	);
}

function TimelinePane({ state }: { state: ConversationDebugState }) {
	if (state.log.entries.length === 0)
		return (
			<EmptyState
				title={DEBUG_NO_EVENT_COPY.title}
				description={DEBUG_NO_EVENT_COPY.body}
			/>
		);
	return (
		<View>
			{state.log.dropped > 0 ? (
				<Notice
					tone="muted"
					message={`${PLAYTEST_DEBUGGER.dropped} ${formatCount(state.log.dropped)}`}
				/>
			) : null}
			{/*
			 * Newest first. The sort axis is `id`, not time: several events in the same
			 * millisecond are the normal state of this screen.
			 */}
			{[...state.log.entries].reverse().map((event) => (
				<View key={event.id} style={style.event}>
					<Text variant="label">{event.summary}</Text>
					<Text variant="caption" tone="muted-foreground">
						{event.kind}
					</Text>
				</View>
			))}
		</View>
	);
}

export function PlaytestDebuggerDialog({
	open,
	onOpenChange,
	state,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	state: ConversationDebugState;
}) {
	const [tab, setTab] = useState<PlaytestDebugTab>("prompt");
	const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
	const options = debugTurnOptions(state);
	const { turn, fellBack } = resolveSelectedTurn(state, selectedTurnId);

	const pane =
		turn === null ? (
			<EmptyState
				title={DEBUG_NO_TURN_COPY.title}
				description={DEBUG_NO_TURN_COPY.body}
			/>
		) : tab === "prompt" ? (
			<PromptPane turn={turn} />
		) : tab === "lore" ? (
			<LorePane turn={turn} />
		) : tab === "generation" ? (
			<GenerationPane turn={turn} />
		) : tab === "state" ? (
			<EmptyState
				title={PLAYTEST_DEBUGGER_STATE_UNAVAILABLE.title}
				description={PLAYTEST_DEBUGGER_STATE_UNAVAILABLE.body}
			/>
		) : (
			<TimelinePane state={state} />
		);

	return (
		<Dialog
			title={PLAYTEST_DEBUGGER.title}
			description={PLAYTEST_DEBUGGER.description}
			open={open}
			onOpenChange={onOpenChange}
			size="full"
			scroll
		>
			<View style={style.controls}>
				<Select
					label={PLAYTEST_DEBUGGER.tabLabel}
					value={PLAYTEST_DEBUG_TAB_LABEL[tab]}
				>
					{MOBILE_TABS.map((value) => (
						<SelectOption
							key={value}
							label={PLAYTEST_DEBUG_TAB_LABEL[value]}
							selected={value === tab}
							onSelect={() => setTab(value)}
						/>
					))}
				</Select>
				{tab === "timeline" || options.length === 0 ? null : (
					<Select
						label={PLAYTEST_DEBUGGER.turnLabel}
						value={
							turn === null
								? PLAYTEST_DEBUGGER.noTurnValue
								: `#${turn.index} · ${TURN_STATUS_LABEL[turn.status]}`
						}
					>
						{options.map((option) => (
							<SelectOption
								key={option.turnId}
								label={`${option.label} · ${TURN_STATUS_LABEL[option.status]}`}
								selected={option.turnId === turn?.turnId}
								onSelect={() => setSelectedTurnId(option.turnId)}
							/>
						))}
					</Select>
				)}
			</View>
			{fellBack ? (
				<Notice tone="muted" message={PLAYTEST_DEBUGGER.fellBack} />
			) : null}
			{pane}
		</Dialog>
	);
}

const style = StyleSheet.create({
	controls: { gap: space.sm, paddingBottom: space.md },
	section: { gap: space.xs, paddingVertical: space.sm },
	field: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: space.md,
		paddingVertical: space.xs,
	},
	fieldValue: { flexDirection: "row", alignItems: "center", gap: space.xs },
	code: { gap: space.xs, paddingVertical: space.xs },
	codeHead: { flexDirection: "row", alignItems: "center", gap: space.xs },
	codeLabel: { flex: 1 },
	codeBody: { fontFamily: "monospace" },
	loreRow: { gap: space.xs, paddingVertical: space.sm },
	loreHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
	loreKeys: { flex: 1 },
	event: { gap: space.xs, paddingVertical: space.sm },
});
