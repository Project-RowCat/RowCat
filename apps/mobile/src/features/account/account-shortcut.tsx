import { DropdownMenu, MenuItem, MenuSeparator } from "@rowcat/ui-native";
import { usePathname, useRouter } from "expo-router";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { mobileShellRouteFor } from "../shell/shell-route.ts";
import {
	ACCOUNT_MENU_ITEM,
	ACCOUNT_MENU_SETTINGS,
	ACCOUNT_MENU_SIGN_OUT,
	accountMenuLabel,
} from "./account-copy.ts";

/**
 * Account menu: the second global shell utility. Same slot, items and order as the web header's
 * account menu (`Account` -> `Settings` -> `Sign out`).
 *
 * - Sign-out has one owner. The discover header used to draw the nickname and a sign-out button
 *   directly; two surfaces side by side cannot say which is canonical and soon behave differently.
 *   Sign-out calls the existing transition owner (`identity.signOut` -> `session-transition.ts`),
 *   which owns cookie, cache and local-scope cleanup. It does not erase this device's conversations
 *   or drafts (the same account signing in again opens the same files).
 * - `Settings` lives here, diverging from web, because of width: at 320pt three header utilities fight
 *   the title, and settings does not call you while you look at this screen. The header keeps only
 *   the bell and this menu (table in `features/shell/shell-utilities.tsx`).
 * - Navigation differs per item: `Account` uses `navigate` (a utility destination you return to, no
 *   stack growth) and `Settings` uses `push` (a short visit whose back must return to the previous
 *   screen). Do not fold them into one function; see `features/settings/settings-shortcut.tsx`.
 * - Guests and unconfirmed sessions get no menu. It answers "what do I do with this account",
 *   which holds for members only; folding those branches in would make this a second copy of the
 *   identity state machine. Sign-in, session retry and the neutral indicator stay with the discover
 *   header (`app-header.tsx`).
 * - While sign-out runs the session folds to `booting` (`resolveSessionState`), so this component
 *   unmounts itself and the header draws the neutral indicator; no second busy spinner here.
 */
export function AccountShortcut() {
	const { session, signOut } = useMobileIdentity();
	// The gate sits outside the queries and the menu: the component below never mounts while the
	// viewer is not a member (same shape as `NotificationShortcut`).
	if (session.phase !== "authenticated" || !session.viewer) return null;
	return (
		<AccountMenu
			nickname={session.viewer.nickname}
			onSignOut={() => void signOut()}
		/>
	);
}

function AccountMenu({
	nickname,
	onSignOut,
}: {
	nickname: string;
	onSignOut: () => void;
}) {
	const router = useRouter();
	const pathname = usePathname();

	// Whether the account screen is current comes from the shell's pure function (`shell-route.ts`);
	// re-writing `pathname.startsWith` here would split route -> shell decisions in two. The trigger
	// stays enabled when active so sign-out still works; state is conveyed by colour and `selected`
	// together.
	const active = mobileShellRouteFor(pathname).utility === "account";

	return (
		<DropdownMenu
			/* The label names whose menu this is; an icon-only trigger reads as just "button". */
			label={accountMenuLabel(nickname)}
			icon="account"
			selected={active}
			tone={active ? "foreground" : "muted-foreground"}
		>
			{/* `navigate`: a global utility returns to its destination; `push` would stack on every open
			    (same call as the notification bell). */}
			<MenuItem
				icon="account"
				label={ACCOUNT_MENU_ITEM}
				onSelect={() => router.navigate("/account")}
			/>
			{/* `push`: settings is a short visit that must return to the screen you came from; `navigate`
			    would land on that destination's own stack position instead. */}
			<MenuItem
				icon="settings"
				label={ACCOUNT_MENU_SETTINGS}
				onSelect={() => router.push("/settings")}
			/>
			<MenuSeparator />
			<MenuItem
				icon="sign-out"
				label={ACCOUNT_MENU_SIGN_OUT}
				onSelect={onSignOut}
			/>
		</DropdownMenu>
	);
}
