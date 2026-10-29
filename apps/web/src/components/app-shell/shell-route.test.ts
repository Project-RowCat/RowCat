import { describe, expect, it } from "vitest";
import type { FileRouteTypes } from "#/routeTree.gen";
import { activeRoomId, shellContextKey, shellRouteFor } from "./shell-route.ts";

/**
 * Shell verdicts, checked **without rendering.**
 *
 * What is checked here is the rule, not the markup: which section the sidebar lights, which header
 * utility is current, what the header names, and which screen gives up window scroll. When those go
 * wrong the symptom is quiet: `Conversations` lit on the settings screen, double scrolling in a conversation,
 * or the sidebar highlighting the wrong row. A test asserting class names would catch none of them.
 */

/**
 * Route ids are tied to the real tree **at compile time.**
 *
 * The one weak point of this verdict is that the ids are strings (moving a file changes the id
 * silently). Assigning them to the generated route type makes `pnpm typecheck` reject a stale id.
 * Only the type is imported, so the route modules are not loaded.
 */
const IDS = {
	gallery: "/(app)/",
	story: "/(app)/stories/$storyId",
	creator: "/(app)/creators/$creatorId",
	chatLibrary: "/(app)/chats/",
	chatRoom: "/(app)/chat/$roomId",
	chatRuntime: "/(app)/chat/runtime/$storyId",
	/** The retired address. `beforeLoad` redirects it, so the shell never sees this match. */
	storyPlay: "/(app)/stories/$storyId_/play",
	draftLibrary: "/(app)/create/",
	draftEditor: "/(app)/create/$draftId",
	draftPlaytest: "/(app)/create/$draftId_/test",
	draftRuntime: "/(app)/create/$draftId_/runtime",
	account: "/(app)/account/",
	accountDeletion: "/(app)/account-deletion/",
	notifications: "/(app)/notifications/",
	/** The settings layout. Category routes always match beneath it. */
	settings: "/(app)/settings",
	settingsGeneral: "/(app)/settings/",
	settingsAi: "/(app)/settings/ai",
	settingsPersonas: "/(app)/settings/personas",
	/** Creator runtime public docs: the same slot as the account deletion guide (public documents). */
	runtimeDocsIndex: "/(app)/docs/runtime/",
	runtimeDocsPage: "/(app)/docs/runtime/$",
	layout: "/(app)",
	root: "__root__",
} satisfies Record<string, FileRouteTypes["id"]>;

/** The shape the router provides, from the layout down to the leaf. */
const matches = (routeId: string, params: unknown = {}) => [
	{ routeId: IDS.root, params: {} },
	{ routeId: IDS.layout, params: {} },
	{ routeId, params },
];

/**
 * Every screen in the app uses **the same shell.**
 *
 * This is where the rule "which screens get the left column" disappeared. What is checked now is
 * not whether a route falls outside the shell, but which highlight and which context each screen
 * requires. The width is the same for every route.
 */
/**
 * **The web has no operations-tool route** (§50).
 *
 * That screen moved to `apps/admin`; what remains here is one link on the account screen. This file
 * does not assert the absence, because the table above already expresses it: it is tied to
 * `FileRouteTypes["id"]`, so writing `/(app)/moderation/` again **breaks compilation.** The fact
 * that the route does not exist is guarded by value in
 * `features/moderation/operator-boundaries.test.ts`.
 */

/**
 * Notifications are the **third header utility**, not a fourth sidebar section.
 *
 * This assertion guards the IA. If the sidebar gained a `Notifications` entry, the left column would become
 * "leftover space", and search, theme and sync would follow one by one (§90). The section being
 * null here closes that door.
 */
/**
 * The playtest is **a screen of the `Create` section**, not a conversation.
 *
 * Two things are guarded. First, the section: looking like a conversation must not light `Conversations`,
 * because the user would then look for the test they just started in `/chats`, which does not list
 * it (it is not saved). Second, the geometry: this screen has a scrolling transcript and an input
 * pinned to the bottom, so unlike the editor it is **locked to the viewport height**. Dropping that
 * axis pushes the input out of view.
 */
