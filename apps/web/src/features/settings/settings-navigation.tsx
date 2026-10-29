import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import {
	SETTINGS_ACCOUNT_LINK,
	SETTINGS_NAV,
	settingsAccountLinkLabel,
	settingsNavLabel,
} from "./settings-nav.ts";

/**
 * Settings in-page navigation belongs to the settings canvas, not the app sidebar.
 *
 * - The sidebar holds global destinations and recent conversations. Adding category links there
 *   would make that column hold different content on each screen.
 * - The list does not decide the body position. The shell centers the body and this rail only
 *   occupies the space to its left, so changing the rail width leaves the body's x position alone.
 * - Two containers: a left rail at the wide breakpoint (87rem and up) and a horizontal row below
 *   it. Both render from the same list and share one width decision with the shell grid. Both are
 *   always in the DOM (CSS hides one), so the active indicator's shared-layout name must differ per
 *   container, or the indicator would animate between them.
 * - The active category is announced by aria-current plus font weight and color. The moving
 *   background and underline are decorative (aria-hidden). Filled brand-colored backgrounds are not
 *   used: the list should stay quieter than the body.
 */

/**
 * `sticky` pairs with `self-start`. Grid items stretch by default, which makes the rail as tall as
 * the body and leaves nothing to stick to. It sticks below the sticky page header, so that height
 * must be subtracted; otherwise the first item slides under the header.
 *
 * `justify-self-end` aligns contents to the rail's right edge. The rail is exactly 176px, so this
 * has no effect today, but if the rail widens, the list stays attached to the body it switches.
 *
 * `shrink-0` is omitted on purpose. It is a flex property, and grid tracks set the width here.
 * Keeping it would suggest this element is a flex child.
 */
export function SettingsSideNav() {
	const { t } = useTranslation(["settings", "common"]);
	return (
		<nav
			aria-label={t("settingsNavigation.settings")}
			className="sticky top-[calc(var(--shell-header)+2rem)] hidden w-44 self-start justify-self-end min-[87rem]:col-start-1 min-[87rem]:block"
		>
			{/*
			 * `Settings` appears here only once. The body heading is the category (`General`, `AI`). Next to
			 * this small label those two would read as the current location, so hierarchy comes from
			 * layout rather than from stacking two large headings.
			 *
			 * It is not an `h2`. The body's category name is the `h1`, and an `h2` before it would
			 * invert the document heading order. The name this line carries is already in the nav's
			 * `aria-label`.
			 */}
			<p className="px-2.5 text-xs font-medium text-muted-foreground">
				{t("settingsNavigation.settings")}
			</p>

			<ul className="mt-2 flex flex-col gap-0.5">
				{SETTINGS_NAV.map((item) => (
					<li key={item.to}>
						<Link
							to={item.to}
							/**
							 * Carries the return location through unchanged (see settings-return.ts). Dropping it would
							 * strand users who changed category once: the path they came from stays, but the link to it
							 * disappears, and nothing on screen reveals the mismatch.
							 */
							search={(previous) => previous}
							/**
							 * `General` maps to `/settings`, so it needs exact matching. With the default prefix matching,
							 * the router would also mark it active on `/settings/ai`, and two items would carry
							 * aria-current at once. The visible highlight would still look like one, so the bug would
							 * not show. The creation workspace's pane switching has the same trap.
							 */
							activeOptions={{ exact: true }}
							className="group relative flex items-center rounded-md px-2.5 py-1.5 text-sm text-muted-foreground no-underline outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:font-medium data-[status=active]:text-accent-foreground"
						>
							{({ isActive }) => (
								<>
									{isActive && (
										<MotionActiveIndicator
											group="settings-nav-side"
											className="absolute inset-0 rounded-md bg-accent"
										/>
									)}
									<span className="relative truncate">
										{settingsNavLabel(item.category)}
									</span>
								</>
							)}
						</Link>
					</li>
				))}
			</ul>

			{/*
			 * Account management sits below a divider because it is an exit, not a category. In the
			 * same group it would imply that account settings live under `/settings`. The arrow says
			 * the same thing: it marks the destination's nature.
			 */}
			<div className="my-3 border-t" />
			<Link
				to={SETTINGS_ACCOUNT_LINK.to}
				className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground no-underline outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<span className="truncate">{settingsAccountLinkLabel()}</span>
				<ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
			</Link>
		</nav>
	);
}

/**
 * Narrow-screen horizontal row. The three destinations and the exit link stay on one line on the
 * narrowest devices, so users see every option without tapping anything.
 *
 * This was measured: no horizontal document scroll and no clipped items at 320, 360, 375, and
 * 390px. At 320px, 35px remains between the right end of `Personas` and the left end of `Manage account`.
 *
 * When that margin runs out, do not collapse the categories into a Select or overflow menu (their
 * visibility is the purpose of this row), do not lower the 44pt target size, and do not shrink the
 * text. The space must come from outside this list: the `Manage account` link yields first, the same way the
 * mobile header always shrinks its title first.
 *
 * There is no `Settings` label here. The row switches the body directly below it, and the name is
 * available to assistive tech through aria-label.
 */
export function SettingsCompactNav() {
	const { t } = useTranslation(["settings", "common"]);
	return (
		<nav
			aria-label={t("settingsNavigation.settings")}
			className="mb-6 border-b min-[87rem]:hidden"
		>
			<div className="-mb-px flex items-center justify-between gap-4">
				<ul className="flex min-w-0 gap-1">
					{SETTINGS_NAV.map((item) => (
						<li key={item.to}>
							<Link
								to={item.to}
								search={(previous) => previous}
								activeOptions={{ exact: true }}
								/*
								 * Active and inactive states share the same geometry: a transparent 2px bottom border.
								 * Giving only the active state thickness would shift the whole row by 2px on every switch.
								 */
								className="relative flex items-center border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:font-semibold data-[status=active]:text-foreground"
							>
								{({ isActive }) => (
									<>
										{isActive && (
											<MotionActiveIndicator
												group="settings-nav-compact"
												/*
												 * Sits exactly over the transparent bottom border (-2px offset). Absolute positioning
												 * is measured from the padding box, so without the -2px the underline would sit off the
												 * `<nav>` border line.
												 */
												className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-foreground"
											/>
										)}
										{settingsNavLabel(item.category)}
									</>
								)}
							</Link>
						</li>
					))}
				</ul>

				{/*
				 * The exit link is outside the tab list here as well. It is not a tab, and its look (no
				 * underline indicator, trailing arrow) says so.
				 */}
				<Link
					to={SETTINGS_ACCOUNT_LINK.to}
					className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-2 text-sm text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<span>{settingsAccountLinkLabel()}</span>
					<ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
				</Link>
			</div>
		</nav>
	);
}
