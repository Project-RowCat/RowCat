/**
 * Maps a route to the app shell's shape. **This file is the only place that decides it.**
 *
 * The shell has four surfaces: the sidebar's global links, the sidebar's active conversation row,
 * the header's context label, and the header's utilities. If each of them matched
 * `pathname.startsWith("/create")` on its own, every new route would mean editing four places, and
 * a miss would show up only as an occasionally unlit highlight.
 *
 * Matching is by **route id**, not path. Paths overlap (`/create` and `/create/$draftId`), which
 * makes the check order-dependent; route ids are already unique in the router. Moving a file
 * changes its id. The constants below collect the ids in one place, and the test checks them
 * against the real route tree.
 *
 * Keep this a pure function. The rules (which section lights up, which screen is locked to the
 * viewport, what the header names) must be checkable without rendering. Otherwise verifying them
 * means running the app, and then nobody verifies them.
 *
 * Workspace identity no longer decides whether the sidebar exists. It used to, so only screens with
 * a workspace got the left column, and canvas width differed by 224px from screen to screen. The
 * sidebar is now present on every app screen, so this file only decides which resource the user is
 * inside (`context`). The header's label and the sidebar's active row each read that on their own.
 */

/** The product section the sidebar's global links point at. Three values; a new one only for a new destination. */
export type AppSection = "discover" | "chat" | "create";

/**
 * Header utility on the right: whether the user is **currently at that destination**.
 *
 * This is a different axis from the section (`AppSection`). Notifications, settings and account are
 * destinations needed from any section, not a fourth product section. Lighting a global link for
 * them would make the user read themselves as having left their section; lighting nothing would
 * leave the gear on `/settings` saying "go here". `notifications` as the third value is this
 * change.
 *
 * The condition for adding a value: a global destination that calls the user from any screen.
 * Search, filters, share, favorites, model settings and sync status fail that test, so they are not
 * here; the union keeps the header from becoming a tool drawer.
 *
 * The header does not recompute the bell's active state with
 * `pathname.startsWith("/notifications")`. Route-to-shell decisions live in this file alone; if
 * each surface wrote its own, a route added later would be missed in one of them (§114).
 */
export type ShellUtility = "notifications" | "settings" | "account";

/**
 * The **local resource currently open**: the thing the header names.
 *
 * The union fixes what can come in here. Adding a kind means extending it, and at that point you
 * must first ask whether the header should name that screen's identity. Screens whose canvas
 * already has its own h1 would otherwise flow into this slot; the union is what stops that.
 */
export type ShellContext =
	| { kind: "chat"; roomId: string }
	| { kind: "draft"; draftId: string }
	/**
	 * Runtime playthrough: **not a room.** The header's name is the work, and that name is the
	 * server's value (conversation and draft values belong to this device). It is not folded into
	 * `chat` with the work id as `roomId`: the sidebar would then light the recent-conversation row
	 * with that id, and the header would draw the room settings trigger for a room that does not
	 * exist.
	 */
	| { kind: "runtime"; storyId: string };

export interface ShellRoute {
	/** Section lit in the sidebar. Null on settings, account and public documents; we do not light the nearest one as a fallback. */
	section: AppSection | null;
	/** Header utility the user is at right now. Null elsewhere. */
	utility: ShellUtility | null;
	/** Resource the header names. Null on screens whose canvas has its own title. */
	context: ShellContext | null;
	/**
	 * Whether this screen is a **workspace locked to the viewport height**, not a document.
	 *
	 * This is a separate axis from `context`. The draft editor shows a name in the header but flows
	 * top to bottom like a document, so it uses window scroll. The conversation has three internal
	 * scroll areas, so the window must not scroll. Folding the two into one axis would either trap the
	 * editor in internal scrolling (worse mobile address-bar behavior, and scroll restoration drifts)
	 * or add double scrolling to the conversation.
	 */
	viewportLocked: boolean;
	/**
	 * Whether this is a **public document** read without signing in. The membership entry gate (age,
	 * guardian consent) does not stand in front of these screens.
	 *
	 * This axis exists for the reason in §114. If the gate matched paths itself, a route added later
	 * would be missed, and the symptom would be **a public page (the account deletion guide, the
	 * runtime docs) answered by the gate** for whoever has not finished it.
	 *
	 * It is not inferred from `section` and `utility` both being null. That combination is also where
	 * every unregistered route falls, and those are usually screens that need a login.
	 */
	publicDocument: boolean;
}

