import { space } from "@rowcat/design";
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
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import {
	SETTINGS_GUEST,
	SETTINGS_RETRY_LABEL,
	SETTINGS_UNAVAILABLE,
} from "./settings-copy.ts";
import {
	type MobileSettingsCategory,
	SETTINGS_TITLE,
	settingsLoginRedirect,
} from "./settings-nav.ts";
import { SettingsNavigation } from "./settings-navigation.tsx";
import { resolveSettingsScreenState } from "./settings-state.ts";

/**
 * Skeleton of the settings workspace: one header, one navigation row, and one slot for category
 * content.
 *
 * The shell belongs to the layout route. Previously `SettingsScreen` was assembled by each category
 * screen (`<SettingsScreen category='ai'>`), so a category was a stack screen and moving between
 * categories swapped the whole screen. The old `General` to `AI` move pushed the entire screen in and
 * rebuilt the row, so the active indicator had no sibling to slide from and simply appeared at the
 * new position. Web keeps the shell and slides one indicator between siblings.
 *
 * Now the shell lives in `app/settings/_layout.tsx` and only what sits under `<Slot />` changes.
 * `MotionIndicatorGroup` survives a category change with its measured frames, so the indicator
 * really moves between siblings. This matches the web's `settings-shell.tsx` at its layout route.
 *
 * Deep links did not change. `/settings`, `/settings/ai` and `/settings/personas` are still the
 * files; the three now have a parent.
 *
 * The entrance is not here. An entrance on the shell would make the navigation row re-enter on
 * every category change, blinking the row and undoing the sliding indicator. The categories own
 * their entrance, as the web's `settings-general-page.tsx` does.
 *
 * The shell is not a store for any value. Each setting reads and writes its own owner: brightness
 * to device storage, account colors to server queries, default generation to the member-scoped
 * preference store, personas to that scope's conversation store. There is no SettingsProvider and
 * no `Save settings` button, since no transaction spans those stores and such a button would report partial
 * success as success.
 *
 * It waits only for identity, not for SQLite (`settings-state.ts`). Two sections need storage, and
 * that wait belongs to those sections. Gating the whole screen would also break changing brightness
 * on a device whose storage never opens.
 *
 * It is an ordinary scrolling document, unlike the conversation screen. At large accessibility text
 * sizes the last control is reached by scrolling.
 */
export function SettingsShell({
	category,
	children,
}: {
	/**
	 * Which category is active. **The route answers this.**
	 *
	 * The layout derives it from the address (`settingsCategoryForPath`), and this file passes it
	 * straight to the navigation row. That is why there is no shadow state such as `selectedCategory`
	 * here: it would let the sliding indicator move ahead of the route, and then there would be two
	 * answers to which category is open.
	 */
	category: MobileSettingsCategory;
	/** Content of this category. The layout route's `<Slot />` fills it. */
	children: ReactNode;
}) {
	const router = useRouter();
	const identity = useMobileIdentity();
	const state = resolveSettingsScreenState(identity.session.phase);

	return (
		<Screen>
			{/**
			 * The drawer and the back button stand **together**. Settings is reached through the gear from any
			 * screen, so back must return to that screen (which is why the gear uses `push`), and global
			 * navigation must still work here. Neither can stand in for the other.
			 *
			 * The gear for this screen also sits in the utility group on the right and shows its active state.
			 * It is not removed here, since it stays in the same place on every screen (the account screen made
			 * the same call).
			 *
			 * **Because the header belongs to the layout, it does not re-render when the category changes.** This
			 * is the same fact as the app shell's header not being redrawn per route on the web.
			 */}
			<AppBar
				navigation={<AppSidebarTrigger />}
				title={SETTINGS_TITLE}
				onBack={() => router.back()}
				actions={<ShellUtilities />}
			/>

			<KeyboardLayout>
				<ScrollView
					contentContainerStyle={screen.content}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
				>
					{state.kind === "booting" ? (
						/** Neutral wait: the sign-in notice is not drawn even for one frame. */
						<View style={screen.center}>
							<Spinner />
						</View>
					) : state.kind === "guest" ? (
						/** Guests are not bounced to sign-in; they first read why they cannot see this. */
						<View style={screen.center}>
							<EmptyState
								icon="settings"
								title={SETTINGS_GUEST.title}
								description={SETTINGS_GUEST.description}
								actionLabel={SETTINGS_GUEST.action}
								onAction={() => {
									identity.clearFailure();
									router.push({
										pathname: "/login",
										/**
										 * After signing in, return to **this category**.
										 *
										 * The value comes from the navigation model alone (`settingsLoginRedirect`). The current
										 * path is not read and passed through, because that value becomes a deep link. It is not
										 * a single literal, because someone who entered via `/settings/ai` would otherwise land
										 * on a different screen.
										 */
										params: { redirect: settingsLoginRedirect(category) },
									});
								}}
							/>
						</View>
					) : state.kind === "unavailable" ? (
						/** **This is not a sign-out.** Asking again is all that can be done here. */
						<View style={screen.center}>
							<Notice
								message={SETTINGS_UNAVAILABLE}
								actionLabel={SETTINGS_RETRY_LABEL}
								onAction={identity.retry}
							/>
						</View>
					) : (
						<View style={screen.stack}>
							{/**
							 * The navigation row is inside the member branch. Guests do not get three
							 * category rows that would send them back to this notice when pressed.
							 *
							 * This row **outlives the categories**. That is the only condition under which
							 * the active indicator can slide (see the header).
							 */}
							<SettingsNavigation category={category} />
							{/**
							 * The content tree is **keyed to the viewer.** When the account changes, an
							 * unfinished persona form or color draft must not remain on the new viewer's
							 * screen. During a switch the session already folds to `booting` and unmounts
							 * the content, but that guarantee is also written here as structure rather than
							 * left to render order (the same as on the account screen).
							 */}
							<View key={identity.session.viewer?.id ?? "none"}>
								{children}
							</View>
						</View>
					)}
				</ScrollView>
			</KeyboardLayout>
		</Screen>
	);
}

const screen = StyleSheet.create({
	content: { gap: space.lg, padding: screenPadding },
	stack: { gap: space.lg },
	center: { gap: space.md, paddingTop: space.xl },
});
