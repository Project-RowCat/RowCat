import { BRAND_SYMBOL_PATH, BRAND_SYMBOL_VIEW_BOX } from "@rowcat/design";
import { cn } from "../lib/utils.ts";

/** Decorative: the adjacent app name supplies the accessible label. */
export function BrandSymbol({ className }: { className?: string }) {
	return (
		<svg
			viewBox={BRAND_SYMBOL_VIEW_BOX}
			fill="currentColor"
			className={cn("size-6 shrink-0", className)}
			aria-hidden="true"
			focusable="false"
		>
			<path d={BRAND_SYMBOL_PATH} />
		</svg>
	);
}
