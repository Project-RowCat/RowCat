import { STORY_SEARCH_MAX_LENGTH } from "@rowcat/contracts";
import { type GalleryFilters, hasActiveFilters } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { RotateCcw, Search, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "#/lib/i18n/format.ts";
import { localizedAppliedFilters } from "#/lib/i18n/vocab.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { GalleryFilterMenu } from "./gallery-filter-menu.tsx";
import { GalleryFilterToken } from "./gallery-filter-token.tsx";
import { GallerySortMenu } from "./gallery-sort-menu.tsx";

/**
 * Time for keystrokes to count as settled. Too short and the URL changes per character; too long
 * and search feels sluggish.
 */
const SEARCH_DEBOUNCE_MS = 300;

interface GalleryToolbarProps {
	filters: GalleryFilters;
	/**
	 * Whether the following axis is drawn; true only for members. Guests see it hidden.
	 *
	 * The server returns 401 for the personal feed. Showing it to guests as an item that leads to
	 * sign-in would make it the only control in the toolbar that navigates; every other control
	 * narrows the current list.
	 *
	 * This is also where it differs from the heart, which sends guests to sign-in: that action has a
	 * clear intent for one work and a place to return to. A guest who returns here has no followed
	 * creators yet, so an empty feed would be the first impression.
	 */
	followingAvailable: boolean;
	/**
	 * Total the server counted under the current conditions: the full match count, not the number
	 * loaded so far (infinite scroll makes these differ).
	 *
	 * `null` is unknown, not zero. After conditions change and before new results arrive, the value is
	 * not zero; drawing `0 stories` then would tell the person who just changed a condition that their filter
	 * excluded everything, and the number appearing later would reverse that judgment. The mobile
	 * toolbar follows the same rule (discoverTotalLabel in
	 * apps/mobile/src/features/discover/discover-state.ts).
	 */
	total: number | null;
	onChange: (patch: Partial<GalleryFilters>) => void;
	/** Confirms the search text once the caller's debounce settles; not called on every keystroke. */
	onSearch: (query: string) => void;
	onReset: () => void;
}

/**
 * The discover screen's query axes. They are not lifted into the app header, because these axes are
 * this screen's state. In the header they would also show on work details or account screens,
 * blurring which is the truth.
 *
 * The bar reads as three lines: search with the filter and sort triggers on the first; applied
 * conditions as tokens on the second; the total and the reset-filters action below. The default
 * axes draw nothing, so an unfiltered screen shows only search and the two triggers.
 *
 * Selects for every axis used to stay open, on the principle that applied conditions explain the
 * result. That principle still holds; the place changed. Controls moved into menus, and only
 * applied conditions stay outside as tokens. The horizontal scroll of four Selects on narrow
 * screens is gone.
 *
 * Filters and sort have separate triggers: sort answers 'in what order', the rest answers 'what
 * remains'. The popularity window is part of sort, so the sort menu owns it.
 *
 * This component is not the source of truth for filters. Values come from the address
 * (gallery-page.tsx); here they are drawn and patches sent upward. The only local state is a
 * temporary copy for the search debounce.
 */
export function GalleryToolbar({
	filters,
	followingAvailable,
	total,
	onChange,
	onSearch,
	onReset,
}: GalleryToolbarProps) {
	const { t } = useTranslation("gallery");
	const applied = localizedAppliedFilters(filters, followingAvailable);
	/**
	 * Judgment for when layout is re-measured: the names of the applied axes.
	 *
	 * The `applied` array is not passed directly, because that function returns a new array every
	 * render. Pinning the dependency to it would do nothing, and each arrival of the total would
	 * re-measure every token's geometry.
	 */
	const layoutKey = applied.map((item) => item.axis).join(",");

	return (
		<div className="flex flex-col gap-3">
			{/*
			 * Search gets the most width; it is the control touched most on this screen. On narrow screens
			 * search takes a whole
			 * row, and the two triggers sit below it at both ends (filter left, sort right). The order is the
			 * same on desktop, so
			 * positions do not change between sizes.
			 */}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<SearchField query={filters.query} onSearch={onSearch} />
				<div className="flex items-center justify-between gap-2 sm:justify-start">
					<GalleryFilterMenu
						filters={filters}
						followingAvailable={followingAvailable}
						onChange={onChange}
					/>
					<GallerySortMenu filters={filters} onChange={onChange} />
				</div>
			</div>

			{/*
			 * Applied conditions. If there are none, draw nothing: an empty row left in place would push the
			 * total down a line on a
			 * screen without conditions. The row wraps rather than scrolls: with three conditions, overflow is
			 * rare, and even then the
			 * user is not made to read it by sideways scrolling.
			 */}
			{applied.length > 0 && (
				<ul aria-label={t("appliedFilters")} className="flex flex-wrap gap-2">
					{/*
					 * Adding and removing a condition is the result of what the user just did in the menu. Without
					 * something linking the
					 * menu to the token, a token appearing after the menu closes has no visible origin. Presence lives
					 * here; the token owns
					 * the choreography of its own row.
					 *
					 * `initial={false}` is half of this presence. The list comes from the address, so someone arriving
					 * by a link with
					 * conditions already applied sees the tokens from the start; animating them would look as if they
					 * had just picked them.
					 *
					 * This presence is not the context-breaking kind used by AnimatedCount. The toolbar sits outside
					 * the grid's initial={false}
					 * (gallery-page.tsx); here that value is this list's product decision itself.
					 *
					 * The last token leaves together with the row. When no conditions remain, the whole ul is removed,
					 * so that token has no
					 * exit. Keeping an empty list would push the total down one line on screens without conditions, and
					 * that shift, happening
					 * after the exit finishes, would look bigger than the token disappearing.
					 */}
					<AnimatePresence initial={false}>
						{applied.map((item) => (
							<GalleryFilterToken
								key={item.axis}
								applied={item}
								layoutKey={layoutKey}
								onRemove={() => onChange(item.patch)}
							/>
						))}
					</AnimatePresence>
				</ul>
			)}

			{/*
			 * Result summary. The total confirms that a filter took effect, so it should be noticeable, but it
			 * must not compete
			 * with work titles: small, faint text.
			 *
			 * Reset appears only when conditions are applied. The check is the domain's `hasActiveFilters`.
			 * Counting tokens would
			 * miss the case where only the search query and the popularity window (axes without tokens) are
			 * set, leaving something
			 * to reset with no button.
			 */}
			<div className="flex min-h-8 items-center justify-between gap-3">
				{/*
				 * The rolling total is the answer that the filter took effect. If the number alone swapped silently
				 * when the grid
				 * changed, the two changes from one action would look unrelated.
				 *
				 * The rolling still moves only the changed places (128 to 173 moves two digits). A large jump moves
				 * most places in one
				 * direction, which reads as one value changing.
				 *
				 * The live region reads neither value. Visible places are all aria-hidden, and the region outputs
				 * one sr-only chunk from
				 * `AnimatedCount` plus the unit, so even while the outgoing number is on screen the accessibility tree
				 * holds only the current
				 * count. The unit sits outside the animated box so the unit does not wobble with each change.
				 */}
				{/*
				 * Unknown is never drawn as `0 stories`. While a new condition's result has not arrived, a quiet bar of
				 * the same height is drawn
				 * instead of text. The live region stays mounted but empty, so assistive technology never reads
				 * `0 stories`; when the value arrives,
				 * it is read once. The placeholder is aria-hidden, since a meaningless shape must not be read in
				 * the total's place.
				 *
				 * Unknown does not roll. AnimatedCount does not move on mount (lib/motion/animated-count.tsx), so
				 * the moment the value changes
				 * from unknown to a number is that component's mount; otherwise the list would appear to grow from
				 * zero.
				 */}
				{/*
				 * The wrapper is a `<div>`, not `<p>`: `Skeleton` is a `<div>` and cannot sit inside a paragraph
				 * (the browser rewrites the
				 * tree and hydration mismatches). What this spot needs is a live region, not a paragraph.
				 */}
				<div
					aria-live="polite"
					className="text-sm text-muted-foreground tabular-nums"
				>
					{total === null ? (
						<Skeleton aria-hidden="true" className="h-4 w-16" />
					) : (
						<p>
							<AnimatedCount value={formatNumber(total)} />
							{t("unit", { count: total })}
						</p>
					)}
				</div>
				{hasActiveFilters(filters) && (
					<Button variant="ghost" size="sm" onClick={onReset}>
						<RotateCcw aria-hidden="true" />
						{t("resetFilters")}
					</Button>
				)}
			</div>
		</div>
	);
}

/**
 * Search input. The confirmed value is owned by the URL; this local state is only a temporary copy
 * for debouncing. The point is to delay navigation, not the SDK: routing on every character would
 * pile up twenty history entries.
 *
 * The initial value comes from the URL, so the server render and the first client render draw the
 * same value.
 */
function SearchField({
	query,
	onSearch,
}: {
	query: string;
	onSearch: (query: string) => void;
}) {
	const { t } = useTranslation("gallery");
	const [text, setText] = useState(query);
	const inputRef = useRef<HTMLInputElement>(null);

	// When back/forward navigation changes the confirmed value, the input follows it.
	useEffect(() => setText(query), [query]);

	useEffect(() => {
		if (text === query) return;
		const timer = setTimeout(() => onSearch(text), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text, query, onSearch]);

	return (
		<div className="relative min-w-0 flex-1">
			<Search
				className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				ref={inputRef}
				type="search"
				value={text}
				onChange={(e) => setText(e.target.value)}
				aria-label={t("searchLabel")}
				/**
				 * Blocks over-long input before it reaches the server, which rejects it. Same value as the
				 * contract.
				 */
				maxLength={STORY_SEARCH_MAX_LENGTH}
				/**
				 * Lists only the five fields the server actually scans (title, author, description, tags,
				 * creator nickname). If a field the server does not scan were listed, a person searching by it
				 * would get 'no results' and could not tell whether the server skipped the field or nothing
				 * matched.
				 */
				placeholder={t("searchPlaceholder")}
				/*
				 * Slightly larger on narrow screens. Search is the most-used control here, and 36px is small
				 * for a thumb to hit reliably.
				 */
				className="h-11 pr-10 pl-9 sm:h-10"
			/>
			{/*
			 * Clear button. Some browsers draw their own X on type=search (WebKit), but whether they do varies
			 * and it is not reachable
			 * by keyboard, so this one is ours.
			 *
			 * Clearing the value is enough. Confirmation follows the debounce above, as before; navigating here
			 * immediately would create
			 * a second path for confirming the query.
			 */}
			{text && (
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t("clearSearch")}
					className="absolute inset-y-0 right-1 my-auto text-muted-foreground"
					onClick={() => {
						setText("");
						inputRef.current?.focus();
					}}
				>
					<X aria-hidden="true" />
				</Button>
			)}
		</div>
	);
}
