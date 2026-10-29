import type { CSSProperties } from "react";

/**
 * The element the renderer attaches to: the last layer React owns.
 *
 * Below this `div` React has no part. The renderer attaches a shadow root and patches it
 * imperatively. React does not re-render this element, since it has no children and its props do
 * not change. That boundary keeps a single reconciler; moving patch batches into React state would
 * create a second one.
 *
 * The variables are host configuration. The app's tokens are copied into the renderer's own names
 * (`--rowcat-runtime-*`), so the renderer knows only those names. The playback surface fills the
 * same names with other values when it sits inside a different shell.
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

export function RuntimePreviewSurface({
	attach,
	hidden,
}: {
	attach: (element: HTMLDivElement | null) => void;
	/** Rendered but hidden. The element must stay mounted so that late batches still have a target. */
	hidden: boolean;
}) {
	return (
		<div
			ref={attach}
			data-testid="runtime-preview-surface"
			aria-hidden={hidden || undefined}
			className={hidden ? "invisible h-full w-full" : "h-full w-full"}
			style={THEME}
		/>
	);
}
