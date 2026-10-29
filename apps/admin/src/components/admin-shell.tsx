import { APP_NAME } from "@rowcat/domain";
import { resetAdminState, viewerQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { useQueryClient } from "@tanstack/react-query";
import {
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import {
	CreditCard,
	FileText,
	LayoutDashboard,
	LogOut,
	Moon,
	ScrollText,
	ShieldAlert,
	SlidersHorizontal,
	Smartphone,
	Sun,
	Users,
} from "lucide-react";
import { useEffect } from "react";
import { SIGN_OUT_FAILED } from "#/features/auth/auth-error.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { authClient } from "#/lib/auth.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import { resolveOperatorAccess } from "#/lib/operator.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import { useTheme } from "#/lib/theme.tsx";
import { showErrorToast } from "#/lib/toast.ts";
import { ErrorBlock, LoadingBlock, OfflineBlock } from "./states.tsx";

/**
 * The console shell: authorization boundary and navigation surface.
 *
 * - The gate covers every child instead of a per-route `beforeLoad`; a missed route does not
 *   error, it just opens. Here the tree structure holds that guarantee.
 * - The gate is flicker prevention, not authorization. The real refusal is the server's 403 on
 *   every lookup; this keeps the privileged shell from drawing before access resolves.
 * - The IA is not the consumer app's three fixed destinations. Each destination here is a
 *   question an operator must answer:
 *
 * ```text
 * Overview          is the service healthy now
 * Moderation        what to look at first        ← the most used screen
 * Appeals           who is appealing
 * Members           what happened to this person
 * Stories           what is this content
 * Mobile updates    which mobile code is out and how far it spread
 * Operations        what can be switched off now
 * Audit             who did what
 * ```
 */

interface NavItem {
	to: string;
	label: string;
	icon: typeof LayoutDashboard;
	/** Destinations with child paths match by prefix unless set. */
	exact?: boolean;
}

const NAV: NavItem[] = [
	{ to: "/", label: "Overview", icon: LayoutDashboard, exact: true },
	{ to: "/moderation", label: "Moderation", icon: ShieldAlert, exact: true },
	{
		to: "/moderation/appeals",
		label: "Appeals",
		icon: ScrollText,
		exact: true,
	},
	{ to: "/members", label: "Members", icon: Users },
	{ to: "/stories", label: "Stories", icon: FileText },
	{ to: "/mobile-updates", label: "Mobile updates", icon: Smartphone },
	{ to: "/operations", label: "Operations", icon: SlidersHorizontal },
	{ to: "/audit", label: "Audit", icon: CreditCard },
];

/**
 * The single active-state rule. Not `Link`'s `activeProps`: its prefix matching lights both
 * `/moderation` and `/moderation/appeals` on the appeals screen, invisibly.
 */
export function isNavActive(item: NavItem, pathname: string): boolean {
	if (item.exact) return pathname === item.to;
	return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const isDark =
		theme === "dark" ||
		(theme === "system" &&
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
			onClick={() => setTheme(isDark ? "light" : "dark")}
		>
			{isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
		</Button>
	);
}

/**
 * Not sent to login: showing a signed-in person the login screen suggests another account would
 * work, when what they need is a role grant they cannot give themselves.
 */
function ForbiddenScreen({ onSignOut }: { onSignOut: () => void }) {
	return (
		<div className="flex min-h-dvh items-center justify-center p-6">
			<div className="w-full max-w-md space-y-4 text-center">
				<ShieldAlert
					className="mx-auto size-8 text-muted-foreground"
					aria-hidden
				/>
				<div>
					<h1 className="font-semibold text-lg">No operator access</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						This account has no access to the operations console. If you need
						it, ask an admin to grant you a role; signing in again will not
						change anything.
					</p>
				</div>
				<Button variant="outline" onClick={onSignOut}>
					Sign in with another account
				</Button>
			</div>
		</div>
	);
}

export function AdminShell() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const viewerQuery = useAdminQuery(viewerQueryOptions(getRowCatClient()));

	const access = resolveOperatorAccess({
		pending: viewerQuery.isPending,
		viewer: viewerQuery.data,
		failed: viewerQuery.isError,
	});

	/**
	 * Navigate in an effect: during render React discards the render and warns (twice under
	 * StrictMode). The return path brings an operator whose session expired back to their screen.
	 */
	useEffect(() => {
		if (access !== "guest") return;
		navigate({
			to: "/login",
			search: { redirect: pathname },
			replace: true,
		});
	}, [access, navigate, pathname]);

	const signOut = async () => {
		try {
			await authClient.signOut();
		} catch {
			/**
			 * This operation has no surface to show failure on, and staying silent lets an operator walk
			 * away believing they signed out of a screen holding emails and sanction history. Stop here:
			 * clearing the cache and going to login with a live session would just bounce back to the
			 * console, and the operator would never learn they are still signed in.
			 */
			showErrorToast(SIGN_OUT_FAILED);
			return;
		}
		/**
		 * Reset, not invalidate: this prefix holds members' emails, sanction history and private titles,
		 * which invalidation would keep drawing for the next person until refetch ends.
		 */
		await resetAdminState(queryClient);
		queryClient.clear();
		navigate({ to: "/login", replace: true });
	};

	/**
	 * Unreachable and refused are kept apart: folded, the first screen opened during an incident draws
	 * `Failed to fetch`, though one needs the connection fixed and the other the session.
	 */
	if (access === "loading")
		return (
			<div className="mx-auto max-w-md space-y-4 p-8">
				{viewerQuery.isError && viewerQuery.unreachable ? (
					<OfflineBlock onRetry={viewerQuery.retry} />
				) : viewerQuery.isError ? (
					<ErrorBlock
						title="Couldn't verify operator access"
						error={viewerQuery.error}
						onRetry={viewerQuery.retry}
					/>
				) : (
					<LoadingBlock rows={2} />
				)}
			</div>
		);

	// The effect above navigates; this branch only keeps the privileged screen undrawn meanwhile.
	if (access === "guest") return <LoadingBlock rows={2} />;
	if (access === "forbidden") return <ForbiddenScreen onSignOut={signOut} />;

	const viewer = viewerQuery.data;

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-border border-b bg-background/95 px-4 backdrop-blur">
				<span className="font-semibold text-sm">{APP_NAME} Operations</span>
				{/**
				 * No API-origin badge here. It used to exist ("pressing in production thinking it is
				 * staging"), but it usually said `localhost:3001`; an always-on indicator with no
				 * information stops being read, even when it differs. The overview's service card says
				 * which environment this is, where operators actually look.
				 */}
				<div className="ml-auto flex items-center gap-2">
					<span className="hidden text-muted-foreground text-xs sm:inline">
						{viewer?.nickname}
					</span>
					<Badge variant={viewer?.role === "admin" ? "default" : "secondary"}>
						{viewer?.role}
					</Badge>
					<ThemeToggle />
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Sign out"
						onClick={signOut}
					>
						<LogOut className="size-4" />
					</Button>
				</div>
			</header>

			<div className="flex flex-1 items-stretch">
				<nav
					aria-label="Operations console"
					className="hidden w-52 shrink-0 border-border border-r p-2 lg:block"
				>
					<ul className="space-y-0.5">
						{NAV.map((item) => {
							const active = isNavActive(item, pathname);
							const Icon = item.icon;
							return (
								<li key={item.to} className="relative">
									{/**
									 * The background sits under the link (`relative` + `absolute`), so moving it
									 * never shifts the link's text.
									 */}
									{active ? (
										<MotionActiveIndicator
											group="admin-nav-wide"
											className="absolute inset-0 rounded-md bg-muted"
										/>
									) : null}
									<Link
										to={item.to}
										// Active state comes from `isNavActive`, not `activeProps`.
										aria-current={active ? "page" : undefined}
										className={`relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
											active
												? "font-medium text-foreground"
												: "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
										}`}
									>
										<Icon className="size-4 shrink-0" aria-hidden />
										{item.label}
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>

				{/**
				 * Narrow screens get the same list as a row, from the same array (one navigation IA).
				 * Both lists are in the DOM (CSS hides one), so the indicator namespaces differ —
				 * a shared `layoutId` would fly between sidebar and row.
				 */}
				<div className="flex min-w-0 flex-1 flex-col">
					<nav
						aria-label="Operations console (narrow screen)"
						className="overflow-x-auto border-border border-b px-2 py-1.5 lg:hidden"
					>
						<ul className="flex gap-1">
							{NAV.map((item) => {
								const active = isNavActive(item, pathname);
								return (
									<li key={item.to} className="relative">
										{active ? (
											<MotionActiveIndicator
												group="admin-nav-compact"
												className="absolute inset-0 rounded-md bg-muted"
											/>
										) : null}
										<Link
											to={item.to}
											aria-current={active ? "page" : undefined}
											className={`relative block whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors ${
												active
													? "font-medium text-foreground"
													: "text-muted-foreground"
											}`}
										>
											{item.label}
										</Link>
									</li>
								);
							})}
						</ul>
					</nav>
					<main className="min-w-0 flex-1 p-4 lg:p-6">
						<Outlet />
					</main>
				</div>
			</div>
		</div>
	);
}
