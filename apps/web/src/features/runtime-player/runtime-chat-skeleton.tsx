import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import {
	RUNTIME_CANVAS_COLUMN,
	RUNTIME_CANVAS_FRAME,
} from "./runtime-canvas.ts";

/**
 * Placeholder for the runtime player, and the only body the server renders. It deliberately does
 * not reuse the chat room skeleton (features/chat/chat-skeleton.tsx). That skeleton promises that
 * assistant prose, user bubbles and an input bar will fill in, which would be false here. Only the
 * geometry is reproduced: the canvas box keeps the same position, width and corner radius as the
 * live screen, so the outer layout stays still across the four steps from server HTML to VM mount
 * (§61). The box interior stays empty because the server cannot know what the creator's screen
 * looks like.
 */
export function RuntimeChatSkeleton() {
	return (
		<div className={RUNTIME_CANVAS_COLUMN} aria-hidden="true">
			<Skeleton className={`${RUNTIME_CANVAS_FRAME} min-h-0 flex-1`} />
		</div>
	);
}
