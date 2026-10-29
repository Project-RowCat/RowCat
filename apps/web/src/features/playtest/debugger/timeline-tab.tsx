import { cn } from "@rowcat/ui-web/lib/utils";
import { useTranslation } from "react-i18next";
import { formatNumber } from "#/lib/i18n/format.ts";
import { formatClock } from "./debug-clock.ts";
import { DebugEmpty } from "./debug-primitives.tsx";

/**
 * The timeline: one event is one row. The component branches on `kind`, never on the human sentence
 * (`summary`). This keeps a parser out of the component, so a copy edit cannot silently change
 * color or order. The sort axis is `id`, not time. Several events in the same millisecond are
 * normal here (one commit produces three), and sorting by time would shuffle their order on every
 * run.
 */

/** An event's weight. Color only reinforces the weight; the wording states the fact. */
export type TimelineTone = "normal" | "accent" | "warn" | "danger";

const TONE_CLASS: Record<TimelineTone, string> = {
	normal: "bg-muted-foreground/40",
	accent: "bg-primary",
	warn: "bg-amber-500",
	danger: "bg-destructive",
};

export interface TimelineRow {
	id: number;
	at: number;
	/** The turn this row belongs to. Null for events outside any turn. */
	turnId: string | null;
	kind: string;
	summary: string;
	tone: TimelineTone;
}

export function TimelineTab({
	rows,
	dropped,
	selectedTurnId,
	onSelectTurn,
	empty,
}: {
	rows: TimelineRow[];
	/** Count of events dropped by the cap. Non-zero means the list is not complete. */
	dropped: number;
	selectedTurnId: string | null;
	/** Path to that turn when a row is pressed. Not passed in lanes without turns. */
	onSelectTurn?: (turnId: string) => void;
	empty: { title: string; body: string };
}) {
	const { t } = useTranslation("playtest");
	if (rows.length === 0) return <DebugEmpty {...empty} />;

	return (
		<div className="flex flex-col">
			{dropped > 0 && (
				/* Dropping silently would make the list mislead; the studio console follows the same rule. */
				<p className="mb-1 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
					{t("debug.dropped", { count: formatNumber(dropped) })}
				</p>
			)}
			<ol className="flex flex-col">
				{rows.map((row) => {
					const selected = row.turnId !== null && row.turnId === selectedTurnId;
					const clickable = row.turnId !== null && onSelectTurn !== undefined;
					const body = (
						<>
							<span
								aria-hidden="true"
								className={cn(
									"mt-1.5 size-1.5 shrink-0 rounded-full",
									TONE_CLASS[row.tone],
								)}
							/>
							<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
								{formatClock(row.at)}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block text-xs">{row.summary}</span>
								<span className="block font-mono text-[10px] text-muted-foreground">
									{row.kind}
								</span>
							</span>
						</>
					);
					return (
						<li key={row.id}>
							{clickable ? (
								<button
									type="button"
									onClick={() => onSelectTurn(row.turnId as string)}
									className={cn(
										"flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60",
										selected && "bg-muted",
									)}
								>
									{body}
								</button>
							) : (
								<div className="flex items-start gap-2 px-1.5 py-1">{body}</div>
							)}
						</li>
					);
				})}
			</ol>
		</div>
	);
}
