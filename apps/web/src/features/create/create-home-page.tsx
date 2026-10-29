import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Link, useNavigate } from "@tanstack/react-router";
import { PenLine, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalDrafts } from "#/lib/local-authoring/hooks.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { showErrorToast } from "#/lib/toast.ts";
import { Route } from "#/routes/(app)/create/index.tsx";
import { CreatorAnalyticsPanel } from "./analytics/panel.tsx";
import { CreatorCommentsPanel } from "./comments/panel.tsx";
import {
	analyticsWindowFromSearch,
	createSearchForAnalyticsWindow,
	createViewFromSearch,
} from "./create-search.ts";
import { CreateShell } from "./create-shell.tsx";
import { CreateHomeSkeleton } from "./create-skeleton.tsx";
import { CreateWorkspaceNavigation } from "./create-workspace-navigation.tsx";
import { DraftList } from "./drafts/list.tsx";
import { draftCreateFailureMessage } from "./editor/failure.ts";
import { PublishedWorkList } from "./publishing/work-list.tsx";

/**
 * - The create home is the workspace's landing screen. It shows three kinds of resource: drafts
 *   (the device-local editing source: IndexedDB, liveQuery, E2EE sync), published works (server
 *   data: Postgres, API, TanStack Query), and analytics (server aggregates for those works).
 * - Showing three sections on one screen does not justify merging their ownership. A draft
 *   entering the query cache would create two sources of truth, and copying published works into
 *   IndexedDB would leave them on the device after an account change. Analytics has no local copy,
 *   since the server is the authority for metrics.
 * - No new sidebar destinations. The app's navigation is fixed at three items
 *   (components/app-shell/app-sidebar.tsx), which keeps the canvas from becoming a sidebar row. All
 *   three sections are tabs inside this canvas, and the current one is read from the URL.
 * - This is not a dashboard. Metric cards show only measured values: no invented scores, charts,
 *   or period axes (creator-analytics.tsx). Drafts remain the default view.
 */

