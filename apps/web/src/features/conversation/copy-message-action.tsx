import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Check, Copy } from "lucide-react";
import { MESSAGE_ACTION_BAR_HEIGHT_PX } from "#/features/chat/chat-geometry.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { useCopyMessage } from "./use-copy-message.ts";

/**
 * A copy-only action row. It has two consumers, and both reach the same conclusion: the line is not
 * a stored record.
 *
 * - Every line of a work test: there is no tail to delete and no server identity to report,
 *   because the work has not been published.
 * - The opening line of a conversation: it is not a record. It is a value that draws the start
 *   scene, so deleting it would just redraw it.
 *
 * The decision that the other four actions (edit, regenerate, delete from here, report) cannot be
 * shown is made by `conversationRowActions` in @rowcat/chat. This file only knows how to draw copy.
 * Keeping policy in the component would make it diverge from mobile.
 */
export function CopyMessageAction({
	content,
	align,
}: {
	content: string;
	/**
	 * Sits on the same side as the message bubble: user messages align end (right), assistant messages
	 * align start (left).
	 */
	align: "start" | "end";
}) {
	const copyState = useCopyMessage(content);
	/**
	 * `failed` shares the idle branch. Failure is conveyed by the label and the live region
	 * (copyState.label and announcement), not by the icon. The conversation screen's copy action makes
	 * the same call.
	 */
	const copied = copyState.state === "copied";

	return (
		<div
			className={cn(
				/*
				 * `relative` keeps the live region below inside this row. Without it, the absolute position of
				 * `sr-only` is computed against an outer container.
				 */
				"relative flex items-center",
				align === "end" ? "justify-end" : "justify-start",
			)}
			style={{ height: MESSAGE_ACTION_BAR_HEIGHT_PX }}
		>
			{/*
			 * The copy result must also reach users who cannot see the screen, since the icon swap is
			 * visual only. `left-0` prevents horizontal scroll: the -1px margin of `sr-only` pokes out of
			 * the row when it is right-aligned.
			 */}
			<output className="sr-only left-0">{copyState.announcement}</output>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={copyState.label}
				title={copyState.label}
				onClick={copyState.copy}
				className="text-muted-foreground/70 hover:text-foreground"
			>
				{/*
				 * The rhythm of the glyph swap matches the same action on the conversation screen. If each
				 * screen set its own, the same copy would arrive differently in the two places, and the
				 * difference is only visible side by side. Wording and size remain per screen.
				 *
				 * Only the revert back is quiet. That is the timer's job, not a reply to the press.
				 */}
				<AnimatedIconSwap stateKey={copied ? "copied" : "idle"} quiet={!copied}>
					{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
				</AnimatedIconSwap>
			</Button>
		</div>
	);
}
