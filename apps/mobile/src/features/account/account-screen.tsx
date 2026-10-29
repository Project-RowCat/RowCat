import { space } from "@rowcat/design";
import type { Viewer } from "@rowcat/domain";
import {
	AppBar,
	EmptyState,
	KeyboardLayout,
	Notice,
	Screen,
	Spinner,
	screenPadding,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { AccountModerationSection } from "../moderation/account-moderation-section.tsx";
import { MyReportsSection } from "../moderation/my-reports-section.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import {
	ACCOUNT_GUEST,
	ACCOUNT_RETRY_LABEL,
	ACCOUNT_STATUS_NOTE,
	ACCOUNT_STATUS_NOTICE,
	ACCOUNT_TITLE,
	ACCOUNT_UNAVAILABLE,
} from "./account-copy.ts";
import { resolveAccountScreenState } from "./account-state.ts";
import { ContentSection } from "./content-section.tsx";
import { DataSection } from "./data-section.tsx";
import { DeleteAccountSection } from "./delete-account-section.tsx";
import { DeletionTerminal } from "./deletion-terminal.tsx";
import { ProfileSection } from "./profile-section.tsx";
import { SecuritySection } from "./security-section.tsx";
import {
	type AccountDeletion,
	useAccountDeletion,
} from "./use-account-deletion.ts";

/**
 * Native counterpart of web `/account`: private self-management. Sections: profile, usage
 * restrictions, my reports, content display, security. The two personal-moderation sections get
 * their meaning from `features/moderation`; this screen only composes them (`Restrictions` draws nothing
 * for most accounts).
 *
 * - The old read-only `Account details` section became `Security` once it gained actions; keeping both would show
 *   the same values twice with only one actionable. The security sub-sections stay inside this
 *   screen; there is no `/account/security` route.
 * - Account is not settings: it covers server state the account owns. No placeholder categories
 *   for app-behaviour settings that have no screen here.
 * - Everything drawn is server truth (viewer, public profile, account details). Device storage is
 *   irrelevant, and changing account settings never changes `Viewer.id`, so the per-member SQLite
 *   lifetime is untouched (`account-state.ts` header).
 * - Restricted (suspended/blocked) accounts still enter: they need to read their status, turn
 *   adult display off and sign out. Only profile writes are locked, and each field says so.
 * - Form drafts are keyed to the viewer (`key={viewer.id}`) so Alice's half-typed nickname never
 *   appears in Bob's form. A switch already folds the session to `booting` and unmounts the tree,
 *   but the guarantee is also written structurally rather than left to render order.
 */
export function AccountScreen() {
	const router = useRouter();
	const identity = useMobileIdentity();
	const { session } = identity;
	const state = resolveAccountScreenState(session.phase);
	// Deletion state lives outside the member branch: once the server confirms, cache reset clears the
	// viewer and unmounts that branch, which would take the terminal panel with it. The deletion
	// target is a copy taken at request time (`deletion-turn.ts`).
	const deletion = useAccountDeletion();

	return (
		<Screen>
			{/* The title lives in this bar only (same rule as notifications and the chat list). The account
			    menu stays on the right with its active state, so the utility slot means the same on every
			    screen. */}
			<AppBar
				navigation={<AppSidebarTrigger />}
				title={ACCOUNT_TITLE}
				onBack={() => router.back()}
				actions={<ShellUtilities />}
			/>

			<KeyboardLayout>
				<ScrollView
					contentContainerStyle={screen.content}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
				>
					{deletion.terminal ? (
						/* The account is gone; no section is redrawn. Returning to the normal branch would send private
						   queries into a deleted session and a wall of 401s, which reads as a failure to someone who
						   just deleted their account. */
						<DeletionTerminal deletion={deletion} />
					) : state.kind === "booting" ? (
						/* Neutral wait; never flash the sign-in prompt first. */
						<View style={screen.center}>
							<Spinner />
						</View>
					) : state.kind === "guest" ? (
						/* Do not bounce guests to sign-in; let them read why they cannot see this first. */
						<View style={screen.center}>
							<EmptyState
								icon="account"
								title={ACCOUNT_GUEST.title}
								description={ACCOUNT_GUEST.description}
								actionLabel={ACCOUNT_GUEST.action}
								onAction={() => {
									identity.clearFailure();
									router.push({
										pathname: "/login",
										/* Returns here after sign-in; validated by `return-path.ts`. */
										params: { redirect: "/account" },
									});
								}}
							/>
						</View>
					) : state.kind === "unavailable" ? (
						/* Not a sign-out; asking again is all that can be done here. */
						<View style={screen.center}>
							<Notice
								message={ACCOUNT_UNAVAILABLE}
								actionLabel={ACCOUNT_RETRY_LABEL}
								onAction={identity.retry}
							/>
						</View>
					) : session.viewer ? (
						<AccountContent
							key={session.viewer.id}
							viewer={session.viewer}
							deletion={deletion}
						/>
					) : null}
				</ScrollView>
			</KeyboardLayout>
		</Screen>
	);
}

function AccountContent({
	viewer,
	deletion,
}: {
	viewer: Viewer;
	deletion: AccountDeletion;
}) {
	return (
		/* The body arrived; the header stays outside (`lib/motion/page-enter.tsx`). Not applied to the
		   placeholder, guest or unknown branches: those mean "not here yet" and animating them doubles
		   the wait. */
		<PageEnter style={screen.stack}>
			{/* One sentence for restricted accounts only; an always-visible "normal" badge on `approved` is
			    decoration. Reason, deadline and appeal are not invented here; the `Restrictions` section below
			    answers them with its own query. */}
			{viewer.status !== "approved" ? (
				<Notice
					tone="destructive"
					message={`${ACCOUNT_STATUS_NOTICE[viewer.status]} ${ACCOUNT_STATUS_NOTE}`}
				/>
			) : null}
			<ProfileSection viewer={viewer} />
			{/* The two moderation sections come right after the profile: restricted users mostly open this
			    screen to learn "why not", so the answer must not sit past content and security. Kept
			    separate because the axes are opposite (what happened to me vs what I requested). Same order
			    as web `account-page.tsx`. */}
			<AccountModerationSection />
			<MyReportsSection />
			<ContentSection viewer={viewer} />
			{/* The private queries (security's three, and the two moderation ones) mount only inside this
			    branch, so none go out before the member is confirmed (the gate is mounting, not `enabled`).
			    Each failure ends in its own section. */}
			<SecuritySection />
			{/* Order follows the questions: security (how do I get in) -> data (what is stored) -> deletion.
			    Deletion stays split off at the bottom so an irreversible action never sits beside
			    reversible settings. */}
			<DataSection />
			<DeleteAccountSection deletion={deletion} />
		</PageEnter>
	);
}

const screen = StyleSheet.create({
	content: { gap: space.lg, padding: screenPadding },
	stack: { gap: space.lg },
	center: { gap: space.md, paddingTop: space.xl },
});
