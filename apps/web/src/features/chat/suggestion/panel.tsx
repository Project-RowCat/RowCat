import { Button } from "@rowcat/ui-web/components/button";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { Sparkles, X } from "lucide-react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { generationRecovery } from "#/features/conversation/generation-error.ts";
import { GenerationRecoveryActionButton } from "#/features/conversation/generation-recovery-action.tsx";
import { translator } from "#/lib/i18n/current.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { enterTransition } from "#/lib/motion/transitions.ts";
import type { ReplySuggestionState } from "./use-reply-suggestion.ts";

/**
 * The response arrived but was not in a shape usable as suggestions.
 *
 * It is separate from the generic failure sentence ("no reply was received"), which would be false here: a
 * response was received, and on managed it was billed. Pressing again usually fixes it, so retry
 * stays available. Both apps use the same sentence.
 */
const malformedSuggestionMessage = (): string =>
	translator("chat")("suggestion.malformed");

/**
 * Reply suggestions: a layer directly above the composer.
 *
 * It sits where the failure notice and "continue generating" sit, for the same reason: it answers
 * the action the user just took, and the chosen sentence goes straight into the composer below.
 * Lifting it to a global toast would separate it from that composer.
 *
 * Picking a sentence fills the composer; it does not send. Sending on pick would make a
 * model-written sentence the user's own utterance before they read it, and turn one press into two
 * paid calls. This component's only action is `onPick`; `send` is not here.
 *
 * The list does not get notice chrome. The failure notice uses a left accent bar and a faint wash,
 * and that chrome means "a notice about this one action" (see the failure and continue rows in
 * `chat-page.tsx`). A list of three choices is not a notice. Putting three sentence boxes inside a
 * notice box also made two nested surfaces in the same spot, the shape this repository already
 * removed from the composer (a rule in `composer.tsx` against boxes inside boxes).
 *
 * There is no outer surface now. The only elements are a one-line header and three sentences,
 * grouped by spacing and type hierarchy. Only the failure keeps notice chrome, because it really is
 * a notice.
 *
 * It only enters and never exits. An exit would keep the composer pressed down by this height after
 * a choice, arriving late, and on a hidden tab that state would last indefinitely
 * (`docs/motion/ARCHITECTURE.md`). Since buttons live inside, immediate unmount also protects
 * against presses during exit; there is no exit frame, so `useExitGuard()` has no window to guard.
 *
 * This component knows nothing of storage, transport, or providers. State comes from the hook, and
 * wording comes from the existing failure table (`generation-error.ts`), the same table
 * conversation failures use: no connection leads the user to the same place whichever request
 * produced it.
 */
