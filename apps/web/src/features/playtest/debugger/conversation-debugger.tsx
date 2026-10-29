import {
	type ConversationDebugState,
	debugTurnOptions,
	type PlaytestDebugTab,
	resolveSelectedTurn,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useTranslation } from "react-i18next";
import { GenerationTab, LoreTab, PromptTab } from "./conversation-tabs.tsx";
import {
	debugNoEventCopy,
	debugNoTurnCopy,
	turnStatusLabel,
} from "./debug-copy.ts";
import { DebugEmpty } from "./debug-primitives.tsx";
import { PlaytestDebugger } from "./playtest-debugger.tsx";
import { conversationTimelineRows } from "./timeline-rows.ts";
import { TimelineTab } from "./timeline-tab.tsx";

/**
 * The conversation lane's debugger: pick a turn, then draw that turn. The selected turn is the axis
 * of the whole screen, so the selection lives here. If each pane kept its own, viewing turn 3 in
 * Prompt and then opening Generation could show turn 5's model, with no error. The latest turn is
 * the default, and an in-progress turn can be selected too. Selecting only finished turns would
 * make the inspector show the previous turn while a response streams, answering someone who asks
 * about the prompt just sent with another turn's answer.
 */
export function ConversationDebugger({
	id,
	state,
	tab,
	onTabChange,
	selectedTurnId,
	onSelectTurn,
	onClose,
}: {
	id: string;
	state: ConversationDebugState;
	tab: PlaytestDebugTab;
	onTabChange: (tab: PlaytestDebugTab) => void;
	/** null means the latest turn. Once the user picks a turn, that id is set. */
	selectedTurnId: string | null;
	onSelectTurn: (turnId: string | null) => void;
	onClose: () => void;
}) {
	const options = debugTurnOptions(state);
	const { turn, fellBack } = resolveSelectedTurn(state, selectedTurnId);

	const empty = <DebugEmpty {...debugNoTurnCopy()} />;

	return (
		<PlaytestDebugger
			id={id}
			lane="conversation"
			tab={tab}
			onTabChange={onTabChange}
			onClose={onClose}
			toolbar={
				options.length > 0 ? (
					/*
					 * The turn picker is a horizontal row of buttons, not a Select. In this list people scan more
					 * than they pick: which turns failed and which were not saved should be visible without
					 * opening a menu.
					 */
					<div className="flex max-w-[60vw] items-center gap-1 overflow-x-auto">
						{options.map((option) => {
							const active = turn?.turnId === option.turnId;
							return (
								<Button
									key={option.turnId}
									size="sm"
									variant="ghost"
									aria-pressed={active}
									className={cn(
										"h-7 shrink-0 px-2 text-[11px]",
										active && "bg-muted text-foreground",
									)}
									onClick={() => onSelectTurn(option.turnId)}
								>
									{option.label}
									<span className="text-muted-foreground">
										{turnStatusLabel(option.status)}
									</span>
								</Button>
							);
						})}
					</div>
				) : undefined
			}
			panes={{
				prompt: turn ? (
					<>
						{fellBack && <FellBackNotice />}
						<PromptTab turn={turn} />
					</>
				) : (
					empty
				),
				lore: turn ? <LoreTab turn={turn} /> : empty,
				generation: turn ? <GenerationTab turn={turn} /> : empty,
				timeline: (
					<TimelineTab
						rows={conversationTimelineRows(state.log.entries)}
						dropped={state.log.dropped}
						selectedTurnId={turn?.turnId ?? null}
						onSelectTurn={onSelectTurn}
						empty={debugNoEventCopy()}
					/>
				),
			}}
		/>
	);
}

/**
 * The selected turn is gone (it fell outside the retained window). Do not drop it silently. Keeping
 * it would draw an empty pane while the list shows another row as selected. Falling back to the
 * latest turn is correct, and a line states that this happened.
 */
function FellBackNotice() {
	const { t } = useTranslation("playtest");
	return (
		<p className="mb-1 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
			{t("conversationDebugger.theChosenTurnWasPushed")}
		</p>
	);
}
