import type { ReactNode } from "react";
import { Canvas } from "#/components/app-shell/canvas.tsx";

/**
 * Skeleton of the chat library: a canvas width that flows like a document.
 *
 * This geometry differs from the chat room shell (`ChatShell`). That one is three columns locked to
 * the screen height; this is a list read from top to bottom, so it uses the window scroll
 * (`shell-route.ts` holds that decision).
 *
 * The title is not placed here, for the same reason as the create-workspace shell: this name only
 * says that the placeholder and the body share the **same frame**. What comes inside is up to the
 * screen.
 *
 * ## Not the app's default width (`max-w-6xl`)
 *
 * Rows here draw only one title and one short timestamp, so at 1152px the gap between them is a
 * hand's width. The eye would have to cross the screen from title to time, and the manage trigger
 * would look like it belongs to another screen. This is where it differs from grid-filling screens
 * such as the gallery, and the notification list made the same decision for the same reason
 * (`notifications-page.tsx`).
 *
 * **The title is bounded too.** Narrowing only the list would leave `Conversations` and the search box
 * starting at a wider position, which gives the left alignment two lines.
 */
export function ChatLibraryShell({ children }: { children: ReactNode }) {
	return (
		<Canvas>
			<div className="mx-auto w-full max-w-4xl">{children}</div>
		</Canvas>
	);
}