describe("story test", () => {
	it("lights the create section with the same draft as context", () => {
		expect(
			shellRouteFor(matches(IDS.draftPlaytest, { draftId: "draft-1" })),
		).toEqual({
			section: "create",
			utility: null,
			context: { kind: "draft", draftId: "draft-1" },
			viewportLocked: true,
			publicDocument: false,
		});
	});

	/**
	 * Same **resource** as the editor, so the header's subtree is kept. Moving between them does not
	 * change the resource, so any open state is not reset for no reason.
	 */
	it("has the same context key as the editor", () => {
		const editor = shellRouteFor(matches(IDS.draftEditor, { draftId: "d" }));
		const playtest = shellRouteFor(
			matches(IDS.draftPlaytest, { draftId: "d" }),
		);
		expect(shellContextKey(playtest.context)).toBe(
			shellContextKey(editor.context),
		);
	});

	/** The sidebar's active conversation row stays unlit: this conversation is not in the list. */
	it("does not light the sidebar conversation row", () => {
		const shell = shellRouteFor(matches(IDS.draftPlaytest, { draftId: "d" }));
		expect(activeRoomId(shell.context)).toBeNull();
	});
});

/**
 * The runtime studio is also **a screen of the `Create` section.**
 *
 * It does not get its own section just because it looks like a code editor. The sidebar stays at
 * its three entries, and this screen opens **the same draft** with another tool. Only the geometry
 * differs: it has four internally scrolling panes, so if the window scrolled none of them would
 * reach their end.
 */
describe("runtime studio", () => {
	it("lights the create section with the same draft as context", () => {
		expect(
			shellRouteFor(matches(IDS.draftRuntime, { draftId: "draft-1" })),
		).toEqual({
			section: "create",
			utility: null,
			context: { kind: "draft", draftId: "draft-1" },
			viewportLocked: true,
			publicDocument: false,
		});
	});

	it("has the same context key as the editor and story test", () => {
		const editor = shellRouteFor(matches(IDS.draftEditor, { draftId: "d" }));
		const runtime = shellRouteFor(matches(IDS.draftRuntime, { draftId: "d" }));
		const playtest = shellRouteFor(
			matches(IDS.draftPlaytest, { draftId: "d" }),
		);
		expect(shellContextKey(runtime.context)).toBe(
			shellContextKey(editor.context),
		);
		expect(shellContextKey(runtime.context)).toBe(
			shellContextKey(playtest.context),
		);
	});

	/** The sidebar's active conversation row stays unlit: there is no conversation here. */
	it("does not light the sidebar conversation row", () => {
		const shell = shellRouteFor(matches(IDS.draftRuntime, { draftId: "d" }));
		expect(activeRoomId(shell.context)).toBeNull();
	});
});

/**
 * Runtime playback is **a screen of the conversation section, but not a room.**
 *
 * Two things are guarded. The first is placement: for someone opening a work, runtime playback
 * should sit where a conversation room sits, so the sidebar's `Conversations` lights and the canvas is locked
 * to the viewport. The second is identity: being in that place does not create a `ChatRoom`. The
 * context's kind is `runtime`, so the sidebar's recent-conversation row does not light, and the
 * header draws the work's controls rather than the room's (search, settings).
 */
describe("runtime playback", () => {
	it("lights the conversation section with the story as context", () => {
		expect(
			shellRouteFor(matches(IDS.chatRuntime, { storyId: "story-1" })),
		).toEqual({
			section: "chat",
			utility: null,
			context: { kind: "runtime", storyId: "story-1" },
			viewportLocked: true,
			publicDocument: false,
		});
	});

	/** Not a room: even when a room with the same id exists, the sidebar does not light that row. */
	it("does not light the sidebar conversation row", () => {
		const shell = shellRouteFor(matches(IDS.chatRuntime, { storyId: "r" }));
		expect(activeRoomId(shell.context)).toBeNull();
	});

	/**
	 * Room ids and work ids are separate identity spaces. Even with the same string, the context keys
	 * must differ, so a user moving from a room to a runtime with the same id does not inherit the
	 * previous screen's header state.
	 */
	it("has a different context key from a room with the same id", () => {
		const room = shellRouteFor(matches(IDS.chatRoom, { roomId: "same" }));
		const runtime = shellRouteFor(
			matches(IDS.chatRuntime, { storyId: "same" }),
		);
		expect(shellContextKey(runtime.context)).not.toBe(
			shellContextKey(room.context),
		);
	});

	it("a match without a story id makes no context", () => {
		expect(shellRouteFor(matches(IDS.chatRuntime, {})).context).toBeNull();
	});

	/**
	 * The retired address is not in the shell's table. That route redirects in `beforeLoad`, so it is
	 * never drawn; an unregistered route falls to the plain document shape, which is safe.
	 */
	it("the retired playback address lights nothing", () => {
		expect(shellRouteFor(matches(IDS.storyPlay, { storyId: "s" }))).toEqual({
			section: null,
			utility: null,
			context: null,
			viewportLocked: false,
			publicDocument: false,
		});
	});
});

