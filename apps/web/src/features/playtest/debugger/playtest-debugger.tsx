import {
	PLAYTEST_DEBUG_TAB_LABEL,
	PLAYTEST_DEBUG_TABS,
	type PlaytestDebugTab,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@rowcat/ui-web/components/tabs";
import { cn } from "@rowcat/ui-web/lib/utils";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { DebugEmpty } from "./debug-primitives.tsx";
import {
	debugTabApplies,
	type PlaytestDebugLane,
	playtestDebugTabUnavailable,
} from "./debugger-view.ts";

/**
 * The playtest debugger: a shell for five panes, shared by both lanes.
 * - Separate components per lane would keep pane order and names in two places that drift apart,
 *   and the drifted side would be visible only to people using that lane.
 * - Panes are not hidden. Panes absent from a lane still stand, and opening one says why. Hiding
 *   them would make the creator read the pane as not yet built.
 * - Same surface style as the studio: no cards, shadows or gauges.
 * - Height is not interpolated. This surface's height is the conversation list's height, so a
 *   spring open would make the virtualizer re-measure throughout the transition
 *   (docs/motion/ARCHITECTURE.md, 'height animation'). Only opacity and a small translation move,
 *   and pane switches have no motion at all: the active indicator already shows what arrived.
 */
export function PlaytestDebugger({
	id,
	lane,
	tab,
	onTabChange,
	/** The row above the panes. The conversation lane's turn picker goes here. */
	toolbar,
	panes,
	onClose,
}: {
	/** The id that the trigger's aria-controls points to; the toolbar issues it. */
	id: string;
	lane: PlaytestDebugLane;
	tab: PlaytestDebugTab;
	onTabChange: (tab: PlaytestDebugTab) => void;
	toolbar?: ReactNode;
	/**
	 * What to draw in each pane. Panes that are not in this lane are not filled; the shell states the
	 * reason.
	 */
	panes: Partial<Record<PlaytestDebugTab, ReactNode>>;
	onClose: () => void;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<m.section
			id={id}
			aria-label={t("playtestDebugger.testDebugger")}
			className="flex min-h-0 shrink-0 flex-col rounded-lg border bg-card/40"
			initial={{ opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -4, transition: exitTransition }}
			transition={enterTransition}
		>
			<Tabs
				value={tab}
				onValueChange={(next) => onTabChange(next as PlaytestDebugTab)}
				className="min-h-0"
			>
				<div className="flex flex-wrap items-center gap-2 px-2 pt-2">
					<TabsList
						variant="line"
						aria-label={t("playtestDebugger.debuggerPanes")}
					>
						{PLAYTEST_DEBUG_TABS.map((value) => (
							<TabsTrigger
								key={value}
								value={value}
								className={cn(
									"text-xs",
									/*
									 * Panes absent from this lane are dimmed but still pressable. Making them inert would
									 * remove the only way to read why they are absent.
									 */
									!debugTabApplies(value, lane) && "text-muted-foreground/60",
								)}
							>
								{PLAYTEST_DEBUG_TAB_LABEL[value]}
							</TabsTrigger>
						))}
					</TabsList>
					<div className="ms-auto flex items-center gap-2">
						{toolbar}
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-xs"
							onClick={onClose}
						>
							{t("common:actions.close")}
						</Button>
					</div>
				</div>

				{PLAYTEST_DEBUG_TABS.map((value) => {
					const unavailable = playtestDebugTabUnavailable(lane, value);
					return (
						<TabsContent
							key={value}
							value={value}
							/*
							 * Flows vertically only. Raw-text blocks scroll sideways inside their own box (DebugCode),
							 * so this pane does not shift the layout of the whole screen.
							 */
							className="max-h-[48vh] min-h-0 overflow-y-auto px-3 pb-3"
						>
							{debugTabApplies(value, lane) ? (
								(panes[value] ?? null)
							) : unavailable ? (
								<DebugEmpty {...unavailable} />
							) : null}
						</TabsContent>
					);
				})}
			</Tabs>
		</m.section>
	);
}
