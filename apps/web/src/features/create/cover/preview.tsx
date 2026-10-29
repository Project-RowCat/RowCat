import { cn } from "@rowcat/ui-web/lib/utils";
import { ImageOff } from "lucide-react";
import { useState } from "react";

/**
 * - A picture that cannot load is drawn as the same placeholder as a missing cover. The strip
 *   thumbnail and the manage dialog share this component, so failure handling cannot end up in only
 *   one of them.
 * - CreatorWorkDto.coverUrl is sent for all owned works, including hidden and archived ones. The
 *   cover read uses the same predicate as the detail page, so for those works even the owner gets a
 *   404.
 * - Three cases leave the picture missing without the work being wrong: the work is hidden or
 *   archived, the cover was removed or replaced on another device (URLs are content hashes, so old
 *   ones die), or the network failed. A broken-image icon would make creators think their work is
 *   damaged. The placeholder keeps the layout stable (the mobile StoryCover does the same).
 * - When the URL changes, the failure state resets. Otherwise a newly uploaded cover would still
 *   show the placeholder after one failure, which makes a successful upload look failed.
 */
export function CoverPreview({
	src,
	className,
	iconClassName,
	/**
	 * Draws only the placeholder. This means the same as a null src, so no separate argument is
	 * needed.
	 */
	loading,
}: {
	src: string | null;
	className?: string;
	iconClassName?: string;
	loading?: "lazy" | "eager";
}) {
	/**
	 * Remembers the failed URL, not a boolean. With a boolean, retrying after the URL changes would
	 * need a reset effect, and one wrong dependency would leave a newly uploaded cover stuck on the
	 * placeholder. With the URL held, the reset is derived and has no place to go wrong.
	 */
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const failed = src !== null && failedSrc === src;

	if (!src || failed)
		return (
			<div
				aria-hidden="true"
				className={cn(
					"flex size-full items-center justify-center bg-linear-to-br from-muted to-muted/30 text-muted-foreground/60",
					className,
				)}
			>
				<ImageOff className={cn("size-4", iconClassName)} />
			</div>
		);

	return (
		/*
		 * Alt text is empty. Both callers have the work title as visible text right next to the image,
		 * and repeating it here would make screen readers announce the same name twice.
		 */
		<img
			src={src}
			alt=""
			loading={loading}
			decoding="async"
			className={cn("size-full object-cover", className)}
			onError={() => setFailedSrc(src)}
		/>
	);
}
