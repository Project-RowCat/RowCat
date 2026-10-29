/**
 * Route → app shell shape. **This file is the only judgment point.**
 *
 * The shell draws two surfaces: the drawer's global navigation and the drawer's active chat row. If
 * each wrote `pathname.startsWith("/chat")` itself, adding a route would miss one place, and the
 * symptom ("the highlight sometimes does not light") is easy to overlook. Web's `shell-route.ts`
 * sits in the same place for the same reason.
 *
 * ## Pure functions are the point
 *
 * This app's tests do not render React (`vitest.config.ts`). If the judgment lived in components,
 * the only way to check it would be trying it by hand, and these rules fail silently: `Discover` lit
 * inside a chat, or no row lit so the list cannot say where the user is.
 *
 * ## The only difference from web is how the route identity is read
 *
 * Web judges by the route id the router resolved, because path prefixes overlap. expo-router does
 * not expose that axis outside rendering, so here the judgment reads **path segments**. It does not
 * use prefix matching, and it matches the segment count as well (`/chats` and `/chat/<id>` are not
 * prefixes of each other, but `startsWith` would read them that way someday).
 *
 * ## Axes that are not here
 *
 * Web's `viewportLocked` and `publicDocument` are absent; in this app the screen decides for itself
 * (`Screen` ↔ `ScrollScreen`). `utility` now exists: the notifications screen came with it, and the
 * account and settings screens came with the other two. There are three and each opens a real
 * screen. The rule stands: a value carries only destinations that really exist, and a fourth is not
 * added in advance, because a value added in advance hardens with no code to set it.
 */

/**
 * The product section the drawer's global navigation points at.
 *
 * **Three, the same as web** (`Discover`, `Conversations`, `Create`). There were two for a while, and the reason was
 * honest: this app had no create screen, and a destination with nowhere to go is decoration, not
 * navigation. That premise is gone: `/create` exists and opens without a network.
 *
 * No fourth value in advance. **Not even when settings arrives**: that screen is a utility callable
 * from any screen, so it lives in `MobileShellUtility` below (web's sidebar also stays at three and
 * puts the gear in the header).
 */
export type MobileAppSection = "discover" | "chat" | "create";

/**
 * A global utility destination, not a section of the drawer.
 *
 * Notifications is why this vocabulary exists. The drawer holds only product sections (discover and
 * chat, as on web's sidebar), while notifications is a bell in the header. Folding it into a
 * section would light `Discover` or `Conversations` on `/notifications`, or add a fourth drawer item. Web does
 * neither.
 *
 * `account` is the second value, for the same reason as web's `ShellUtility`: account is not a
 * destination for creating or consuming; it is the identity entry callable from any screen. Its
 * door is the header's account menu (`features/account/account-shortcut.tsx`).
 *
 * `settings` is the third. It was absent for a while because the screen did not exist, and a value
 * with no screen would harden with nothing setting it. That premise changed: `/settings` exists and
 * its three categories (general, AI, personas) live under it.
 *
 * **All three being utilities is the point of this vocabulary.** Putting settings in
 * `MobileAppSection` gives the drawer a fourth item, and the left side becomes leftover space
 * instead of the product section list (the header of `app-sidebar.tsx` records that end). Web also
 * keeps the sidebar at three and puts settings in the header utility.
 */
export type MobileShellUtility = "notifications" | "settings" | "account";

export interface MobileShellRoute {
	/**
	 * The section the drawer lights. `null` on login and diagnostics: lighting the nearest one would
	 * make the user read that they are inside discover or chat.
	 */
	section: MobileAppSection | null;
	/**
	 * The chat row the drawer lights — **only on the chat screen.**
	 *
	 * The source of truth is the route parameter. A shadow state such as `selectedRoomId` is not kept,
	 * because deep links, back navigation, stack restore and process restart then follow for free; a
	 * second identity has no way to decide which one to trust when they diverge. The last-opened room
	 * is not read from storage either.
	 */
	activeRoomId: string | null;
	/**
	 * The drawer's **runtime row** (the story's id) — **only on the runtime playthrough screen.**
	 *
	 * A different axis from `activeRoomId`. Room ids and story ids are different identity spaces, so
	 * folding them into one value would light a room that happens to have the same string. Mapping to
	 * a library row's id is the library's job (`activeConversationEntryId` in `@rowcat/domain`, which
	 * web calls too).
	 */
	activeRuntimeStoryId: string | null;
	/**
	 * The global utility to light now — the bell's active state reads this value.
	 *
	 * The bell does not write `pathname.startsWith("/notifications")` itself. If the route → shell
	 * judgment lived in two places, adding a route would fix one of them, and the symptom ("sometimes
	 * the highlight does not light") is hard to notice. This is the same reasoning as web's `utility`
	 * axis.
	 */
	utility: MobileShellUtility | null;
}