describe("notifications", () => {
	it("lights only the utility, not a section", () => {
		expect(shellRouteFor(matches(IDS.notifications))).toEqual({
			section: null,
			utility: "notifications",
			context: null,
			viewportLocked: false,
			publicDocument: false,
		});
	});

	/**
	 * The three utilities do not light each other. If the header's highlights overlapped, the user
	 * would lose track of where they are. That mismatch appears in exactly this shape when the verdict
	 * is split across two places (§114).
	 */
	it("notifications, settings and account do not light each other", () => {
		expect(shellRouteFor(matches(IDS.notifications)).utility).toBe(
			"notifications",
		);
		expect(shellRouteFor(matches(IDS.settings)).utility).toBe("settings");
		expect(shellRouteFor(matches(IDS.account)).utility).toBe("account");
	});
});

describe("screens that flow like documents", () => {
	it.each([
		["discover", IDS.gallery, "discover"],
		["story detail", IDS.story, "discover"],
		// A profile is a branch of discovery: neither a fourth section nor part of the account.
		["public profile", IDS.creator, "discover"],
		// The list and the room are the same section. Only the nature of the screen differs.
		["conversation list", IDS.chatLibrary, "chat"],
		["draft list", IDS.draftLibrary, "create"],
	])("%s lights a section and keeps window scroll", (_label, routeId, section) => {
		const shell = shellRouteFor(matches(routeId, { storyId: "s1" }));
		expect(shell.section).toBe(section);
		expect(shell.utility).toBeNull();
		// The canvas has its own h1 on these screens, so the header does not name anything.
		expect(shell.context).toBeNull();
		expect(shell.viewportLocked).toBe(false);
	});
});

/**
 * Settings and account are **not a fourth section.**
 *
 * Forcing the nearest section on makes the user read themselves as inside discovery or chat.
 * Leaving nothing lit makes the gear on `/settings` keep saying "go here". So no section lights and
 * only the utility does.
 */
describe("utility screens light no section", () => {
	it("settings", () => {
		const shell = shellRouteFor(matches(IDS.settings));
		expect(shell.section).toBeNull();
		expect(shell.utility).toBe("settings");
	});

	/**
	 * The verdict stays one as categories are added.
	 *
	 * Settings now has its own navigation list and nested routes. If the verdict were registered per
	 * leaf, a new category would silently turn off the header's gear, and the user on that screen
	 * would keep seeing the gear say "go here". The check is by value that matching happens at the
	 * layout id.
	 *
	 * The personas category arrived this way. The list once lived in the `Conversations` section and had its own
	 * line in this file (`personaLibrary`); moving it to settings removed that line. That is the place
	 * where the rule "categories are not registered here" is confirmed by value.
	 */
	it.each([
		["general", IDS.settingsGeneral],
		["AI", IDS.settingsAi],
		["personas", IDS.settingsPersonas],
	])("the %s settings category gets the same decision", (_label, leaf) => {
		const shell = shellRouteFor([
			{ routeId: IDS.root, params: {} },
			{ routeId: IDS.layout, params: {} },
			{ routeId: IDS.settings, params: {} },
			{ routeId: leaf, params: {} },
		]);
		expect(shell.section).toBeNull();
		expect(shell.utility).toBe("settings");
		expect(shell.viewportLocked).toBe(false);
		expect(shell.publicDocument).toBe(false);
	});

	it("account", () => {
		const shell = shellRouteFor(matches(IDS.account));
		expect(shell.section).toBeNull();
		expect(shell.utility).toBe("account");
	});

	/**
	 * The account deletion guide is **not the account screen.** It is a public document read by people
	 * who are not signed in, so lighting the account utility would point them at a place they cannot
	 * enter. The shell itself is used as usual: someone who has read the guide must be able to log in
	 * immediately, and that path is in the shell.
	 */
	/**
	 * Creator runtime public docs share the account deletion guide's slot. They open in a new tab from the
	 * studio and are also reached by search, so if the entry gate stood in front, someone not signed
	 * in could not read them.
	 */
	it.each([
		[IDS.runtimeDocsIndex, {}],
		[IDS.runtimeDocsPage, { _splat: "concepts/state" }],
	])("%s — runtime docs light nothing and are public documents", (routeId, params) => {
		expect(shellRouteFor(matches(routeId, params))).toEqual({
			section: null,
			utility: null,
			context: null,
			viewportLocked: false,
			publicDocument: true,
		});
	});

	it("the account deletion guide lights nothing and is a public document", () => {
		expect(shellRouteFor(matches(IDS.accountDeletion))).toEqual({
			section: null,
			utility: null,
			context: null,
			viewportLocked: false,
			/**
			 * This means **the membership entry gate does not stand in front of this screen.** Someone
			 * held at the gate still needs to read how to clean up their account, and the account screen
			 * sits behind the gate, so this guide is that way.
			 */
			publicDocument: true,
		});
	});
});

