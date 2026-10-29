import { Button } from "@rowcat/ui-web/components/button";
import { Volume2 } from "lucide-react";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Trusted button shown when autoplay is blocked. The same button serves preview and product
 * playback.
 * - Who draws it matters. The creator's code sets `playing`, which only states intent. The
 *   browser refuses playback without a user gesture, the renderer reports `activationRequired`, and
 *   this component draws the button. On press it calls `activateAudio()` synchronously.
 * - The host draws it, not the creator's code. The press never reaches the creator, so the click
 *   does not become a handler id entering the VM. The user is turning sound on, not choosing
 *   something in the story.
 * - The creator cannot build it. Browser policy lifts only when playback starts synchronously
 *   inside a user gesture. A creator's `onPress` makes a round trip through the VM and scheduler,
 *   so by the time it returns it is no longer a gesture.
 * - The creator cannot remove it either. If the only way to enable sound lived inside the work,
 *   any project that did not draw it would leave users unable to turn sound on.
 * - No timer retries. Re-calling `play()` every 200ms cannot get around the policy: it fails, or
 *   occasionally plays sound the user never allowed. The answer is one explicit press.
 * - Disappearance is part of the contract. When `required` becomes false, nothing renders. The
 *   renderer updates that value by observation, so the button removes itself when the node goes
 *   away or playback starts. The screen does not track that moment separately.
 */

/** A function, not a constant: the label follows the locale of the render that draws it. */
export const runtimeAudioActivationLabel = (): string =>
	translator("runtimePlayer")("audio.activate");

export interface RuntimeAudioActivationProps {
	required: boolean;
	/**
	 * Called synchronously on press. Wrapping this prop in an `async` function or deferring it past an
	 * `await` makes the browser stop treating the call as a gesture, and playback is refused again.
	 */
	onActivate: () => void;
}

export function RuntimeAudioActivation({
	required,
	onActivate,
}: RuntimeAudioActivationProps) {
	if (!required) return null;
	return (
		/*
		 * The component floats above the work but is not inside it. A `pointer-events-none` layer, with
		 * only the button receiving events, keeps the overlay from blocking the controls underneath. The
		 * reader must be able to continue the story without turning sound on.
		 */
		<div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
			<Button
				size="sm"
				variant="secondary"
				className="pointer-events-auto shadow-md"
				onClick={onActivate}
			>
				<Volume2 aria-hidden="true" />
				{runtimeAudioActivationLabel()}
			</Button>
		</div>
	);
}
