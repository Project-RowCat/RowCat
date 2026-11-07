import { APP_NAME } from "@rowcat/domain";
import { BrandSymbol } from "@rowcat/ui-web/components/brand-symbol";

/** One lockup for the sidebar, drawer and authentication screens. */
export function Wordmark({ size = "title" }: { size?: "title" | "display" }) {
	return (
		<span className="inline-flex items-center gap-2">
			<BrandSymbol className={size === "display" ? "size-8" : "size-6"} />
			{APP_NAME}
		</span>
	);
}
