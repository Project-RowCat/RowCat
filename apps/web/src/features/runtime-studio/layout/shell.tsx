import type { ReactNode } from "react";

/**
 * The studio root: one work area confined to the viewport height. It does not use Canvas. Canvas is
 * document flow (centered, with a read-width cap). Here the area must use all remaining width, the
 * window must not scroll, and inner panels scroll themselves. A read-width cap would make the
 * editor a narrow band on a 27-inch screen. The lock decision itself is made by the shell
 * (viewportLocked in shell-route.ts). min-h-0 is required: without it the inner panels grow to
 * their content height and scrolling leaks to the page. The chat and work test pages use the same
 * value in the same place.
 */
export function RuntimeStudioShell({ children }: { children: ReactNode }) {
	return <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>;
}
