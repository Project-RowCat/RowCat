import { space } from "@rowcat/design";
import {
	AppBar,
	Button,
	EmptyState,
	ErrorState,
	Notice,
	Screen,
	Spinner,
	screenPadding,
} from "@rowcat/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import {
	useAuthoringScope,
	useMobileLocalScope,
} from "../../lib/local-data/scope.tsx";
import { useLocalDrafts } from "../../lib/local-data/use-drafts.ts";
import { resolveAppPhase } from "../../lib/session-state.ts";
import { PrimaryNav } from "../shell/primary-nav.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import {
	CREATE_GUEST,
	CREATE_NEW_LABEL,
	CREATE_NEW_PENDING_LABEL,
	CREATE_STORAGE_ERROR,
	CREATE_TITLE,
	CREATE_UNAVAILABLE,
	DRAFT_CREATE_FAILURE,
} from "./create-copy.ts";
import {
	type CreateView,
	createViewParams,
	readCreateViewParam,
} from "./create-view.ts";
import { CreateWorkspaceNavigation } from "./create-workspace-navigation.tsx";
import { CreatorAnalyticsPanel } from "./creator-analytics-panel.tsx";
import { CreatorCommentsPanel } from "./creator-comments-panel.tsx";
import { DraftListPanel } from "./draft-list-panel.tsx";
import { PublishedWorkPanel } from "./published-work-panel.tsx";

/**
 * `Create`, the home of the creation workspace; same IA as the web's `/create`. Four tabs hold two
 * kinds of creator resource plus two facts about one of them:
 * - drafts: this device's editing original (SQLite, write-signal subscription, E2EE sync)
 * - published: the publication on the server (Postgres, API, TanStack Query)
 * - analytics: that publication's performance (Postgres aggregation, API, TanStack Query)
 * - comments: what others said on my works (Postgres, API, TanStack Query)
 *
 * - Drawing four tabs on one screen is no reason to merge ownership. The screen composes while
 *   the data layers stay split. Drafts in the query cache would create two truths, and a
 *   publication copied into SQLite would survive an account switch on the device.
 * - Only the active tab mounts. Mounting all and hiding would prefetch `Published` and `Analytics` for
 *   someone on the drafts tab. Those requests fail offline for sections nobody sees, and opening
 *   `/create` would run server aggregation, losing this screen's local-first character.
 * - Tabs, not a closed `Select`. That spot was a `Select` for a while on the claim that the app
 *   had no tab primitive, which was never true: the settings screen already uses tabs
 *   (`features/settings/settings-navigation.tsx`). The row lives in
 *   `create-workspace-navigation.tsx`. The address stays the source of truth (`?view=`): `useState`
 *   would break back navigation and lose the tab after visiting a work detail.
 */
export function CreateScreen() {
	const router = useRouter();
	const { session } = useMobileIdentity();
	const localScope = useMobileLocalScope();
	const { ensureStore, ownsStore } = useAuthoringScope();
	const drafts = useLocalDrafts();

	const params = useLocalSearchParams<{ view?: string | string[] }>();
	const view = readCreateViewParam(params.view);
	const phase = resolveAppPhase(session, localScope.status);

	// A double press in the same tick must not create two drafts; `setState` is too late for that.
	const creatingRef = useRef(false);
	const [creating, setCreating] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const onCreate = useCallback(async () => {
		if (creatingRef.current) return;
		// Lock before the first `await`.
		creatingRef.current = true;
		setCreating(true);
		try {
			const store = await ensureStore();
			// Scope could not open: nowhere to create, so do nothing.
			if (!store) {
				setFailure(DRAFT_CREATE_FAILURE);
				return;
			}
			const draft = await store.createDraft();
			/**
			 * If the account changed while creating, do not navigate: the draft stays as the previous
			 * account's device data (back in the list when that account returns), and the current user is
			 * not sent to someone else's draft address.
			 */
			if (!ownsStore(store)) return;
			setFailure(null);
			router.push(`/create/${encodeURIComponent(draft.id)}`);
		} catch {
			setFailure(DRAFT_CREATE_FAILURE);
		} finally {
			creatingRef.current = false;
			setCreating(false);
		}
	}, [ensureStore, ownsStore, router]);

	const canCreate = phase === "ready";

	return (
		<Screen>
			{/**
			 * The drawer trigger is absent: this screen is the home of a primary destination so the nav
			 * row stands at the bottom, and there is one global navigation surface at a time
			 * (`features/shell/primary-nav.tsx`). Back and global utilities stay. This bar alone owns the
			 * title (same rule as account, notifications and the conversation list). `New story` is not
			 * here either: it is this screen's action, not a global utility, and at 320pt four 44pt
			 * targets leave no room for the title.
			 */}
			<AppBar
				title={CREATE_TITLE}
				onBack={() => router.back()}
				actions={<ShellUtilities />}
			/>

			{/**
			 * The action stands above the tab row, as on the web (button on the title row, tabs below).
			 * The header owns the title here, so one button remains on that row, at the right end. It
			 * does not go inside the tab row: settings' `Manage account` sits there because it is a text link,
			 * and a filled primary button beside the `tablist` would make the action read before the tabs.
			 */}
			{canCreate ? (
				<View style={screen.toolbar}>
					<Button
						label={creating ? CREATE_NEW_PENDING_LABEL : CREATE_NEW_LABEL}
						icon="add"
						busy={creating}
						onPress={() => void onCreate()}
					/>
				</View>
			) : null}

			{/*
			 * The tab row stays for guest, undetermined and storage failure too. This diverges from the
			 * button above on character: a button that does nothing when pressed reads as broken, while
			 * this row is navigation IA saying what exists here, so even someone seeing the sign-in
			 * prompt can learn that `Published` and `Analytics` are here.
			 */}
			<View style={screen.tabs}>
				<CreateWorkspaceNavigation
					view={view}
					draftCount={drafts.value.length}
					onSelect={(next) => router.setParams(createViewParams(next))}
				/>
			</View>

			{failure ? (
				<View style={screen.notice}>
					<Notice message={failure} tone="destructive" />
				</View>
			) : null}

			{/**
			 * The active tab takes all remaining height. The bottom nav row is a sibling, so without this
			 * box short branches (guest prompt, empty list, error) float that row mid-screen.
			 */}
			<View style={screen.body}>
				<CreatePanel
					view={view}
					phase={phase}
					drafts={drafts}
					onRetryScope={localScope.retry}
					onCreate={onCreate}
					creating={creating}
				/>
			</View>

			{/** Bottom primary nav; this screen is the home of the `Create` section. */}
			<PrimaryNav />
		</Screen>
	);
}

