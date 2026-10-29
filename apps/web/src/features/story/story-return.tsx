import type { HistoryState } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

/**
 * Route back from the detail screen to discovery: one destination, two mechanisms.
 *
 * - Entered in-app from the discovery preview: go back in history. The entry still exists, so the
 *   query axis, scroll restoration (keyed by `location.state.__TSR_key`), and cached pages all
 *   return.
 * - Entered directly (link, bookmark, reload): navigate to `/`. Going back here would leave the
 *   app for whichever site linked in.
 *
 * `history.length` is not used because it counts entries from other sites. The router's
 * `canGoBack()` (an entry this document pushed; `__TSR_index` resets on reload) and the origin
 * marker are checked together. The marker is needed because the publish success in the editor
 * (`create/publish-panel.tsx`) also leads here, and going back from there would open a draft editor
 * under a `Back to Discover` link.
 *
 * The href is always `/`, so open-in-new-tab and copy-address work, and the link works before
 * JavaScript loads. Only a plain left click is intercepted.
 */

interface GalleryOriginState {
	/**
	 * The discovery screen sets this marker when it pushes the entry. It lives on the history entry,
	 * so it survives reload, back, and forward; component state or a module global would vanish on
	 * reload. It is not put in the address, since `?from=gallery` would travel with a copied link to a
	 * recipient whose history has no discovery entry.
	 */
	fromGallery?: true;
}

/**
 * A constant, so every link carries the identical value. A literal `{ fromGallery: true }` at each
 * call site would let a typo in the key silently drop the marker, which shows up as a discovery
 * screen whose filters sometimes disappear, not as an error.
 */
/**
 * An intersection type, because `HistoryState` is declared by `@tanstack/history` and augmented by
 * the router. This app does not depend on that package directly, so it cannot add keys with
 * `declare module`. The intersection adds this key while still fitting the original type, which
 * avoids TypeScript's excess-property rejection of object literals for all-optional types.
 */
export const GALLERY_ORIGIN_STATE: HistoryState & GalleryOriginState = {
	fromGallery: true,
};

export function StoryReturnLink() {
	const { t } = useTranslation("story");
	const router = useRouter();

	/**
	 * Only a plain left click is intercepted. Modifier and middle clicks are left alone, since the
	 * user asked for a new tab and a back navigation would move the current tab. The router's `Link`
	 * applies the same condition: if this handler does not call `preventDefault`, `Link` takes over,
	 * and if both decline, the browser's default navigation to `/` stays.
	 */
	const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;

		/**
		 * `HistoryState` is an empty interface and cannot be augmented from this app, so the widening
		 * cast is confined to this one line.
		 */
		const state = router.history.location.state as GalleryOriginState;
		if (state.fromGallery !== true) return;
		// The marker can exist with nothing to go back to, for example after the user cleared their
		// history. In that case the handler does not intercept, and the link's own navigation to `/`
		// proceeds.
		if (!router.history.canGoBack()) return;

		event.preventDefault();
		router.history.back();
	};

	return (
		<Link
			to="/"
			search={{}}
			onClick={onClick}
			// Vertical padding makes the tap target taller on narrow screens without changing the text size.
			className="-my-1.5 inline-flex items-center gap-1 rounded-md py-1.5 text-sm text-muted-foreground no-underline outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<ChevronLeft className="size-4" aria-hidden="true" />
			{t("backToDiscover")}
		</Link>
	);
}
