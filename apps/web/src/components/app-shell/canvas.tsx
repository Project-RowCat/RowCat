import type { ReactNode } from "react";

/**
 * Shared margins and maximum width for screens that flow like a document: discovery, work detail,
 * create and account.
 *
 * It lives here rather than in the shell (`app-shell.tsx`) because this is a **content rule, not a
 * spatial one**. The shell defines the sidebar, header and canvas regions; how many pixels wide the
 * text reads inside them depends on the screen's character. Conversation does not use this
 * component and sets its own width.
 *
 * Only what is genuinely shared lives here. Titles and toolbars differ per screen and each screen
 * owns them. If settings start to adopt this, the file turns into a layout assembler, and new
 * screens would add options here instead of laying out their own content.
 */
export function Canvas({ children }: { children: ReactNode }) {
	return (
		/*
		 * The vertical padding is reduced one step on narrow screens. The 32px that suits desktop would
		 * make a tenth of the first screen empty space above the title on mobile.
		 */
		<div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
			{children}
		</div>
	);
}
