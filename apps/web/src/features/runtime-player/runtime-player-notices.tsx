import { Button } from "@rowcat/ui-web/components/button";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { TriangleAlert } from "lucide-react";
import { RUNTIME_PLAYER_COPY } from "./runtime-player-copy.ts";

/**
 * Trusted status lines for the playback screen, which sit outside the creator canvas.
 * - RuntimePlayerProgress: the preparing state. It sits inside the canvas slot because no creator
 *   UI exists yet.
 * - RuntimeSaveNotice: progress is not yet durable. It sits below the canvas so it never covers
 *   the running screen. They live in their own file because runtime-conversation.tsx wires
 *   eligibility, the AI notice, lifecycle and library rows. Markup added there would scatter what
 *   counts as trusted copy among the wiring conditions. No fake progress indicator: no percentage,
 *   step list or skeleton. The four steps (playback response, save read, VM, first commit) cannot
 *   estimate remaining time, and a skeleton promises a shape that will fill in, which is unknowable
 *   because the creator controls the screen (the same reason runtime-chat-skeleton.tsx draws only a
 *   box). A spinner says the only true thing: work is happening.
 */

/**
 * One line for the preparing state: a spinner and a sentence.
 * - It is an `<output>` element, so the sentence is announced when it changes (the element is
 *   role="status").
 * - The spinner has no accessible name, because the adjacent sentence already says what is
 *   awaited. A name would make screen readers announce the same status twice.
 * - Geometry must not shift: the three sentences (loading, syncing, starting) occupy the same spot
 *   and height, so the canvas box never resizes.
 * - Under reduced motion the spinner blinks instead of rotating; the `Spinner` component handles
 *   that rule. An earlier note said the browser stops CSS animations for that preference. That was
 *   wrong: browsers do not stop CSS animations on their own, and this repo has no global rule for
 *   it. The sentence still conveys the state.
 */
export function RuntimePlayerProgress({ label }: { label: string }) {
	return (
		<output className="flex items-center gap-2 text-sm text-muted-foreground">
			<Spinner className="size-4 shrink-0" />
			{label}
		</output>
	);
}

/**
 * Shown when progress could not be saved. The work keeps running.
 * - It sits outside the canvas, which is the surface's whole job (§52). Placed over creator UI,
 *   the sentence could be covered by the creator and would hide the running work. Save failure is
 *   not a runtime failure, so there is no reason to block play.
 * - Visual weight was raised on purpose. An underlined single line was too quiet for the stakes:
 *   a user must know that progress being built is not yet kept, or a whole run disappears on close.
 *   Hence the border and icon.
 * - It is not raised further. No toast, dialog or overlay: a later commit can save successfully
 *   and the line disappears on its own, whereas an undismissable alert would make the user clear a
 *   problem that already fixed itself.
 * - It is role="status" (`<output>`), not alert. An alert would interrupt for a failed action the
 *   user just took, but this is a background write. The element stays mounted with the same text,
 *   so repeated retries are not re-announced.
 */
export function RuntimeSaveNotice({ onRetry }: { onRetry: () => void }) {
	return (
		<output className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
			<TriangleAlert
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 text-destructive"
			/>
			<span className="min-w-0 flex-1">
				<span className="block font-medium text-destructive">
					{RUNTIME_PLAYER_COPY.saveFailed}
				</span>
				<span className="mt-0.5 block text-muted-foreground">
					{RUNTIME_PLAYER_COPY.saveFailedBody}
				</span>
			</span>
			<Button
				size="sm"
				variant="outline"
				className="h-7 shrink-0"
				onClick={onRetry}
			>
				{RUNTIME_PLAYER_COPY.saveRetry}
			</Button>
		</output>
	);
}

/**
 * Creator code threw, and the screen stays as it is (§132). When a render throws the VM commits
 * nothing new, so the last tree remains valid, and clearing it would discard what the atomic commit
 * already delivered. This line therefore sits below the canvas rather than over it. Its weight is
 * lighter than the save notice (no border or icon). A missed save failure can lose a whole run, but
 * here only the one action is lost and the screen stays correct. Drawing both in the same box would
 * make neither readable.
 */
export function RuntimeCreatorErrorNotice({
	onRestart,
}: {
	onRestart: () => void;
}) {
	return (
		<output className="block px-1 pt-2 text-xs text-destructive">
			{RUNTIME_PLAYER_COPY.creatorError}{" "}
			<button
				type="button"
				className="underline underline-offset-2"
				onClick={onRestart}
			>
				{RUNTIME_PLAYER_COPY.retry}
			</button>
		</output>
	);
}
