import { cn } from "@rowcat/ui-web/lib/utils";
import type { ReactNode } from "react";

/**
 * The shared box for all previews. It fixes only the aspect ratio and background. Each illustration
 * owns its own contents.
 *
 * The ratio is fixed because six illustrations choosing their own heights would give cards
 * different sizes in the grid, which shows at once.
 *
 * This is not a live run. Drawing a card does not start a VM (§16). The markup is trusted and
 * written in the repo, not creator code, so opening the gallery loads neither the compiler nor the
 * worker.
 *
 * Why not screenshots: PNGs ignore the theme, blur at high resolution, and need re-capturing after
 * every template edit, which usually does not happen. Components read the tokens directly, so they
 * are correct in both light and dark modes, and they add no image bytes to the bundle.
 */
export function PreviewFrame({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			aria-hidden
			className={cn(
				"pointer-events-none relative flex aspect-[4/3] w-full flex-col gap-1.5 overflow-hidden rounded-md bg-muted/60 p-3",
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * A bar that imitates a line of text. It does not use real sentences, because the illustration only
 * conveys layout.
 */
export function PreviewLine({
	className,
	width = "w-full",
}: {
	className?: string;
	width?: string;
}) {
	return (
		<div
			className={cn("h-1.5 rounded-full bg-foreground/15", width, className)}
		/>
	);
}
