import type { CSSProperties } from "react";

/**
 * Below this div React does not own the DOM. The renderer attaches a shadow root here and mutates
 * it imperatively; React never re-renders this element.
 *
 * That boundary keeps a single reconciler. Moving patch batches into React state would make React
 * re-decide the Phase 4B rules (node identity, key moves, handler identity, atomic commit).
 *
 * The creator's Screen is this box. The trusted chrome (back, title, reset, error) sits outside it,
 * so creator code cannot cover it.
 *
 * The CSS variables are host configuration: app tokens are copied to --rowcat-runtime-* names. The
 * renderer knows only those names; creator CSS is not supported.
 */
const THEME: CSSProperties = {
	"--rowcat-runtime-bg": "var(--background)",
	"--rowcat-runtime-fg": "var(--foreground)",
	"--rowcat-runtime-primary": "var(--primary)",
	"--rowcat-runtime-primary-fg": "var(--primary-foreground)",
	"--rowcat-runtime-secondary": "var(--secondary)",
	"--rowcat-runtime-secondary-fg": "var(--secondary-foreground)",
	"--rowcat-runtime-border": "var(--border)",
	"--rowcat-runtime-muted": "var(--muted)",
	"--rowcat-runtime-font": "var(--font-sans, system-ui, sans-serif)",
} as CSSProperties;

export function RuntimePlayerSurface({
	attach,
	hidden,
}: {
	attach: (element: HTMLDivElement | null) => void;
	/**
	 * Rendered but hidden. The element must stay mounted so that late-arriving patch batches have a
	 * target. Unmounting disposes the renderer; a commit that arrives afterwards has nowhere to apply
	 * and the revision chain breaks. The chain is not patched over with guesses; the renderer fails
	 * instead.
	 */
	hidden: boolean;
}) {
	return (
		<div
			ref={attach}
			data-testid="runtime-player-surface"
			aria-hidden={hidden || undefined}
			className={hidden ? "invisible h-full w-full" : "h-full w-full"}
			style={THEME}
		/>
	);
}