/** Route ids as the router assigns them. Moving a route file changes its id here too. */
const ROUTE = {
	gallery: "/(app)/",
	story: "/(app)/stories/$storyId",
	creator: "/(app)/creators/$creatorId",
	chatLibrary: "/(app)/chats/",
	chatRoom: "/(app)/chat/$roomId",
	/**
	 * Creator runtime playback: **the third screen of the conversation section.**
	 *
	 * The old address (`/stories/$storyId_/play`) redirects here in `beforeLoad`, so the shell never
	 * draws that route, and it is absent from this table. An unregistered route falls through to a
	 * plain document screen with no highlight, which is a safe failure.
	 */
	chatRuntime: "/(app)/chat/runtime/$storyId",
	draftLibrary: "/(app)/create/",
	draftEditor: "/(app)/create/$draftId",
	/** The trailing underscore comes from the file name: this route is not a child of the editor (see the route file header). */
	draftPlaytest: "/(app)/create/$draftId_/test",
	/** Same shape for the same reason: the trailing underscore detaches it from the editor's children. */
	draftRuntime: "/(app)/create/$draftId_/runtime",
	account: "/(app)/account/",
	accountDeletion: "/(app)/account-deletion/",
	notifications: "/(app)/notifications/",
	/**
	 * The settings **layout** route, not a category route.
	 *
	 * `/settings`, `/settings/ai` and `/settings/personas` all get the same verdict: every match
	 * includes this layout, so the verdict holds when a category is added and this file stays
	 * unchanged (the personas category arrived this way). Registering per leaf would silently turn off
	 * the header's gear for any new category.
	 */
	settings: "/(app)/settings",
	runtimeDocsIndex: "/(app)/docs/runtime/",
	runtimeDocsPage: "/(app)/docs/runtime/$",
} as const;

/**
 * The route match shape this decision needs.
 *
 * Not tied to the router's match type, so the tests can call this directly and per-route param
 * shapes stay out of this file. The cost is that `params` arrives as `unknown` and is narrowed
 * below.
 */
export interface ShellMatch {
	routeId: string;
	params: unknown;
}

/** No highlight and no context: a plain document screen. Unknown routes also land here. */
const PLAIN: ShellRoute = {
	section: null,
	utility: null,
	context: null,
	viewportLocked: false,
	publicDocument: false,
};

/**
 * Public documents read without signing in: the account deletion guide and the runtime docs.
 *
 * These share one more trait: **their addresses never change.** Store listings and review responses
 * cite them, and one dead link is enough to get a review rejected.
 */
const PUBLIC_DOC: ShellRoute = { ...PLAIN, publicDocument: true };

