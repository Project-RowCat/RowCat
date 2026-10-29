import { VISUAL_LAB_MOTION } from "@rowcat/design/visual-lab";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { labelSwapIn, labelSwapOut } from "#/lib/motion/label-swap.ts";

/**
 * Motion QA lab, meant to sit beside the native lab. Case names, words, and intervals match native
 * (`@rowcat/design/visual-lab`). Matching intervals matter: a cut-off transition is an event
 * defined by its interval, so two apps using different intervals record different events.
 *
 * Web is the reference. Parity is always measured against web, so this screen must show what web
 * does. That behavior is `mode="wait"` and `AnimatePresence` themselves: the frame the library
 * draws is the reference, not a value chosen here.
 *
 * Rhythm is borrowed; rendering is local. Web has no `AnimatedLabel` or `FeedbackLine` wrapper
 * (`label-swap.ts` and `feedback.ts` export only value sets; the boundary rationale is in their
 * headers). So this lab builds the shape a product consumer uses: `AnimatePresence mode="wait"`
 * plus a word, and a sentence as the last flow child. If the lab wrote its own rhythm values, this
 * screen would prove nothing.
 */
export function MotionLab() {
	const { labels } = VISUAL_LAB_MOTION;
	const [label, setLabel] = useState<string>(labels.a);
	const [feedback, setFeedback] = useState(false);

	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(
		() => () => {
			for (const timer of timers.current) clearTimeout(timer);
			timers.current = [];
		},
		[],
	);

	/**
	 * Sets the previous value first, then the next value after a fixed delay, matching native's order.
	 * Scheduling both with one timer would make the gap depend on the scheduler.
	 */
	const interrupt = (next: string, delay: number) => {
		setLabel(labels.b);
		timers.current.push(setTimeout(() => setLabel(next), delay));
	};

	return (
		<div className="flex flex-col gap-2">
			<h3 className="text-xs text-muted-foreground">AnimatedLabel</h3>
			{/** A fixed glyph sits beside the word. When the word's width changes, this glyph moves too. */}
			<div className="flex items-center gap-2">
				<AnimatePresence initial={false} mode="wait">
					<m.span
						key={label}
						initial={labelSwapIn.initial}
						animate={labelSwapIn.animate}
						exit={labelSwapOut}
						transition={labelSwapIn.transition}
						className="inline-flex"
					>
						<Badge variant="secondary">{label}</Badge>
					</m.span>
				</AnimatePresence>
				<span className="text-xs text-muted-foreground">
					{VISUAL_LAB_MOTION.feedbackSibling}
				</span>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" size="sm" onClick={() => setLabel(labels.a)}>
					{labels.a}
				</Button>
				<Button variant="outline" size="sm" onClick={() => setLabel(labels.b)}>
					{labels.b}
				</Button>
				<Button variant="outline" size="sm" onClick={() => setLabel(labels.c)}>
					{labels.c}
				</Button>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => interrupt(labels.a, VISUAL_LAB_MOTION.interruptMs)}
				>
					rapid B→A
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => interrupt(labels.c, VISUAL_LAB_MOTION.interruptMs)}
				>
					rapid B→C
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => interrupt(labels.c, VISUAL_LAB_MOTION.lateInterruptMs)}
				>
					late B→C
				</Button>
			</div>

			<h3 className="text-xs text-muted-foreground">FeedbackLine</h3>
			{/**
			 * The sentence and the sibling below it share one vertical flow. An exit's timing is observed
			 * only by when this sibling moves up; opacity alone looks the same on both platforms.
			 */}
			<div className="flex flex-col">
				<AnimatePresence>
					{feedback && (
						<m.p
							initial={feedbackEnter.initial}
							animate={feedbackEnter.animate}
							exit={feedbackExit}
							transition={feedbackEnter.transition}
							className="text-sm text-destructive"
						>
							{VISUAL_LAB_MOTION.feedback}
						</m.p>
					)}
				</AnimatePresence>
				<p className="text-sm">{VISUAL_LAB_MOTION.feedbackSibling}</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" size="sm" onClick={() => setFeedback(true)}>
					show
				</Button>
				<Button variant="outline" size="sm" onClick={() => setFeedback(false)}>
					hide
				</Button>
			</div>
		</div>
	);
}
