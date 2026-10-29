import { formatCount } from "@rowcat/chat";
import { useTranslation } from "react-i18next";
import type {
	RuntimeDurableRow,
	RuntimeDurableView,
} from "#/features/runtime-preview/runtime-preview-debug.ts";
import {
	DebugCode,
	DebugEmpty,
	DebugHint,
	DebugSection,
} from "./debug-primitives.tsx";

/**
 * The `State` pane keeps three lifetimes separate.
 * - useState: this VM session; not shown here (see below)
 * - useStoryState: this episode; cleared by a playthrough reset
 * - usePersistentState: this member's long-term progress in this story; survives a playthrough
 *   reset The two key spaces are not folded into one list. Folding would make it impossible to read
 *   on screen what `Reset play` (playthrough reset) erases. The common misreading would be that
 *   resetting one episode also erases unlocks from several episodes.
 *
 * The absence of useState is a decision, not an omission. Its value lives on the VM heap, not in a
 * storage format, and does not survive the session. A window into it would become a path from the
 * creator's code internals into the host; the studio's bottom panel recorded the same judgment.
 *
 * Pending changes cannot be answered. Uncommitted values never left the VM, and inventing them
 * would make the creator read unsaved progress as saved. So this pane draws only committed values
 * and says so.
 */

function DurableRow({ row }: { row: RuntimeDurableRow }) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<li className="border-t py-2 first:border-t-0">
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span className="font-mono text-xs font-medium">{row.key}</span>
				<span className="text-[11px] text-muted-foreground">
					v{row.version}
				</span>
				{row.changedAtLastCommit && (
					<DebugHint tone="warn">{t("stateTab.justChanged")}</DebugHint>
				)}
			</div>
			<div className="mt-1">
				<DebugCode
					noun="value"
					value={row.text}
					label={t("stateTab.currentValue")}
				/>
			</div>
			{/*
			 * The previous value is the value at this slot's last movement before this session. If it never
			 * moved,
			 * nothing is drawn: a fake previous value on a hydrated value would show a change where nothing
			 * happened.
			 */}
			{row.previous !== null && (
				<div className="mt-1.5">
					<DebugCode
						noun="previousValue"
						value={row.previous}
						label={t("stateTab.valueAtThePreviousCommit")}
					/>
				</div>
			)}
		</li>
	);
}

function DurablePane({
	title,
	note,
	view,
	empty,
}: {
	title: string;
	note: string;
	view: RuntimeDurableView;
	empty: string;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<DebugSection
			title={title}
			trailing={
				<span className="text-[11px] text-muted-foreground">
					{view.hydrated
						? t("debug.stateCount", { count: formatCount(view.rows.length) })
						: t("stateTab.noneYet")}
				</span>
			}
		>
			<p className="pb-1 text-[11px] text-muted-foreground">{note}</p>
			{view.rows.length === 0 ? (
				<p className="py-2 text-xs text-muted-foreground">{empty}</p>
			) : (
				<ul>
					{view.rows.map((row) => (
						<DurableRow key={row.key} row={row} />
					))}
				</ul>
			)}
		</DebugSection>
	);
}

export function RuntimeStateTab({
	story,
	persistent,
	running,
}: {
	story: RuntimeDurableView;
	persistent: RuntimeDurableView;
	/** Whether the session is running. If not, no snapshot arrives to draw. */
	running: boolean;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	if (!story.hydrated && !persistent.hydrated)
		return (
			<DebugEmpty
				title={
					running
						? t("stateTab.noSavedStateHasArrived")
						: t("stateTab.notRunning")
				}
				body={
					running
						? t("stateTab.onceHydrationFinishesItemsDefined")
						: t("stateTab.pressRunAndThisSession")
				}
			/>
		);

	return (
		<div className="flex flex-col gap-1">
			<p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
				{t("stateTab.theValuesHereAreCommitted")}
			</p>
			<DurablePane
				title={t("stateTab.storyStateThisPlaythrough")}
				note={t("stateTab.usestorystateResetPlayEmptiesThis")}
				view={story}
				empty={t("stateTab.thisStoryDoesnTDefine2")}
			/>
			<DurablePane
				title={t("stateTab.persistentStateLongTermProgress")}
				note={t("stateTab.usepersistentstateItSurvivesResetPlay")}
				view={persistent}
				empty={t("stateTab.thisStoryDoesnTDefine")}
			/>
		</div>
	);
}
