import type { ReactNode } from "react";
import { AppHeader } from "./app-header.tsx";
import { AppSidebar } from "./app-sidebar.tsx";
import {
	activeRoomId,
	activeRuntimeStoryId,
	type ShellRoute,
} from "./shell-route.ts";

/**
 * The app shell: **sidebar, header and canvas**. This file holds only the responsibilities of
 * those three.
 *
 * ```text
 * sidebar = global destinations + resume recent conversation
 * header  = which resource am I in + global utilities (settings, account)
 * canvas  = the feature's content
 * ```
 *
 * There is no footer. One stood here only to display what the law required at all times (legal
 * documents, business identity), and the open-source release ships neither. Without that
 * qualification a footer becomes a drawer where sitemaps, social links and announcements arrive one
 * after another.
 *
 * The header used to hold global navigation too, and the left column was a **context shelf**
 * attached only to workspace screens. The change was made for both geometric and hierarchical
 * reasons: the canvas width shifted by 224px from screen to screen, and on a narrow header line the
 * brand, global navigation, list trigger, conversation title and account all competed, so "which
 * conversation is this" was the first thing to be cut off.
 *
 * Instead the sidebar **occupies the same width on every app screen**. This is not an invisible
 * reserved column: on discovery and on settings there are real navigation items in it, so the
 * canvas width does not jump between routes.
 *
 * The direction in which this boundary erodes is always the same. Once the sidebar becomes
 * "leftover space" it fills with settings, theme, sync and search, and the canvas becomes one cell
 * inside the sidebar. What prevents that is the fixed sidebar IA (`app-sidebar.tsx`) and the rule
 * that the header holds all global access.
 *
 * The shell is not re-mounted per route. This component is drawn once by the `(app)` layout route,
 * and only the outlet below it changes. So the sidebar and header stay in place during navigation
 * (the entrance motion belongs only to `PageEnter` inside the canvas), and the sidebar's local
 * subscription is established once for the whole session. Keying anything by path would recreate
 * all of it on every navigation.
 */

/**
 * Source of the header height and the values tied to it. The header's `h-(--shell-header)` reads
 * this variable.
 *
 * The sidebar does not use it: it starts at the top of the screen and takes the full height, while
 * the header starts at the sidebar's right edge.
 */
export const SHELL_HEADER_VAR_CLASS = "[--shell-header:3.5rem]";

export function AppShell({
	shell,
	headerContext,
	children,
}: {
	shell: ShellRoute;
	/** The header's context slot. Only present on screens with an open local resource. */
	headerContext: ReactNode;
	children: ReactNode;
}) {
	/**
	 * Which axis owns scrolling.
	 *
	 * In document mode (the default) the window scrolls: discovery's infinite list, work detail and
	 * the editor all do, and the router's scroll restoration uses those coordinates. Viewport-height
	 * mode is only for conversation, whose record scrolls internally with the input pinned to the
	 * bottom; if the window scrolled too there would be double scrolling.
	 *
	 * Adding a fixed sidebar does not justify making the whole app `100vh overflow-hidden`. That would
	 * turn discovery, works and settings into inner scroll containers and worsen both mobile
	 * address-bar behaviour and scroll restoration.
	 */
	const locked = shell.viewportLocked;

	return (
		<div
			className={`${SHELL_HEADER_VAR_CLASS} flex w-full ${
				locked ? "h-dvh overflow-hidden" : "min-h-dvh"
			}`}
		>
			<AppSidebar
				section={shell.section}
				activeRoomId={activeRoomId(shell.context)}
				activeRuntimeStoryId={activeRuntimeStoryId(shell.context)}
			/>
			<div
				className={`flex min-w-0 flex-1 flex-col ${locked ? "min-h-0" : ""}`}
			>
				<AppHeader
					section={shell.section}
					utility={shell.utility}
					activeRoomId={activeRoomId(shell.context)}
					activeRuntimeStoryId={activeRuntimeStoryId(shell.context)}
					context={headerContext}
				/>
				{/*
				 * The canvas **does not set its width here**. Discovery wants a wide grid, account
				 * a narrow reading column and conversation a prose width. If the shell fixed one
				 * width, every screen would re-wrap its content inside to get its own back. What
				 * lives here is the spatial division only; content width belongs to each feature.
				 */}
				<main
					className={`flex min-w-0 flex-1 flex-col ${locked ? "min-h-0" : ""}`}
				>
					{children}
				</main>
			</div>
		</div>
	);
}
