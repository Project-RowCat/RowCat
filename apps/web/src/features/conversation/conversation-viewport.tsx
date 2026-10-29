import type { ReactNode } from "react";

/**
 * The fixed-height column for conversation-style screens, shared by room chat and the runtime
 * playthrough.
 *
 * These screens differ from document-flow screens, which scroll the window. Here the contents
 * scroll inside a column and the controls stay pinned to the bottom. The shell decides which kind a
 * route is (`viewportLocked` in components/app-shell/shell-route.ts). This component only inherits
 * that height. Without `min-h-0`, the inner column grows to its content and scrolling leaks to the
 * page.
 *
 * Why this was split out of ChatShell: the runtime playthrough at /chat/runtime/:storyId uses the
 * same geometry, so two screens share it. Copying the chat shell into the runtime folder would make
 * runtime code import chat code, reversing the dependency direction (the runtime playthrough must
 * not know the conversation domain). Keeping two copies would let one screen's width or margin
 * change while the other stays, so the two would be constrained differently. Only geometry and the
 * document title live here. ChatShell wraps this and keeps its own name and its reading column
 * width (CHAT_COLUMN).
 *
 * Width belongs to the content. Conversations use the prose reading width, and the runtime uses the
 * maker canvas width. The header in chat-shell.tsx explains why it passes width to the content
 * rather than the shell (scrollbar).
 */
export function ConversationViewport({
	title,
	children,
}: {
	/**
	 * The document's main heading, visually hidden.
	 *
	 * It is not taken from the header label, because the built-in header appears on every screen.
	 * Making its text an h1 would make the whole app read as one document, with a different h1 on each
	 * route. When the title is not known yet (placeholder and error states), the caller's default word
	 * is shown instead.
	 */
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-0 w-full flex-1 flex-col pt-2">
			<h1 className="sr-only">{title}</h1>
			{children}
		</div>
	);
}