export function CreateHomePage() {
	const { t } = useTranslation(["create", "common"]);
	const navigate = useNavigate();
	const { ensureStore, ownsStore, status } = useAuthoringScope();
	const { items, loading } = useLocalDrafts();

	/**
	 * The active section is decided by the URL, not by shadow state. Two sources would let back
	 * navigation revert only one of them. This follows the same rule as reading the active resource
	 * from route parameters.
	 */
	const search = Route.useSearch();
	const view = createViewFromSearch(search);

	/**
	 * Prevents a double click in the same tick from creating two drafts. setState is too late for
	 * this.
	 */
	const creatingRef = useRef(false);
	const [creating, setCreating] = useState(false);

	const onCreate = async () => {
		if (creatingRef.current) return;
		creatingRef.current = true;
		setCreating(true);
		try {
			const store = await ensureStore();
			if (!store) return;
			const draft = await store.createDraft();
			/**
			 * If the account changed while creating, do not navigate. The draft stays on the device as data
			 * of the previous account (it reappears in the list when that account signs back in), and the
			 * current user should not be sent to another user's draft address.
			 */
			if (!ownsStore(store)) return;
			await navigate({
				to: "/create/$draftId",
				params: { draftId: draft.id },
			});
		} catch (error) {
			/**
			 * This is a toast because the button is leaving the screen. On success the screen becomes the
			 * editor, so a failure message placed here would never be shown on the success path. Staying
			 * silent would leave `New draft` pressed with nothing happening. The early return when the scope
			 * cannot be opened does not reach this point: the user is already being sent to sign-in, and an
			 * extra message on top would read as unrelated to what they just did.
			 */
			console.error("[create] couldn't create the draft", error);
			showErrorToast(draftCreateFailureMessage());
		} finally {
			creatingRef.current = false;
			setCreating(false);
		}
	};

	/**
	 * Storage has not opened yet, which is not the same as having zero drafts. Showing 'no drafts yet'
	 * during the open would make a user with drafts think they lost everything. The gate shows the
	 * same placeholder the route renders, so nothing changes at the handoff. It does not wait for
	 * published works, since a server-state gate would leave offline users on a permanent placeholder
	 * even though their drafts are on the device. `unavailable` does not count as a wait: it means
	 * guest, which has no database to open (local-data/scope.tsx), so waiting on it would never end.
	 * Activating members, whose database is still opening, stay on the placeholder
	 * (chat-library-page.tsx does the same).
	 */
	if (loading && status !== "unavailable")
		return (
			<CreateShell>
				<CreateHomeSkeleton />
			</CreateShell>
		);

	/**
	 * The scope cannot be opened, and the screen says so. Showing zero drafts would be a lie, and a
	 * user with written drafts would read 'no drafts' as their work being gone. Drafts are kept per
	 * account on the device, so signing in again restores them. That fact is all this message needs to
	 * say.
	 */
	if (status === "unavailable")
		return (
			<CreateShell>
				<PageEnter>
					<h1 className="mb-5 text-2xl font-black tracking-tight sm:text-3xl">
						{t("createHomePage.create")}
					</h1>
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<PenLine />
							</EmptyMedia>
							<EmptyTitle>{t("createHomePage.createCanTBeOpened")}</EmptyTitle>
							<EmptyDescription>
								{t("createHomePage.draftsAreSavedOnThis")}
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Link
								to="/login"
								search={{ redirect: "/create" }}
								className={buttonVariants({ variant: "default", size: "sm" })}
							>
								{t("createHomePage.signIn")}
							</Link>
						</EmptyContent>
					</Empty>
				</PageEnter>
			</CreateShell>
		);

	return (
		<CreateShell>
			{/*
			 * The shell of this screen has width only, since the title sits in the body. The entrance therefore
			 * wraps the header too, because both arrive when the placeholder goes away.
			 */}
			<PageEnter>
				{/*
				 * The header and navigation row are one block. Title and actions sit on top, the three sections
				 * just
				 * below, and the list uses the navigation row's line as its upper edge. Equal spacing between the
				 * three
				 * would leave the navigation row floating and belonging to neither the title nor the list. That is
				 * why
				 * the gap under the title (mb-3) is narrower than the gap under the navigation row (mt-4).
				 */}
				<header className="mb-3 flex items-center justify-between gap-3">
					{/*
					 * The product name stays `Create` alone. Do not make `Creator Studio` a second title: if the sidebar
					 * name differs from the screen title, users think they have gone somewhere else.
					 */}
					<h1 className="text-2xl font-black tracking-tight sm:text-3xl">
						{t("createHomePage.create")}
					</h1>
					{/*
					 * The button says `New story` (new work), not `New draft` (new draft). The user creates a work, and a draft
					 * is the storage format. Putting the internal structure name on the button would make the product
					 * describe its implementation. Pressing it still creates a draft locally, with no server request.
					 */}
					<Button
						disabled={creating}
						onClick={() => {
							void onCreate();
						}}
					>
						<Plus aria-hidden="true" />
						{creating
							? t("createHomePage.creating")
							: t("createHomePage.newStory")}
					</Button>
				</header>

				<CreateWorkspaceNavigation search={search} draftCount={items.length} />

				{/*
				 * Only the active section is rendered. If all three stay mounted and hidden, a user on the draft
				 * section would have the browser prefetch published works and analytics, and those requests fail
				 * offline for sections they cannot see. Opening /create would then run server aggregation, which
				 * would break the local-first behavior of this screen. There is no slide transition between
				 * sections:
				 * they are three contents of one screen, not navigation, and sliding would read as a route change.
				 */}
				<div className="mt-4">
					{view === "drafts" && (
						<DraftList items={items} onCreate={onCreate} creating={creating} />
					)}
					{view === "published" && <PublishedWorkList drafts={items} />}
					{view === "analytics" && (
						<CreatorAnalyticsPanel
							window={analyticsWindowFromSearch(search)}
							/**
							 * The analytics time window changes through the URL, the same as the section tabs. `replace`
							 * is used so that after switching windows four times, back navigation does not step back
							 * through each change.
							 */
							onWindowChange={(window) =>
								void navigate({
									to: "/create",
									search: createSearchForAnalyticsWindow(window),
									replace: true,
								})
							}
						/>
					)}
					{view === "comments" && <CreatorCommentsPanel />}
				</div>
			</PageEnter>
		</CreateShell>
	);
}
