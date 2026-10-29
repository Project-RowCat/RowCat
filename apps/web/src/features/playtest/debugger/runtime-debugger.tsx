import type { PlaytestDebugTab } from "@rowcat/chat";
import { useTranslation } from "react-i18next";
import type { RuntimeDebugState } from "#/features/runtime-preview/runtime-preview-debug.ts";
import { PlaytestDebugger } from "./playtest-debugger.tsx";
import { RuntimeStateTab } from "./state-tab.tsx";
import { runtimeTimelineRows } from "./timeline-rows.ts";
import { TimelineTab } from "./timeline-tab.tsx";

/**
 * The runtime lane's debugger: state and timeline. The other three panes stand but say why they are
 * absent (playtestDebugTabUnavailable). Runtime stories do not assemble conversation prompts.
 * That absence is a decision not to build, not an unfinished feature: playback does not create a
 * room, so there is nowhere for a prompt or lore to be recorded. Timeline rows are not pressable in
 * this lane, because there are no turns. A button with nothing to press would do nothing when
 * clicked.
 */
export function RuntimeDebugger({
	id,
	state,
	tab,
	onTabChange,
	running,
	onClose,
}: {
	id: string;
	state: RuntimeDebugState;
	tab: PlaytestDebugTab;
	onTabChange: (tab: PlaytestDebugTab) => void;
	/** Whether the session is running. It decides the empty state of the `State` pane. */
	running: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<PlaytestDebugger
			id={id}
			lane="runtime"
			tab={tab}
			onTabChange={onTabChange}
			onClose={onClose}
			panes={{
				state: (
					<RuntimeStateTab
						story={state.story}
						persistent={state.persistent}
						running={running}
					/>
				),
				timeline: (
					<TimelineTab
						rows={runtimeTimelineRows(state.log.entries)}
						dropped={state.log.dropped}
						selectedTurnId={null}
						empty={{
							title: t("runtimeDebugger.noEventsRecordedYet"),
							body: t("runtimeDebugger.pressRunAndFromThe"),
						}}
					/>
				),
			}}
		/>
	);
}
