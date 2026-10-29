import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type CopyNoun,
	useCopyMessage,
} from "#/features/conversation/use-copy-message.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";

/**
 * Debugger pieces are in a developer-tool style, not a dashboard. No cards, shadows or gradients.
 * What is here is names and values, a collapsible raw-text block and a copy button; the rest is
 * done by type hierarchy and spacing (the studio's bottom panel made the same call).
 */

/** A name-and-value row. Shows `—` when the value is missing; never filled with 0. */
export function DebugField({
	label,
	children,
	hint,
}: {
	label: string;
	children: ReactNode;
	/**
	 * A short qualifier beside a value: `Estimated` for estimated, `Provider-reported` for provider-reported. Not drawn
	 * when absent.
	 */
	hint?: ReactNode;
}) {
	return (
		<div className="flex items-baseline justify-between gap-4 py-1">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			<span className="flex min-w-0 items-baseline gap-1.5 text-right font-mono text-xs">
				<span className="min-w-0 truncate">{children}</span>
				{hint}
			</span>
		</div>
	);
}

/**
 * A source badge, so exact and estimated numbers do not look alike. Color alone is not used, since
 * that difference reads only by eye; the word itself states the fact.
 */
export function DebugHint({
	tone = "muted",
	children,
}: {
	tone?: "muted" | "warn";
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
				tone === "warn"
					? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
					: "bg-muted text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}

/** The value is absent. This is neither an empty string nor zero. */
export const DebugUnknown = () => (
	<span className="text-muted-foreground">—</span>
);

function CopyValueButton({ value, noun }: { value: string; noun: CopyNoun }) {
	const copy = useCopyMessage(value, noun);
	const copied = copy.state === "copied";
	return (
		<>
			<output className="sr-only left-0">{copy.announcement}</output>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={copy.label}
				title={copy.label}
				onClick={copy.copy}
				className="shrink-0 text-muted-foreground/70 hover:text-foreground"
			>
				<AnimatedIconSwap stateKey={copied ? "copied" : "idle"} quiet={!copied}>
					{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
				</AnimatedIconSwap>
			</Button>
		</>
	);
}

/** Blocks taller than this are collapsed. Expansion comes only from a user action. */
const COLLAPSED_HEIGHT = "max-h-40";

/**
 * A raw-text block: fixed-width, collapsible, copyable. Collapsing is by height, not character
 * count. Prompt blocks vary in length, and the question the screen must answer, whether this is
 * fully visible now, depends on pixels. Expanded state is deliberately not remembered. Selecting
 * another turn starts collapsed, because a new value should first show its summary.
 */
export function DebugCode({
	value,
	noun = "value",
	label,
}: {
	value: string;
	noun?: CopyNoun;
	label?: ReactNode;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1">
				{label !== undefined && (
					<span className="min-w-0 flex-1 truncate text-xs font-medium">
						{label}
					</span>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
					aria-expanded={expanded}
					onClick={() => setExpanded((open) => !open)}
				>
					{expanded ? (
						<ChevronDown className="size-3" aria-hidden="true" />
					) : (
						<ChevronRight className="size-3" aria-hidden="true" />
					)}
					{expanded
						? t("debugPrimitives.collapse")
						: t("debugPrimitives.expand")}
				</Button>
				<CopyValueButton value={value} noun={noun} />
			</div>
			{/*
			 * Wide text scrolls inside this box. If the page scrolled sideways, the whole panel's layout would
			 * shift.
			 */}
			<pre
				className={cn(
					"mt-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed",
					expanded ? "max-h-[60vh]" : COLLAPSED_HEIGHT,
				)}
			>
				{value}
			</pre>
		</div>
	);
}

/** Says why a slot is empty, not just that nothing exists yet. */
export function DebugEmpty({ title, body }: { title: string; body: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
			<p className="text-sm font-medium">{title}</p>
			<p className="max-w-md text-xs text-muted-foreground">{body}</p>
		</div>
	);
}

export function DebugSection({
	title,
	trailing,
	children,
}: {
	title: string;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="border-t py-2 first:border-t-0 first:pt-0">
			<div className="flex items-baseline justify-between gap-2 pb-1">
				<h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{title}
				</h3>
				{trailing}
			</div>
			{children}
		</section>
	);
}
