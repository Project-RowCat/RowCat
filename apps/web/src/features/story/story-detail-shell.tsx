import type { ReactNode } from "react";
import { Canvas } from "#/components/app-shell/canvas.tsx";
import { StoryReturnLink } from "./story-return.tsx";

/**
 * Shell for every detail state (work, placeholder, error). The header and back link must never
 * disappear: the detail screen can be opened directly by URL, where there may be no history to go
 * back to, and without the link the user would have to edit the address.
 *
 * The back link sits outside PageEnter, which wraps only the per-state body, so it stays still
 * while the placeholder turns into the work. Where it leads is decided in story-return.tsx.
 */
export function StoryDetailShell({ children }: { children: ReactNode }) {
	return (
		<Canvas>
			<StoryReturnLink />
			<div className="mt-6">{children}</div>
		</Canvas>
	);
}

/**
 * Cover and body columns. Works and placeholders share this geometry so the layout does not jump
 * when data arrives.
 *
 * On desktop the cover is capped at 20rem (320px). The detail screen is about the information, not
 * the cover; a wider cover would push the title, description, and tags below the fold.
 */
export const STORY_DETAIL_LAYOUT_CLASS =
	"flex flex-col gap-8 md:flex-row md:gap-10";

/**
 * The narrow-screen cap is set low on purpose. A 3:4 cover at 256px wide is 341px tall, which
 * together with the header would leave the title and `Start conversation` below the scroll. Going smaller would
 * erase the cover, so the cap stops where the cover takes about half the height.
 */
export const STORY_COVER_COLUMN_CLASS =
	"mx-auto w-full max-w-48 shrink-0 sm:max-w-56 md:mx-0 md:w-72 md:max-w-none lg:w-80";
