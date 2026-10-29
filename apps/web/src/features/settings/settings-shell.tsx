import { Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Canvas } from "#/components/app-shell/canvas.tsx";
import { SettingsCompactNav, SettingsSideNav } from "./settings-navigation.tsx";
import { settingsReturnLabel } from "./settings-return.ts";

/**
 * Shell for the settings workspace: one navigation list and one body column.
 *
 * - The route layout renders it (routes/(app)/settings/route.tsx), so switching categories does
 *   not remount the list. Only the outlet below changes.
 * - The shell stores no values. Each setting reads from and writes to its owner (theme provider,
 *   member-scoped preference store, device credential store, server for account values). That is
 *   why there is no SettingsProvider, no all-settings object, and no global 'Save' button. No
 *   transaction spans those stores, and such a button would report a partial failure as success.
 * - The body owns the centering, not the shell. An earlier flex wrapper centered the list, gap,
 *   and body as one block, pushing the body 108px right. The current layout uses three columns with
 *   equal 1fr side tracks, so symmetry is the centering. Each column pins its grid column
 *   (col-start-1 and col-start-2): with auto-placement, the body would slide into the left rail
 *   when the list is absent (measured: a 216px jump).
 * - The right rail has no children. No empty placeholder div is added to balance it.
 * - Breakpoint: three columns appear at 87rem. That value is derived, not chosen: 240px sidebar +
 *   48px canvas padding + 1104px content (176 + 40 + 672 + 40 + 176) = 1392px. Below it the list
 *   becomes a horizontal row above the body.
 * - The body is not widened with the canvas. It holds prose and forms, and at 1440px labels would
 *   spread to opposite edges.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
	return (
		<Canvas>
			{/*
			 * At narrow widths there is one column. The navigation list is `display: none`, so it is not a
			 * grid item, and the body takes that single column. No empty left rail is left behind.
			 */}
			<div className="grid w-full grid-cols-1 min-[87rem]:grid-cols-[minmax(0,1fr)_minmax(0,42rem)_minmax(0,1fr)] min-[87rem]:gap-10">
				<SettingsSideNav />
				{/*
				 * `mx-auto` is correct at both widths. Narrow: it centers the body in the canvas. Wide: the
				 * column is already 42rem, so it has no effect. Setting different alignment per width (the old
				 * `xl:mx-0`) would create two sources for the centering.
				 */}
				<div className="mx-auto w-full min-w-0 max-w-2xl min-[87rem]:col-start-2">
					<SettingsReturnLink />
					<SettingsCompactNav />
					{children}
				</div>
			</div>
		</Canvas>
	);
}

/**
 * Way back to the conversation (`Back to conversation`), shown only when the user came from one. It sits at the
 * top of the body column. Beside the list it would read as a fourth category (the list holds only
 * screens that exist), and in the header it would add a global control to every screen. This link
 * answers the path of this visit, so it belongs with the body. It stays in the same spot on narrow
 * screens, where the single column puts it at the top.
 *
 * Without a value nothing is rendered. A disabled link would read as 'there is a place to return
 * to, but you cannot go there now.'
 */
function SettingsReturnLink() {
	const from = useSearch({
		from: "/(app)/settings",
		select: (search) => search.from,
	});
	if (!from) return null;
	return (
		<Link
			to={from}
			className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
		>
			<ArrowLeft aria-hidden="true" className="size-4" />
			{settingsReturnLabel()}
		</Link>
	);
}