describe("workspace screens", () => {
	it("a conversation gives room context and is locked to the viewport", () => {
		const shell = shellRouteFor(matches(IDS.chatRoom, { roomId: "room-1" }));
		expect(shell.section).toBe("chat");
		expect(shell.context).toEqual({ kind: "chat", roomId: "room-1" });
		expect(shell.viewportLocked).toBe(true);
	});

	it("the editor gives draft context but keeps document scroll", () => {
		const shell = shellRouteFor(matches(IDS.draftEditor, { draftId: "d1" }));
		expect(shell.section).toBe("create");
		expect(shell.context).toEqual({ kind: "draft", draftId: "d1" });
		expect(shell.viewportLocked).toBe(false);
	});

	/**
	 * The list and the room light the same entry. If `Conversations` turned off on entering a room, the user
	 * would read it as having left the section.
	 */
	it("the list and the workspace light the same section", () => {
		expect(shellRouteFor(matches(IDS.chatLibrary)).section).toBe("chat");
		expect(shellRouteFor(matches(IDS.chatRoom, { roomId: "r" })).section).toBe(
			"chat",
		);
		expect(shellRouteFor(matches(IDS.draftLibrary)).section).toBe("create");
		expect(
			shellRouteFor(matches(IDS.draftEditor, { draftId: "d" })).section,
		).toBe("create");
	});

	/** The active resource comes from **the route parameter**: the shell keeps no selection state of its own. */
	it("switching rooms changes the context identity", () => {
		const a = shellRouteFor(matches(IDS.chatRoom, { roomId: "a" })).context;
		const b = shellRouteFor(matches(IDS.chatRoom, { roomId: "b" })).context;
		expect(shellContextKey(a)).not.toBe(shellContextKey(b));
	});
});

/**
 * The sidebar's lit conversation comes from the same verdict.
 *
 * It matters that the conversation row stays unlit while editing a draft. Both contexts live in one
 * field, so reading the id without checking the kind would send a draft id down to the sidebar as
 * if it were a room id.
 */
describe("the sidebar's active conversation", () => {
	it("comes only from a room", () => {
		expect(
			activeRoomId(
				shellRouteFor(matches(IDS.chatRoom, { roomId: "r1" })).context,
			),
		).toBe("r1");
	});

	it("absent in the draft editor", () => {
		expect(
			activeRoomId(
				shellRouteFor(matches(IDS.draftEditor, { draftId: "d1" })).context,
			),
		).toBeNull();
	});

	it("absent on canvas screens", () => {
		expect(
			activeRoomId(shellRouteFor(matches(IDS.gallery)).context),
		).toBeNull();
	});
});

describe("unknown lights nothing", () => {
	it("only the layout matched", () => {
		const shell = shellRouteFor([
			{ routeId: IDS.root, params: {} },
			{ routeId: IDS.layout, params: {} },
		]);
		expect(shell).toEqual({
			section: null,
			utility: null,
			context: null,
			viewportLocked: false,
			publicDocument: false,
		});
	});

	/**
	 * A match without params is not treated as a workspace. Otherwise the sidebar would hold an empty
	 * string as its active id and light no row, which looks like a broken sidebar.
	 */
	it("a conversation match without a room id", () => {
		expect(shellRouteFor(matches(IDS.chatRoom, {})).context).toBeNull();
	});
});
