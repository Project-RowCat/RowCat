import type { Story } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import { Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	isShareAbort,
	storyShareCopied,
	storyShareFailure,
	storyShareLabel,
	storySharePayload,
} from "./share-story.ts";

/**
 * The work share trigger. It passes one canonical address and nothing else.
 *
 * - Targets are not listed. The screen does not draw a list of social platforms. Where to send
 *   something is known to the device (installed apps, recent contacts, system settings), and a
 *   hand-built list would always be narrower than the real one and would need updating as trends
 *   change. Only browser capabilities are used: `navigator.share` (the system share sheet, the
 *   canonical path on mobile) and the clipboard (the canonical path on desktop).
 * - Order is the rule. If the sheet is available, copying alone would leave the user to find the
 *   destination. If there is no sheet, skipping the copy would make the button do nothing.
 * - The component does not judge. A pure function (`share-story.ts`) decides what can be shared
 *   and what is included. This component only wires that value to the browser and shows a one-line
 *   result. If the work cannot be shared, nothing is drawn: a disabled button would not say why,
 *   and the user could not act on it (exporting a private work is a `Create` action).
 * - It does not compete with the primary action. It is an icon without a label. The action this
 *   screen recommends is `Start conversation` (`story-start-control.tsx`). Share sits in the second row at the
 *   same weight as favorite and report. A filled button would make the screen look as if it offers
 *   two primary actions.
 * - Results stay in place. Neither success nor failure is a toast. The toast layer has no success
 *   toasts (`lib/toast.ts`). Failure stays inline because the pressed button remains on screen
 *   (`docs/design/FAILURE-FEEDBACK.md`). Navigating to another work remounts this component, so the
 *   line clears on its own.
 */
export function StoryShareControl({ story }: { story: Story }) {
	/**
	 * The origin is set after mount, not during render.
	 *
	 * The server having no `window` is not enough by itself. Deciding during render makes the server
	 * tree differ from the first client tree of hydration. The browser already has `window` at first
	 * render, so the control would appear immediately, while the markup it received does not contain
	 * it. React may warn, but the mismatch exists either way.
	 *
	 * The server render and the first client render both see origin = null, so neither draws the
	 * control. After mount the origin is set and the control appears.
	 *
	 * The effect runs after this component commits, which is after its subtree has hydrated. An
	 * app-wide flag cannot align this point: code-split route bodies hydrate after the root commits,
	 * so the flag would already be set by then (see the header of `lib/motion/page-transition.tsx` for
	 * the same trap).
	 *
	 * A one-frame delay before the control appears is accepted. It is a secondary control, so nothing
	 * shifts in the meantime, and the primary action is present from the first HTML.
	 */
	const [origin, setOrigin] = useState<string | null>(null);
	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);
	const payload = storySharePayload(story, origin);
	/**
	 * The result line is local component state. It is in neither the query cache nor global state.
	 * Navigating to another work remounts the component, so the line clears on its own.
	 */
	const [result, setResult] = useState<"copied" | "failed" | null>(null);

	const share = useCallback(async () => {
		if (!payload) return;
		setResult(null);
		try {
			/**
			 * `title` and `url` are passed in the shape the browser expects. Joining them into one string
			 * would remove the receiving app's preview card (mobile made the same call).
			 */
			if (navigator.share) {
				await navigator.share({ title: payload.title, url: payload.url });
				/**
				 * Opening the sheet ends the action. The browser does not report which target was chosen, and
				 * even if it did, reporting it is not our job: the user has just seen what they did.
				 */
				return;
			}
			await navigator.clipboard.writeText(payload.url);
			setResult("copied");
		} catch (error) {
			/**
			 * Dismissing the share sheet is not a failure, so nothing is shown. `navigator.share` rejects on
			 * cancel too. Without this check, the user would see `Couldn't share` after changing their mind.
			 */
			if (isShareAbort(error)) return;
			setResult("failed");
		}
	}, [payload]);

	if (!payload) return null;

	return (
		<div className="flex items-center gap-2">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label={storyShareLabel()}
				onClick={() => void share()}
			>
				<Share2 aria-hidden="true" />
			</Button>
			{/*
			 * Success and failure appear in the same place. If they appeared in different places, where the eye
			 * lands after pressing would depend on the outcome.
			 *
			 * The weight differs. Confirmation that the link was copied is a `status` message (`<output>`).
			 * Failure is a rejection of the action the user just took, so it is `alert`. Mobile makes the same
			 * split.
			 */}
			{result === "copied" && (
				<output className="text-xs text-muted-foreground">
					{storyShareCopied()}
				</output>
			)}
			{result === "failed" && (
				<p role="alert" className="text-xs text-destructive">
					{storyShareFailure()}
				</p>
			)}
		</div>
	);
}