const NONE: MobileShellRoute = {
	section: null,
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: null,
};
const DISCOVER: MobileShellRoute = {
	section: "discover",
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: null,
};
const CHAT_LIBRARY: MobileShellRoute = {
	section: "chat",
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: null,
};
/**
 * Create — **the create home and the editor are one section.**
 *
 * Web made the same call: `/create` and `/create/:draftId` are two screens of one section,
 * differing only in character (the home is a list, the editor is a form). If `Create` turned off in
 * the editor, the user would read that they had left the section; this is the same axis as the chat
 * list and a room.
 *
 * **The active draft is not held in this value.** Chat has `activeRoomId` because the drawer must
 * light the recent-chat row, and the drawer has no recent-draft list (an intended asymmetry; web
 * did not build that list either). With no row to light, no identity is needed.
 */
const CREATE: MobileShellRoute = {
	section: "create",
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: null,
};
/**
 * Notifications **does not light a section.** Being somewhere that is neither discover nor chat is
 * accurate, and forcing the nearest section on would make the user read that they are inside it.
 * Same rule as web lighting nothing in its sidebar on `/notifications`.
 */
const NOTIFICATIONS: MobileShellRoute = {
	section: null,
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: "notifications",
};
/**
 * Settings also **does not light a section.** All three categories share the same value: the drawer
 * has nothing to light for them anyway, and the header gear only needs to say settings is somewhere
 * (which category is said by the navigation row inside the screen).
 */
const SETTINGS: MobileShellRoute = {
	section: null,
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: "settings",
};
/**
 * Account also **does not light a section.** Same rule as web lighting nothing in its sidebar on
 * `/account`; the only thing lit is the header's account menu (`utility`).
 */
const ACCOUNT: MobileShellRoute = {
	section: null,
	activeRoomId: null,
	activeRuntimeStoryId: null,
	utility: "account",
};

/**
 * The shape the shell must take for the path being drawn.
 *
 * Unknown paths are **screens with no highlight.** A new route that is not registered here falls
 * into that branch. The failure is safe: the drawer still opens, and only the lit item is missing;
 * nothing is blocked and no data leaks.
 */
