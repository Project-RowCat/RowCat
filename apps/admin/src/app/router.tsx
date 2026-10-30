import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { AdminShell } from "#/components/admin-shell.tsx";
import { AuditPage } from "#/features/audit/audit-page.tsx";
import { LoginPage } from "#/features/auth/login-page.tsx";
import { MemberDetailPage } from "#/features/members/member-detail-page.tsx";
import { MembersPage } from "#/features/members/members-page.tsx";
import { JobDetailPage } from "#/features/mobile-updates/job-detail-page.tsx";
import { MobileUpdatesPage } from "#/features/mobile-updates/mobile-updates-page.tsx";
import { ReleaseDetailPage } from "#/features/mobile-updates/release-detail-page.tsx";
import { AppealsPage } from "#/features/moderation/appeals-page.tsx";
import { QueuePage } from "#/features/moderation/queue-page.tsx";
import { ReportDetailPage } from "#/features/moderation/report-detail-page.tsx";
import { OperationsPage } from "#/features/operations/operations-page.tsx";
import { OverviewPage } from "#/features/overview/overview-page.tsx";
import { SetupPage } from "#/features/setup/setup-page.tsx";
import { StoriesPage } from "#/features/stories/stories-page.tsx";
import { StoryDetailPage } from "#/features/stories/story-detail-page.tsx";

/**
 * The route tree is defined in code. Web uses file-based routing with a generated
 * `routeTree.gen.ts`; at a dozen routes that automation pays nothing back and adds a CLI step and a
 * do-not-touch file. Here the whole IA is visible in one file.
 *
 * - The shell is a branch in the root component, not a layout route: a layout route's id would
 *   enter child paths (`/shell/audit`) and leak into links operators share. It also keeps the
 *   authorization gate outside routes — `AdminShell` covers every child, so a new route is gated
 *   automatically, whereas a missed per-route `beforeLoad` opens silently.
 * - Every search param is optional (see `AdminSearch`). An axis with no value creates no key, so
 *   no `?status=` is left in the address.
 */

export interface AdminRouterContext {
	queryClient: QueryClient;
}

/**
 * One type, all optional, each route filling only its own keys. The router treats keys returned by
 * `validateSearch` as required, so every `Link`/`navigate` to that route would have to carry them —
 * the overview's "unresolved reports" card would need to know the queue's filters.
 *
 * This shape also lets screens change one axis with `search: (previous) => ({ ...previous, ...patch
 * })`; setting an axis to `undefined` removes its key (same rule as mobile's `router.setParams`).
 */
export interface AdminSearch {
	redirect?: string;
	status?: string;
	targetType?: string;
	q?: string;
	role?: string;
	ownerId?: string;
	visibility?: string;
	hidden?: string;
	adult?: string;
	operatorId?: string;
	action?: string;
	targetId?: string;
	channel?: string;
	platform?: string;
	runtime?: string;
}

/** No key for a non-string or empty value, so empty params never stay in the address. */
const str = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/**
 * Login and first-run setup sit outside the shell; inside, the operator gate would stand in front of
 * them — a loop for login, and for setup a wall in front of the one screen whose visitor cannot be an
 * operator yet. Setup draws nothing privileged on its own: every request it makes is authorized by the
 * server like any other.
 */
const OUTSIDE_SHELL = new Set(["/login", "/setup"]);

function RootLayout() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (OUTSIDE_SHELL.has(pathname)) return <Outlet />;
	return <AdminShell />;
}

const rootRoute = createRootRouteWithContext<AdminRouterContext>()({
	component: RootLayout,
});

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
	/**
	 * `redirect` is accepted but not trusted; the screen filters it with `safeReturnPath`. Not relying
	 * on this layer alone because this router version passes unvalidated search params to `beforeLoad`
	 * — web learned that trusting one place was an open redirect.
	 */
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		redirect: str(search.redirect),
	}),
});

const setupRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/setup",
	component: SetupPage,
});

const overviewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: OverviewPage,
});

const queueRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/moderation",
	component: QueuePage,
	/**
	 * Filters live in the address so refresh, back and link sharing work without extra code, and
	 * operators can hand each other a queue by link (same rule as the creation workspace tabs).
	 */
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		status: str(search.status),
		targetType: str(search.targetType),
	}),
});

const reportDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/moderation/reports/$reportId",
	component: ReportDetailPage,
	/**
	 * Carries the queue's filters through unread and hands them back to `To queue`; dropping them would lose
	 * the operator's filters and loaded pages on return.
	 */
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		status: str(search.status),
		targetType: str(search.targetType),
	}),
});

const appealsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/moderation/appeals",
	component: AppealsPage,
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		status: str(search.status),
	}),
});

const membersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/members",
	component: MembersPage,
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		q: str(search.q),
		status: str(search.status),
		role: str(search.role),
	}),
});

const memberDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/members/$memberId",
	component: MemberDetailPage,
});

const storiesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/stories",
	component: StoriesPage,
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		q: str(search.q),
		ownerId: str(search.ownerId),
		visibility: str(search.visibility),
		hidden: str(search.hidden),
		adult: str(search.adult),
	}),
});

const storyDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/stories/$storyId",
	component: StoryDetailPage,
});

/**
 * Mobile updates have their own destination rather than a section of `/operations`: that screen
 * answers "what can I switch off now" (breakers), and the operation here is deploying remote code —
 * it must not sit where someone scrolling to a breaker would meet it. Filters are in the address so operators can share links.
 *
 * Job detail is `/mobile-updates/jobs/$jobId`, the same depth as release detail; the static `jobs`
 * segment matches before the dynamic one, and release ids are UUIDs.
 */
const mobileUpdatesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mobile-updates",
	component: MobileUpdatesPage,
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		channel: str(search.channel),
		platform: str(search.platform),
		status: str(search.status),
		runtime: str(search.runtime),
	}),
});

const mobileUpdateJobRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mobile-updates/jobs/$jobId",
	component: JobDetailPage,
});

const mobileUpdateReleaseRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mobile-updates/$releaseId",
	component: ReleaseDetailPage,
});

const operationsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/operations",
	component: OperationsPage,
});

const auditRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/audit",
	component: AuditPage,
	validateSearch: (search: Record<string, unknown>): AdminSearch => ({
		operatorId: str(search.operatorId),
		action: str(search.action),
		targetId: str(search.targetId),
	}),
});

const routeTree = rootRoute.addChildren([
	loginRoute,
	setupRoute,
	overviewRoute,
	queueRoute,
	appealsRoute,
	reportDetailRoute,
	membersRoute,
	memberDetailRoute,
	storiesRoute,
	storyDetailRoute,
	mobileUpdatesRoute,
	mobileUpdateJobRoute,
	mobileUpdateReleaseRoute,
	operationsRoute,
	auditRoute,
]);

export function createAdminRouter(queryClient: QueryClient) {
	return createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		scrollRestoration: true,
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createAdminRouter>;
	}
}
