import { type ReactNode, useState } from "react";

/**
 * One image on the chat screen, shared by scene images and markdown images.
 *
 * The two come from different sources and fall back differently, but the drawing is the same. Drawn
 * separately, two images in one conversation would get different size caps and radii.
 *
 * - Owns: the size cap, the failure fold, the referrer policy and lazy loading.
 * - Does not own: building the address, safety decisions, margins, or inventing alt text.
 *
 * Mobile keeps the same boundary (`RemoteImage` in `@rowcat/ui-native`). The render code is not
 * shared; the boundary is.
 */

/**
 * Frame size, so an image does not push the reading flow away. The vertical cap matters most: a
 * tall image that fills the screen would scroll the paragraph being read out of view. Width is
 * already bounded by the prose column (`ASSISTANT_PROSE`), so it is only kept from exceeding that.
 *
 * `h-auto` keeps the aspect ratio: when the cap applies, the browser shrinks the width too (the
 * image really gets smaller, not `object-contain`). The virtualizer re-measures the height with
 * `ResizeObserver`, so a late image that grows its row corrects the scroll position
 * (`message-list.tsx`).
 */
const IMAGE_FRAME = "max-h-[min(60vh,32rem)] h-auto max-w-full rounded-xl";

export function ChatImage({
	src,
	alt,
	title,
	className,
	fallback = null,
}: {
	/** Address that has already passed the safety check. An empty value renders `fallback` immediately. */
	src: string;
	/**
	 * Alt text. Scene images pass `""` (decorative); markdown images carry the author's text, so it is
	 * never invented here.
	 */
	alt: string;
	title?: string;
	/** Margin of the slot the image stands in; applied to the wrapper. */
	className?: string;
	/**
	 * Shown when the image fails to load. Defaults to nothing: a broken-image icon explains nothing.
	 * Only callers with a meaningful value (the alt text) pass one.
	 */
	fallback?: ReactNode;
}) {
	const [failed, setFailed] = useState(false);

	if (!src || failed) return fallback;

	return (
		/*
		 * The wrapper exists for two reasons: `<img>` is a replaced element, so `::after` does not render
		 * on it (the streaming caret attaches to the last block there, see `STREAM_CARET`), and block
		 * spacing must belong to the slot, not to the image.
		 */
		<div className={className}>
			<img
				src={src}
				alt={alt}
				title={title}
				/*
				 * The referrer is not sent: it would put the full conversation URL in the host's logs. Our
				 * media URLs get the same policy so every image on this screen follows one rule; deciding per
				 * call site would eventually miss one, silently.
				 */
				referrerPolicy="no-referrer"
				/*
				 * Lazy loading: no request until the image enters the viewport. The list is virtualized, so
				 * off-screen rows are not in the DOM, but one long response can be taller than the screen and
				 * hold several images.
				 */
				loading="lazy"
				decoding="async"
				onError={() => setFailed(true)}
				className={IMAGE_FRAME}
			/>
		</div>
	);
}