/** A string param from a match. If absent, this match is not treated as a workspace. */
function param(match: ShellMatch, key: string): string | null {
	const params = match.params;
	if (typeof params !== "object" || params === null) return null;
	const value = (params as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The shape the shell must take for the route being drawn.
 *
 * The input may be in any order. The function only looks for the ids it knows, and a single tree
 * never matches two of them at once (they are sibling routes).
 *
 * Anything unrecognized gets the plain document shape. A new route that is not registered here
 * falls into that case, which is safe: the sidebar stays put and only the highlight is missing. No
 * data leaks and navigation is not blocked.
 */
export function shellRouteFor(matches: readonly ShellMatch[]): ShellRoute {
	for (const match of matches) {
		switch (match.routeId) {
			case ROUTE.gallery:
			case ROUTE.story:
			/**
			 * A public profile is also **discovery**. It is not a fourth section because it is not a
			 * destination, only one branch of discovery: it sits on the path from a work to a person and
			 * back, and the sidebar has no direct link to it. If nothing lit up, opening a profile would
			 * read as having left discovery.
			 *
			 * Even on the user's own profile we do not light the `Account` utility. That one is the private
			 * self-management screen, while this is a public screen anyone can see; lighting the same spot
			 * would make the two read as the same thing.
			 */
			case ROUTE.creator:
				return { ...PLAIN, section: "discover" };
			/**
			 * The list and the room are **two screens of the same section.** If `Conversations` turned off on entering
			 * a room, the user would read it as having left the section. What differs is the nature of the
			 * screen, not the section: the list flows like a document and the room is locked to the
			 * viewport.
			 */
			case ROUTE.chatLibrary:
				return { ...PLAIN, section: "chat" };
			case ROUTE.draftLibrary:
				return { ...PLAIN, section: "create" };
			/**
			 * Settings, account and notifications **do not light a section.** The sidebar's three entries
			 * say where you are going; these are destinations needed from any of them. Forcing the nearest
			 * section on would make the user read themselves as inside discovery or chat. Being here is said
			 * by the header's utilities.
			 */
			case ROUTE.notifications:
				return { ...PLAIN, utility: "notifications" };
			case ROUTE.settings:
				return { ...PLAIN, utility: "settings" };
			case ROUTE.account:
				return { ...PLAIN, utility: "account" };
			/**
			 * The account deletion guide is **not the account screen.** The fallthrough would give the same
			 * result (unregistered routes end up here), but it is listed to record that the verdict is
			 * deliberate. This is a public document read by people who are not signed in; lighting the
			 * account utility would point them at a place they cannot enter.
			 */
			case ROUTE.accountDeletion:
				return PUBLIC_DOC;
			/**
			 * Creator runtime public docs share the account deletion guide's slot: no sidebar section
			 * lights, and the entry gate does not stand in front. They are readable without a runtime-enabled draft and
			 * without signing in, and the studio's open-in-new-tab path relies on that.
			 */
			case ROUTE.runtimeDocsIndex:
			case ROUTE.runtimeDocsPage:
				return PUBLIC_DOC;
			case ROUTE.chatRoom: {
				const roomId = param(match, "roomId");
				if (!roomId) break;
				return {
					section: "chat",
					utility: null,
					context: { kind: "chat", roomId },
					viewportLocked: true,
					publicDocument: false,
				};
			}
			case ROUTE.draftEditor: {
				const draftId = param(match, "draftId");
				if (!draftId) break;
				return {
					section: "create",
					utility: null,
					context: { kind: "draft", draftId },
					viewportLocked: false,
					publicDocument: false,
				};
			}
			/**
			 * The playtest stays **in the `Create` section.** It looks like a conversation, but `Conversations` would be
			 * the wrong section: the sidebar's `Conversations` leads to the user's conversation list (`/chats`), and
			 * this playtest is not saved there. Lighting it would send the user looking for a test they just
			 * started in that list. It is an authoring tool, not a conversation destination: same section
			 * and same resource as the editor.
			 *
			 * Its context is the **same draft**, so the header names the same title and the same subtree is
			 * kept (`shellContextKey`). Moving between editor and playtest does not change the resource.
			 *
			 * One axis differs: this screen is **locked to the viewport height** (the editor flows like a
			 * document). It has a scrolling transcript and an input pinned to the bottom, so if the window
			 * scrolled, the input would be pushed out of view.
			 */
			/**
			 * The runtime studio also stays in the `Create` section, for the same reasons as the playtest: it
			 * opens the same resource (one draft) with another tool, so the header names the same title and
			 * keeps the same subtree (`shellContextKey`). Only the geometry differs: it is locked to the
			 * viewport height. It has four internally scrolling panes, so if the window scrolled, none of
			 * them would reach their end.
			 */
			/**
			 * Runtime playback is a **screen of the conversation section, not a room.** It used to sit in
			 * discovery (`/stories/:id/play`), on the grounds that runtime playback has no list. That still
			 * holds, but the verdict changed for product reasons: for someone opening a work, runtime
			 * playback should sit in the same place as a conversation room (same sidebar highlight, same
			 * header slot, same viewport-locked canvas). Lighting the conversation section says that place.
			 *
			 * Nothing in `/chats` lists this playthrough; the kind of `context` says so (`runtime`, which
			 * `activeRoomId` does not light). The one axis still differing is **locked to the viewport
			 * height**. Creator content draws in its own pane, so a document flow would push that pane out
			 * of view.
			 */
			case ROUTE.chatRuntime: {
				const storyId = param(match, "storyId");
				if (!storyId) break;
				return {
					section: "chat",
					utility: null,
					context: { kind: "runtime", storyId },
					viewportLocked: true,
					publicDocument: false,
				};
			}
			case ROUTE.draftRuntime:
			case ROUTE.draftPlaytest: {
				const draftId = param(match, "draftId");
				if (!draftId) break;
				return {
					section: "create",
					utility: null,
					context: { kind: "draft", draftId },
					viewportLocked: true,
					publicDocument: false,
				};
			}
		}
	}
	return PLAIN;
}

/**
 * Identity line for the open resource.
 *
 * This is the key of the header context. When the resource changes, its subtree must start fresh
 * (an open room settings dialog must not survive as if it belonged to the next room). Writing that
 * rule as an effect would leave the previous resource's dialog on screen for the frame in which the
 * route changed.
 */
export function shellContextKey(context: ShellContext | null): string {
	if (!context) return "none";
	switch (context.kind) {
		case "chat":
			return `chat:${context.roomId}`;
		case "draft":
			return `draft:${context.draftId}`;
		/**
		 * Prefixes differ per kind on purpose. Room ids and work ids are separate identity spaces, so the
		 * same string can appear in both. Without the prefix, a user moving from a room to a runtime with
		 * the same id would inherit the previous screen's header state.
		 */
		case "runtime":
			return `runtime:${context.storyId}`;
	}
}

/** The conversation row the sidebar lights. Present only on a conversation workspace. */
export function activeRoomId(context: ShellContext | null): string | null {
	return context?.kind === "chat" ? context.roomId : null;
}

/**
 * The work whose **runtime row** the sidebar lights. Present only on the runtime playback screen.
 *
 * This is a different axis from `activeRoomId`. Room ids and work ids are separate identity spaces,
 * so folding them into one value would one day light the row of a room with the same string. Moving
 * to the axis the sidebar row lights by (the library entry id) is the unified library's job
 * (`activeConversationEntryId` in `@rowcat/domain`).
 */
export function activeRuntimeStoryId(
	context: ShellContext | null,
): string | null {
	return context?.kind === "runtime" ? context.storyId : null;
}
