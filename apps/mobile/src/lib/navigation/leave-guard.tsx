import { usePreventRemove } from "expo-router/react-navigation";
import type { ReactNode } from "react";

/**
 * Capability to intercept leaving a screen. Lives in the app's navigation layer.
 *
 * Kept out of feature folders because it depends on router internals (the remove action). A copy in
 * the draft editor would be reused by other screens that need the same guard, and copies tend to
 * miss the "re-acquire after leaving" step, which only shows up as data loss. It is not in
 * `@rowcat/ui-native`: that package must not know about navigation.
 *
 * Blocked: the header back button (the screen calls it directly, see `blocked` below), Android
 * hardware back, iOS edge swipe (the gesture is disabled while blocked), and switching sections via
 * the bottom bar or drawer. Not blocked: the OS suspending or killing the app, which the app cannot
 * observe. Those two paths are best-effort flushing on unmount and background, not a guarantee (see
 * `features/create/use-draft-autosave.ts`).
 *
 * `BackHandler` is deliberately not used. It sees only Android back, not the iOS swipe or
 * router-driven navigation, so the same guard would behave differently per platform. Instead
 * `usePreventRemove` treats all three as one event: while it is true, the native stack disables the
 * gesture and hands system back to us.
 *
 * This component only reads `blocked`; it has no escape hatch like "leave without saving", since
 * such an escape would eventually become the default in a confirm dialog. The guarantee comes from
 * the call site clearing `blocked` by saving or discarding the pending changes.
 *
 * It returns null and holds its own subscription. `blocked` changes often (autosave moves state
 * every 500ms), so reading it in the screen would re-render the whole editor. The same pattern is
 * used by `AutosaveIndicator` in `features/create/draft-editor-screen.tsx`. Being a component
 * rather than a hook is what isolates the re-render.
 */
export function LeaveGuard({
	blocked,
	onBlocked,
}: {
	/** Whether leaving now would lose something. Must reflect the current render. */
	blocked: boolean;
	/**
	 * Called when a removal was blocked, so the screen can tell the user. The router's action is
	 * deliberately not passed along: holding it would create a second exit besides the screen's own
	 * navigation. Leaving happens later through the normal path, once `blocked` is false.
	 */
	onBlocked: () => void;
}): ReactNode {
	usePreventRemove(blocked, onBlocked);
	return null;
}
