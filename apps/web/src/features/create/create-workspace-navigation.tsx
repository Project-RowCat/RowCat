import { Link } from "@tanstack/react-router";
import { translator } from "#/lib/i18n/current.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import {
	CREATE_VIEWS,
	type CreateSearch,
	type CreateView,
	createSearchForNavigation,
	createViewFromSearch,
} from "./create-search.ts";

/**
 * The row that moves between the four workspace tabs. It is made of links, not buttons or tab
 * primitives.
 * - Links because a tab change alters the address. It must enter history (back returns to the
 *   previous tab), open in a new tab, and be shareable. Internal component state (a `Tabs`
 *   primitive, or `useState`) loses all three, and a refresh would drop the tab the user was on.
 * - Quiet by design. People come here for their manuscripts, not the tabs. Four large bordered
 *   segments would make navigation the most prominent element on screen. So the row has no
 *   container: only labels and one underline, with the list directly beneath.
 * - Accessibility comes from the link itself: `aria-current="page"` marks the current tab. The
 *   underline is an extra moving indicator (`MotionActiveIndicator`) that disappears if motion
 *   fails, and the labels still show the current tab.
 * - It holds only the vocabulary and renders links from the current search and draft count. No
 *   queries, state, or draft creation, which would turn the navigation into the workspace's
 *   assembler.
 * - No filters, sorting, view switching, search, or column menus. The draft list is a few
 *   hand-written manuscripts, so query controls would add chrome, not capability.
 */

/** Tab label. A count is shown only where the tab knows it for free (see below). */
const viewLabel = (view: CreateView): string =>
	translator("create")(`nav.${view}`);

export function CreateWorkspaceNavigation({
	search,
	draftCount,
}: {
	/**
	 * The current address's search, not a single tab value. The analytics tab's link must carry the
	 * current period, so that tab's active match is exactly right (`createSearchForNavigation`).
	 */
	search: CreateSearch;
	/**
	 * Draft count. **Only this tab has a number**, because it is the length of a list that is already
	 * subscribed to, so it costs nothing. Counts for published works and analytics are known only once
	 * those tabs are opened (only the active tab queries). Two COUNT endpoints would be added just to
	 * make all the tabs look symmetrical. The asymmetry is deliberate and honest: it beats attaching a
	 * stale or invented number.
	 */
	draftCount: number;
}) {
	const view = createViewFromSearch(search);
	return (
		<nav aria-label={translator("create")("nav.label")} className="border-b">
			<ul className="-mb-px flex">
				{CREATE_VIEWS.map((value) => {
					const active = value === view;
					return (
						/*
						 * Only on narrow screens do the four tabs share the width. At 390px, left-aligned, `Analytics` would
						 * end halfway across the screen, leaving a small target. Sharing the width fits all four
						 * without horizontal overflow, so it is preferred. From `sm` up the row returns to content
						 * width, since spreading four items across a wide screen would stretch the navigation across
						 * it.
						 */
						<li key={value} className="flex-1 sm:flex-none">
							{/*
							 * `replace` is not used. A tab switch is an intended navigation, and the user must be able to go
							 * back to the previous tab with the back button.
							 */}
							<Link
								to="/create"
								search={createSearchForNavigation(value, search)}
								/**
								 * **Both axes are compared exactly.** With the default setting, the router compares the
								 * link's search as a subset of the current search. The `Draft` tab's search is `{}`, which is
								 * a subset of every address. On `?view=published`, **both tabs** would then get
								 * `aria-current`, and screen readers could not tell which tab is current. Visually there is
								 * only one emphasis, so the defect is invisible.
								 */
								activeOptions={{ exact: true, includeSearch: true }}
								/**
								 * The underline is **one element that moves between siblings** (below). The active and
								 * inactive branches therefore share the same `border-b-2 border-transparent`. If only the
								 * active side had a thickness, the row's height would shift by 2px on every tab change.
								 */
								className={
									active
										? "relative flex items-center justify-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:justify-start sm:px-3"
										: "relative flex items-center justify-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:justify-start sm:px-3"
								}
							>
								{/*
								 * The current tab is announced by its text first (`aria-current`, weight, color). The underline is
								 * a description on top of that, so it is `aria-hidden`. If reduced motion or a dropped frame makes
								 * it vanish, the current tab is still read out. This follows the same rule as the sidebar's active
								 * background.
								 * The indicator's name space is kept separate from the two sidebar entries
								 * (`create-workspace-tab`).
								 * The tab lit here and the sidebar's `Create` are normally both lit at once, so if they shared a
								 * name, the indicator would fly in from the sidebar to this row the moment `/create` opens.
								 */}
								{active && (
									<MotionActiveIndicator
										group="create-workspace-tab"
										/*
										 * The underline sits exactly over the transparent bottom border (`-bottom-0.5`, which is
										 * -2px). Absolute positioning is relative to the padding box, so without this offset the
										 * underline would float above the border and misalign with the `<nav>` rule.
										 */
										className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-foreground"
									/>
								)}
								{viewLabel(value)}
								{value === "drafts" && (
									<span className="text-xs tabular-nums text-muted-foreground">
										{/*
										 * While a draft is being created or deleted, this tab stays mounted and only its value changes.
										 * That is what qualifies it to roll: only **the number** rolls. The tab, label, and active
										 * indicator
										 * stay put. The indicator already has its own transition (`MotionActiveIndicator`), so moving them
										 * here too would overlap two movements. The intensity is the default: drafts are created and
										 * deleted one at a time, so the next change does not arrive right away.
										 */}
										<AnimatedCount value={String(draftCount)} />
									</span>
								)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
