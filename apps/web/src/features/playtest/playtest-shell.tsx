import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * - A screen-height container, like the chat shell. The record scrolls inside it and the input
 *   stays pinned to the bottom. The overflow decision belongs to the app shell (`viewportLocked` in
 *   components/app-shell/shell-route.ts). Without `min-h-0`, the record grows to its content height
 *   and scrolling leaks to the page.
 * - Does not reuse `ChatShell`: that file belongs to conversation and hardcodes a hidden h1 `Conversations`,
 *   which would be false on this screen.
 * - Uses the chat screen's reading width and side padding (`CHAT_COLUMN`: 50rem, `px-5 md:px-8`).
 *   It borrows that screen's list and input, so mismatched widths would make height estimates
 *   correct on only one side.
 * - The h1 is not hidden. In chat the title comes from the fixed header; here that header shows
 *   the draft title, so the canvas needs a title of its own.
 */
export function PlaytestShell({
	title,
	children,
}: {
	/** Draft title. Omit it while unknown (placeholder and error states). */
	title?: string;
	children: ReactNode;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-[50rem] flex-1 flex-col px-5 pt-2 md:px-8">
			{title === undefined && (
				<h1 className="sr-only">{t("playtestShell.storyTest")}</h1>
			)}
			{children}
		</div>
	);
}