export function mobileShellRouteFor(pathname: string): MobileShellRoute {
	const segments = splitPath(pathname);

	if (segments.length === 0) return DISCOVER;

	/**
	 * **Story detail is discover too.** Web made the same call for the same reason: the screen is a
	 * branch of discover, not a destination, and the only way in is a gallery card. Leaving nothing
	 * lit would make the user read that they had left discover on opening a story.
	 */
	if (segments.length === 2 && segments[0] === "stories") return DISCOVER;

	/**
	 * **Public profile is discover too.** Same call and reason as web: the screen is a branch of
	 * discover (on the path from a story to a person and back), and it is not reachable directly from
	 * the drawer. Leaving nothing lit would make the user read that they had left discover on opening
	 * a profile.
	 *
	 * **Also discover when reached from a comment.** The comment sat on the story detail, so the
	 * section the user was in did not change. If the highlight depended on where the user came from,
	 * that would be judging by history rather than by route, and this file has no such axis.
	 */
	if (segments.length === 2 && segments[0] === "creators") return DISCOVER;

	/**
	 * **List and room are two screens of the same section.** Entering a room must not turn off the
	 * drawer's `Conversations`, or the user reads that they left the section. Only the active row differs.
	 */
	if (segments.length === 1 && segments[0] === "chats") return CHAT_LIBRARY;

	/**
	 * The create home and the editor — **the same section, different segment counts.**
	 *
	 * No prefix comparison. `startsWith("/create")` would send a future `/creators/<id>` into this
	 * branch, and the public profile would light the create section. Those two already sit side by
	 * side in this file.
	 */
	if (segments.length === 1 && segments[0] === "create") return CREATE;
	if (segments.length === 2 && segments[0] === "create") return CREATE;
	/**
	 * **Story test is also create.** Chatting inside it is not grounds for changing section: the
	 * creator is trying a draft, and that conversation is not in `/chats` or the recent drawer list
	 * (it is not saved). Lighting `Conversations` would make the user look for it in the drawer.
	 *
	 * The segment count and the name are both checked. Without the name check (`segments[2] ===
	 * "test"`), a future `/create/<id>/analytics` would silently fall into this branch.
	 */
	if (
		segments.length === 3 &&
		segments[0] === "create" &&
		segments[2] === "test"
	)
		return CREATE;

	/** All received notifications — a utility destination (see `MobileShellUtility` above). */
	if (segments.length === 1 && segments[0] === "notifications")
		return NOTIFICATIONS;

	/**
	 * Settings — the three categories are **listed one by one.**
	 *
	 * Not grouped under `segments[0] === "settings"`, per this file's rule: that would send a
	 * hand-edited `/settings/foo` or a future `/settings/ai/provider` into this branch, where the gear
	 * lights up for a page the router cannot draw. Only the routes that actually exist are listed
	 * here.
	 *
	 * `/settings` is `general`, as on web: a separate `/settings/general` would give one screen two
	 * addresses, and no one could say which one is canonical.
	 */
	if (segments.length === 1 && segments[0] === "settings") return SETTINGS;
	if (
		segments.length === 2 &&
		segments[0] === "settings" &&
		(segments[1] === "ai" || segments[1] === "personas")
	)
		return SETTINGS;

	/** Account — a second destination on the same axis. It has no sub-paths; unknown ones fall through. */
	if (segments.length === 1 && segments[0] === "account") return ACCOUNT;

	/**
	 * **Runtime playback is a screen of the chat section, not a room.**
	 *
	 * For the person opening a story, the playthrough is in the same place a room would be, so the
	 * drawer's `Conversations` lights up. Being there does not create a `ChatRoom`. What lights is the story's
	 * **runtime library row**, not an active chat row (passing the story id as a room id would make
	 * the drawer light a room it does not have). The two are different axes. The segment-count rule
	 * applies: the room address below has two segments, so this three-segment address cannot fall into
	 * that branch; and a bare `runtime` room id (`/chat/runtime`) is a room address, not a runtime
	 * address without a story id.
	 */
	if (
		segments.length === 3 &&
		segments[0] === "chat" &&
		segments[1] === "runtime"
	) {
		const storyId = segments[2];
		return storyId
			? {
					section: "chat",
					activeRoomId: null,
					activeRuntimeStoryId: storyId,
					utility: null,
				}
			: CHAT_LIBRARY;
	}

	if (segments.length === 2 && segments[0] === "chat") {
		const roomId = segments[1];
		/**
		 * An address with no id never reaches this route, but if it does, it is not a chat: looking up a
		 * row with an empty string would find nothing, and the drawer has no reason to invent that fact.
		 */
		return roomId
			? {
					section: "chat",
					activeRoomId: roomId,
					activeRuntimeStoryId: null,
					utility: null,
				}
			: CHAT_LIBRARY;
	}

	/**
	 * Login and dev diagnostics **light no section.**
	 *
	 * An unregistered path would land here anyway. They are listed explicitly because they sit outside
	 * the shell: the drawer is not drawn on those screens at all, and that fact is expressed by those
	 * screens not mounting `AppSidebar`, not by this table.
	 */
	return NONE;
}

/**
 * Splits a path into segments — and **decodes** them.
 *
 * Room ids are percent-encoded when put in an address (`/chat/${encodeURIComponent(roomId)}`).
 * Current ids are hex without hyphens, so encoding changes nothing today. Relying on that would
 * silently fail to light the drawer's active row the day the id rule changes, with no error.
 *
 * A malformed percent sequence (`%`) makes `decodeURIComponent` throw, so the raw segment is kept.
 * This is where one hand-edited deep link must not kill the whole shell.
 */
function splitPath(pathname: string): string[] {
	return pathname
		.split("/")
		.filter((segment) => segment.length > 0)
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		});
}

/**
 * The primary destination that stands on the bottom row at all times. It answers only on the three
 * root paths.
 *
 * ## Why not use `mobileShellRouteFor`'s `section` directly
 *
 * That value answers "which section am I in", so it also lights on story detail, the public
 * profile, the editor and the story test. That is correct for the drawer, which should show that
 * the user has not left the section. The bottom row answers a different question: **is this the
 * home of that section?**
 *
 * Folding the two into one value would put the bottom row on a chat room, the editor and story
 * detail, and those screens already use the bottom edge (input bar, keyboard, comment composer). So
 * this function answers **only the three paths with exact segment counts.**
 *
 * ```text
 * /         discover   ← not /stories/<id> or /creators/<id>
 * /chats    chat       ← not /chat/<id>
 * /create   create     ← not /create/<id> or /create/<id>/test
 * ```
 *
 * The screen does not decide for itself whether to draw this row; it calls this function. The
 * reason is the same as the rest of the shell judgment: if a route is added and one place is
 * missed, the symptom is silent.
 */
export function mobilePrimaryDestination(
	pathname: string,
): MobileAppSection | null {
	const segments = splitPath(pathname);
	if (segments.length === 0) return "discover";
	if (segments.length !== 1) return null;
	if (segments[0] === "chats") return "chat";
	if (segments[0] === "create") return "create";
	return null;
}