/**
 * One of the four tabs. Identity and storage diverge only on the drafts tab; the other three are
 * server resources with nothing to draw for guest or undetermined, so a shared gate stands in
 * front. Without it a guest picking `Analytics` gets a 401 drawn as "Couldn't load", hiding that sign-in is
 * needed.
 */
function CreatePanel({
	view,
	phase,
	drafts,
	onRetryScope,
	onCreate,
	creating,
}: {
	view: CreateView;
	phase: ReturnType<typeof resolveAppPhase>;
	drafts: ReturnType<typeof useLocalDrafts>;
	onRetryScope: () => void;
	onCreate: () => Promise<void>;
	creating: boolean;
}) {
	const router = useRouter();

	// Neutral wait: never draw the sign-in prompt for even one frame first.
	if (phase === "booting")
		return (
			<View style={screen.center}>
				<Spinner />
			</View>
		);

	if (phase === "guest")
		return (
			<View style={screen.center}>
				<EmptyState
					icon="create"
					title={CREATE_GUEST.title}
					description={CREATE_GUEST.description}
					actionLabel={CREATE_GUEST.action}
					onAction={() =>
						router.push({
							pathname: "/login",
							params: { redirect: "/create" },
						})
					}
				/>
			</View>
		);

	// Not a sign-out: no sign-in button is drawn; the task is to ask again.
	if (phase === "unavailable")
		return (
			<View style={screen.center}>
				<Notice message={CREATE_UNAVAILABLE} />
			</View>
		);

	/**
	 * Storage failed to open: only the drafts tab is blocked. The three server tabs have nothing to do
	 * with SQLite and still draw; blocking them would hide a person's publication list just because a
	 * device file will not open.
	 */
	if (phase === "local-error" && view === "drafts")
		return (
			<View style={screen.center}>
				<ErrorState
					message={CREATE_STORAGE_ERROR.message}
					actionLabel={CREATE_STORAGE_ERROR.action}
					onAction={onRetryScope}
				/>
			</View>
		);

	if (view === "published") return <PublishedWorkPanel drafts={drafts.value} />;
	if (view === "analytics") return <CreatorAnalyticsPanel />;
	if (view === "comments") return <CreatorCommentsPanel />;
	return (
		<DraftListPanel
			phase={phase}
			drafts={drafts}
			onRetryScope={onRetryScope}
			onCreate={onCreate}
			creating={creating}
		/>
	);
}

const screen = StyleSheet.create({
	// The bottom nav row is a sibling; the tab takes the remaining height.
	body: { flex: 1 },
	// One action at the right end, doing what the web title row does with `justify-between`.
	toolbar: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "flex-end",
		paddingHorizontal: screenPadding,
		paddingVertical: space.sm,
	},
	/**
	 * The tab row's border runs across the screen width (like the web's `<nav className="border-b">`).
	 * Side padding belongs to the tabs while the line goes past it; stopping inside would read as a
	 * list divider rather than a section divider.
	 */
	tabs: { paddingHorizontal: space.sm },
	notice: { paddingBottom: space.sm, paddingHorizontal: screenPadding },
	center: { paddingHorizontal: screenPadding, paddingTop: space.xl },
});