export function ReplySuggestionPanel({
	state,
	onRequest,
	onPick,
	onDismiss,
}: {
	state: ReplySuggestionState;
	onRequest: () => void;
	/** Fills the composer with the chosen sentence; does not send. */
	onPick: (text: string) => void;
	onDismiss: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	if (state.status === "failed") {
		/**
		 * `unanswered` is always true here: the action the user pressed has not produced an answer.
		 * Whether pressing again can fix it is decided by the failure table (`canRetryGeneration`).
		 *
		 * `continuable` is false. The failed action is the suggestion request, and continuing is a
		 * conversation action; passing true would show a "continue conversation" button where the
		 * suggestion failed.
		 *
		 * `stopped` is false too. Stopping belongs to the conversation turn axis, and a suggestion
		 * request has no such action. This branch is inside `state.status === "failed"`, so there is
		 * always a failure, and the stopped branch never reads this value.
		 */
		const recovery = generationRecovery({
			error: state.error,
			unanswered: true,
			continuable: false,
			stopped: false,
		});
		if (!recovery) return null;
		return (
			<m.div
				key="reply-suggestion-failed"
				role="alert"
				/*
				 * Same geometry as the failure notice (left accent bar + faint wash). It really is a notice,
				 * and two sentences in the same spot must not read at different severities. It says only that
				 * this one action did not succeed.
				 */
				className="mb-2 flex shrink-0 items-center gap-3 rounded-r-lg border-destructive/70 border-l-2 bg-destructive/8 py-2.5 pr-2 pl-3 text-sm"
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				transition={enterTransition}
			>
				<span className="min-w-0 flex-1 text-destructive">
					{state.malformed ? malformedSuggestionMessage() : recovery.message}
				</span>
				{/*
				 * The recovery path is the same table conversation failures use (`generationRecovery`).
				 * If this request drew its own path, the same failure would send the user to different places
				 * depending on where it came from.
				 *
				 * Only the wording differs. What is re-sent here is this suggestion request, not the
				 * conversation, so `Regenerate` would make the user read it as regenerating the conversation.
				 */}
				<GenerationRecoveryActionButton
					action={recovery.action}
					onRetry={onRequest}
					retryLabel={t("common:actions.retry")}
				/>
				<DismissButton onDismiss={onDismiss} />
			</m.div>
		);
	}

	if (state.status === "ready")
		return (
			<m.div
				key="reply-suggestion-ready"
				className="mb-2 flex shrink-0 flex-col gap-2"
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				transition={enterTransition}
			>
				{/*
				 * One header line. This line groups the list, not a box. It states the name and the function
				 * together, so nothing below needs explaining, and the old note under the list that wrapped to
				 * two lines on narrow screens is gone.
				 *
				 * The point is what it does not promise. It does not say that picking sends, or what it costs:
				 * the first is not true, and the second depends on this device's settings (managed or BYO),
				 * which we cannot assert.
				 */}
				<div className="flex items-center gap-2 pr-1 pl-3.5">
					{/*
					 * The left inset equals the text start of the rows below (`px-3.5`). Without a box,
					 * alignment is the only grouping device, and any mismatch shows immediately.
					 *
					 * No glyph here: the trigger already carries that icon, and drawing it again on the list
					 * would blur what it refers to.
					 */}
					<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
						{t("panel.suggestedRepliesPickingOneFills")}
					</span>
					<DismissButton onDismiss={onDismiss} />
				</div>
				{/*
				 * A list. With a name on the `<ul>`, screen-reader users hear the item count together with the
				 * name, so the three buttons read as one choice rather than three separate actions.
				 */}
				<ul
					aria-label={t("panel.suggestedReplies")}
					className="flex min-w-0 flex-col gap-1.5"
				>
					{state.suggestions.map((suggestion) => (
						<li key={suggestion} className="flex">
							<button
								type="button"
								onClick={() => onPick(suggestion)}
								/*
								 * Left-aligned, and wraps rather than truncating. Cutting to one line with `…` makes the
								 * user press without knowing what they are choosing, and they read the full text only after
								 * it is filled.
								 *
								 * The radius follows the composer family (the surface is `rounded-2xl`, and the buttons
								 * inside it are `rounded-xl`). These rows sit directly above that surface, so without the
								 * same family this spot would look like a different product.
								 */
								className="flex-1 rounded-xl border border-border/70 bg-muted/50 px-3.5 py-2.5 text-left text-sm leading-relaxed transition-[background-color,border-color] hover:border-ring/70 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
							>
								{suggestion}
							</button>
						</li>
					))}
				</ul>
			</m.div>
		);

	/*
	 * The idle and loading states are the **same button**. Two separate elements would unmount the
	 * target on press and make it vanish under the finger or focus; the composer's send and stop
	 * buttons made the same decision long ago.
	 *
	 * The border says this spot is something to press. As a ghost button it would be a faint label
	 * floating above the composer, with no way to tell whether it is a label or an action. It is not a
	 * pill: the radius family is the composer's (`composer.tsx`).
	 */
	const loading = state.status === "loading";
	return (
		<div className="mb-2 flex shrink-0 justify-start">
			<Button
				size="sm"
				variant="outline"
				className="h-8 gap-1.5 rounded-xl border-border/70 bg-card px-2.5 font-normal text-muted-foreground text-xs hover:border-ring/70 hover:text-foreground disabled:opacity-75"
				disabled={loading}
				onClick={onRequest}
			>
				<AnimatedIconSwap stateKey={loading ? "loading" : "idle"}>
					{loading ? (
						<Spinner className="size-3.5" />
					) : (
						<Sparkles aria-hidden="true" className="size-3.5" />
					)}
				</AnimatedIconSwap>
				{/*
				 * The accessible name changes in the same render as the state. No separate `aria-live` is needed
				 * because the button itself holds focus, so a changed name is read out directly.
				 */}
				{loading ? t("panel.choosingASuggestion") : t("panel.suggestedReplies")}
			</Button>
		</div>
	);
}

/** The dismiss action: the name is text, the target is icon-sized. */
function DismissButton({ onDismiss }: { onDismiss: () => void }) {
	const { t } = useTranslation(["chat", "common"]);
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			aria-label={t("panel.closeSuggestedReplies")}
			className="shrink-0 text-muted-foreground"
			onClick={onDismiss}
		>
			<X aria-hidden="true" className="size-4" />
		</Button>
	);
}
