import { readFileSync } from "node:fs";
import { DEFAULT_GALLERY_FILTERS } from "@rowcat/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GalleryToolbar } from "./gallery-toolbar.tsx";

/**
 * The discover screen while conditions change: what stays alive, and what is not yet stated.
 *
 * Two regressions are guarded:
 * - Unknown drawn as 0: `0 stories` appears as fact before the new results arrive.
 * - The boundary rising above the toolbar: the search input turns into a gray bar, and focus
 *   drops to <body>.
 *
 * The second is why this file exists. The route's pendingComponent once sat there; since the loader
 * waited for the list, the router replaced the whole screen after defaultPendingMs. On a slow
 * connection (3G), about 240ms after a search was confirmed, the input left the layout and further
 * typing went nowhere. Fast connections do not reproduce it, so neither review nor the dev server
 * shows it; the structure is therefore locked by value.
 */

const toolbar = (total: number | null) =>
	renderToStaticMarkup(
		<GalleryToolbar
			filters={DEFAULT_GALLERY_FILTERS}
			followingAvailable={false}
			total={total}
			onChange={() => {}}
			onSearch={() => {}}
			onReset={() => {}}
		/>,
	);

describe("the toolbar total", () => {
	it("does not draw `0 stories` while unknown", () => {
		const html = toolbar(null);
		expect(html).not.toContain("0 stories");
		/** The space is kept, so the grid below does not jump when the value arrives. */
		expect(html).toContain('data-slot="skeleton"');
	});

	it("the server answering 0 is 0 stories", () => {
		const html = toolbar(0);
		expect(html).toContain("0");
		expect(html).toContain("stories");
		expect(html).not.toContain('data-slot="skeleton"');
	});

	it("writes the count without abbreviation", () => {
		expect(toolbar(1247)).toContain("1,247");
	});

	/**
	 * The live region does not read the unknown: the placeholder is aria-hidden, and the region speaks
	 * again only when the value arrives.
	 */
	it("the live region has nothing to read while unknown", () => {
		const html = toolbar(null);
		expect(html).toMatch(
			/<div[^>]*data-slot="skeleton"[^>]*aria-hidden="true"/,
		);
		/** No readable count while the value is unknown: the unit appears only alongside a total. */
		expect(html.replace(/<[^>]*>/g, "")).not.toContain("stories");
		expect(toolbar(0).replace(/<[^>]*>/g, "")).toContain("stories");
	});
});

/**
 * Structure: the boundary sits below the toolbar. This cannot be verified by rendering (where
 * suspense actually suspends only shows when the query stalls), so the test inspects the source's
 * shape. The repo already guards several rules this way.
 */
describe("where the results boundary sits", () => {
	const page = readFileSync(
		new URL("./gallery-page.tsx", import.meta.url),
		"utf8",
	);
	const route = readFileSync(
		new URL("../../routes/(app)/index.tsx", import.meta.url),
		"utf8",
	);

	it("the toolbar is above the suspense boundary", () => {
		expect(page.indexOf("<GalleryToolbar")).toBeGreaterThan(-1);
		expect(page.indexOf("<Suspense")).toBeGreaterThan(
			page.indexOf("<GalleryToolbar"),
		);
	});

	it("the fallback does not redraw the toolbar", () => {
		expect(page).toContain("fallback={<GalleryGridSkeleton />}");
		/**
		 * The skeleton that also draws the toolbar is the route's first-open version, so this page must
		 * not use it.
		 */
		expect(page).not.toContain("<GallerySkeleton");
	});

	/**
	 * If this layer used suspense queries again, the boundary would move above the toolbar, since the
	 * whole component would be replaced by the fallback.
	 */
	it("the screen top level holds no suspense query", () => {
		const top = page.slice(
			page.indexOf("export function GalleryPage"),
			page.indexOf("function GalleryResults"),
		);
		expect(top).not.toContain("useSuspenseInfiniteQuery");
		expect(top).toContain("useInfiniteQuery(");
	});

	/**
	 * If the loader waited for the list in the browser, the route would become pending again, and at
	 * that moment the whole structure above would be meaningless (the router replaces the screen
	 * wholesale).
	 */
	it("the loader does not wait for the list in the browser", () => {
		const loadGallery = route.slice(route.indexOf("function loadGallery"));
		expect(loadGallery).toContain('typeof window === "undefined"');
		expect(loadGallery).toContain("ensureInfiniteQueryData");
		expect(loadGallery).toContain("prefetchInfiniteQuery");
	});
});
