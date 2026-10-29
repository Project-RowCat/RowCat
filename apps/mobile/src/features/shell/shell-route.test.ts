import { describe, expect, it } from "vitest";
import {
	mobilePrimaryDestination,
	mobileShellRouteFor,
} from "./shell-route.ts";

/**
 * Route → shell judgment. Mistakes here are silent: the drawer lights `Discover` while the user is in a
 * chat, no row is lit so the list cannot say where the user is, or an old room's row disappears
 * from the drawer (the rule that pulls the active room in from outside the window depends on this
 * value).
 */

describe("sections", () => {
	it("the first screen is discover", () => {
		expect(mobileShellRouteFor("/")).toEqual({
			section: "discover",
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * Story detail is discover too, as on web. It is a branch of discover, not a destination; lighting
	 * nothing would make opening a story read as leaving discover.
	 */
	it("story details are discover too", () => {
		expect(mobileShellRouteFor("/stories/story-1").section).toBe("discover");
	});

	/**
	 * Public profile is discover too, as on web. It is a branch of discover (story → person → story),
	 * not a destination, and not reachable directly from the drawer. Do not add a fourth section.
	 */
	it("public profiles are discover too", () => {
		expect(mobileShellRouteFor("/creators/member-1")).toEqual({
			section: "discover",
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * Runtime playback is in the chat section but is not a room, so `Conversations` lights up. The playthrough is
	 * not in the drawer's recent list, so no chat row is lit; the story's library row
	 * (`activeRuntimeStoryId`) is lit instead. Putting the story id in `activeRoomId` would make the
	 * drawer look for a room it does not have, and leaving both empty would leave the playing story's
	 * library row unlit.
	 */
	it("runtime playback is the conversation section and lights the runtime row", () => {
		expect(mobileShellRouteFor("/chat/runtime/story-1")).toEqual({
			section: "chat",
			activeRoomId: null,
			activeRuntimeStoryId: "story-1",
			utility: null,
		});
	});

	/**
	 * The segment count decides this. A bare `/chat/runtime` is a room address with id `runtime` (no
	 * such room, so the screen shows not found); a runtime address with an empty story id folds to the
	 * library.
	 */
	it("/chat/runtime alone reads as a room address", () => {
		expect(mobileShellRouteFor("/chat/runtime").activeRoomId).toBe("runtime");
		expect(mobileShellRouteFor("/chat/runtime/").activeRoomId).toBe("runtime");
	});

	/** The retired play address only redirects, so it is not in the shell table and lights nothing. */
	it("the retired playback address lights nothing", () => {
		expect(mobileShellRouteFor("/stories/story-1/play")).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	it("the conversation list is the conversation section with no row to light", () => {
		expect(mobileShellRouteFor("/chats")).toEqual({
			section: "chat",
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * **Create home and editor are the same section.** Same axis as the chat list and a room. There is
	 * no recent-draft row in the drawer, so there is nothing to light.
	 */
	it("the create workspace is the creation section", () => {
		expect(mobileShellRouteFor("/create")).toEqual({
			section: "create",
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * **Story test is also create.** Chatting inside it is not grounds for changing section: the
	 * creator is trying a draft, and that conversation is not in `/chats` or the recent list (it is
	 * not saved). Lighting `Conversations` would make the user look for it in the drawer.
	 */
	it("the story test is the creation section too, with no conversation row to light", () => {
		expect(mobileShellRouteFor("/create/draft-1/test")).toEqual({
			section: "create",
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * Count the segments and compare names. A prefix match would silently send future addresses such
	 * as `/create/<id>/analytics` into this branch.
	 */
	it("an unknown subpath of create lights nothing", () => {
		expect(mobileShellRouteFor("/create/draft-1/analytics").section).toBeNull();
		expect(mobileShellRouteFor("/create/draft-1/test/deep").section).toBeNull();
	});

	it("the draft editor is the same section with no row to light", () => {
		expect(mobileShellRouteFor("/create/draft-1")).toEqual({
			section: "create",
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * **Not prefix matching.** `startsWith("/create")` would light the create section on public
	 * profiles (`/creators/<id>`); the two already sit side by side in this table.
	 */
	it("public profiles don't light the creation section", () => {
		expect(mobileShellRouteFor("/creators/member-1").section).toBe("discover");
	});

	/** List and room are two screens of the same section. Only the active row differs. */
	it("a room is the conversation section too and lights its row", () => {
		expect(mobileShellRouteFor("/chat/room-1")).toEqual({
			section: "chat",
			activeRoomId: "room-1",
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/** Screens outside the shell. Do not light the nearest section for them. */
	it.each(["/login", "/dev-tools"])("%s lights nothing", (path) => {
		expect(mobileShellRouteFor(path)).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * Unknown paths fall into a branch with no highlight. The failure is safe: the drawer still opens,
	 * and only the lit item is missing. Prefix matching would light `Conversations` here.
	 */
	it("an unknown path lights nothing", () => {
		expect(mobileShellRouteFor("/chatter").section).toBeNull();
		expect(mobileShellRouteFor("/chat/a/b").section).toBeNull();
		expect(mobileShellRouteFor("/stories").section).toBeNull();
		expect(mobileShellRouteFor("/creators").section).toBeNull();
		expect(mobileShellRouteFor("/creators/a/b").section).toBeNull();
	});
});

describe("utilities", () => {
	/**
	 * **Notifications is a utility, not a section.** It lights neither `Discover` nor `Conversations`; forcing one on
	 * would make the user read that they are inside that section, and the drawer's list would be
	 * false. Matches web's `/notifications` (section null, utility `notifications`).
	 */
	it("the notifications screen lights only the utility", () => {
		expect(mobileShellRouteFor("/notifications")).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: "notifications",
		});
	});

	/** No sub-paths under notifications; an unknown path falls through. */
	it("subpaths of notifications light nothing", () => {
		expect(mobileShellRouteFor("/notifications/1")).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * **Account is also a utility, not a section.** Lights neither `Discover` nor `Conversations`. Matches web's
	 * `/account` (section null, utility `account`); the header's account menu lights from this value
	 * alone (`account-shortcut.tsx`).
	 */
	it("the account screen lights only the utility", () => {
		expect(mobileShellRouteFor("/account")).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: "account",
		});
	});

	/** No sub-paths under account; an unknown path falls through. */
	it("subpaths of account light nothing", () => {
		expect(mobileShellRouteFor("/account/security")).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: null,
		});
	});

	/**
	 * **Settings is a utility, not a section.** All three categories share the same value: the drawer
	 * would light nothing for them anyway, and the header gear only needs to say settings is
	 * somewhere. Matches web's `/settings` (section null, utility `settings`). Keeping settings out of
	 * `MobileAppSection` is the point of this check: adding it would give the drawer a fourth item,
	 * and the left side would become leftover space.
	 */
	it.each([
		"/settings",
		"/settings/ai",
		"/settings/personas",
	])("%s lights only the settings utility", (path) => {
		expect(mobileShellRouteFor(path)).toEqual({
			section: null,
			activeRoomId: null,
			activeRuntimeStoryId: null,
			utility: "settings",
		});
	});

	/**
	 * **Unknown sub-paths are not settings.** A prefix match (`startsWith("/settings")`) would send
	 * hand-edited or future addresses such as `/settings/ai/provider` into this branch, where the gear
	 * lights up for a page the router cannot draw.
	 */
	it.each([
		"/settings/foo",
		"/settings/general",
		"/settings/ai/provider",
		"/settings/personas/123",
		"/settings/personas/new",
		"/settingsx",
	])("%s isn't classified as settings", (path) => {
		expect(mobileShellRouteFor(path).utility).toBeNull();
		expect(mobileShellRouteFor(path).section).toBeNull();
	});

	/** Other screens have no utility lit. The header bell and account menu read this value alone. */
	it.each([
		"/",
		"/chats",
		"/chat/room-1",
		"/billing",
		"/create",
		"/create/draft-1",
		"/create/draft-1/test",
		"/stories/story-1",
		"/creators/member-1",
	])("%s lights no utility", (path) => {
		expect(mobileShellRouteFor(path).utility).toBeNull();
	});
});

describe("the active room comes from the route parameter", () => {
	/**
	 * The id is percent-encoded in the address, so it is decoded here. Current ids are hex without
	 * hyphens, so nothing changes today; relying on that would silently fail to light the row the day
	 * the id rule changes.
	 */
	it("decodes encoded ids", () => {
		expect(mobileShellRouteFor("/chat/%EB%B0%A9-1").activeRoomId).toBe(
			"\ubc29-1",
		);
	});

	/** A hand-edited deep link must not kill the whole shell. */
	it("doesn't blow up on a broken percent sequence", () => {
		expect(mobileShellRouteFor("/chat/%E0%A4%A").activeRoomId).toBe("%E0%A4%A");
	});

	/** List screens have no row to light; do not invent a "last opened room". */
	it("being the conversation section doesn't light a row by itself", () => {
		expect(mobileShellRouteFor("/chats").activeRoomId).toBeNull();
	});
});

/**
 * **The bottom row's primary destination is narrower than the section.**
 *
 * `section` answers "which section am I in" and so also lights on story detail, the editor and the
 * story test (correct for the drawer: the user has not left the section). The bottom row answers a
 * different question, "is this the home of that section?", and only stands there. Those three
 * screens already use the bottom edge (input bar, keyboard, comment composer). Folding the two into
 * one value would put a row under the chat room and the editor, where what the user is typing is.
 */
describe("the bottom primary navigation stands only on the three roots", () => {
	it.each([
		["/", "discover"],
		["/chats", "chat"],
		["/create", "create"],
	])("%s lights the %s cell", (path, section) => {
		expect(mobilePrimaryDestination(path)).toBe(section);
	});

	/**
	 * The next six are screens where the section lights but no bottom row stands. The section is
	 * asserted too, so this list is not indistinguishable from unknown paths.
	 */
	it.each([
		"/stories/story-1",
		"/creators/member-1",
		"/chat/room-1",
		"/create/draft-1",
		"/create/draft-1/test",
	])("%s lights only the section and doesn't stand the bottom row", (path) => {
		expect(mobileShellRouteFor(path).section).not.toBeNull();
		expect(mobilePrimaryDestination(path)).toBeNull();
	});

	/** Utility destinations and screens outside the shell get no bottom row either. */
	it.each([
		"/notifications",
		"/settings",
		"/settings/ai",
		"/account",
		"/billing",
		"/login",
		"/dev-tools",
		"/nope",
	])("doesn't stand on %s", (path) => {
		expect(mobilePrimaryDestination(path)).toBeNull();
	});

	/**
	 * No prefix matching. `/chats` and `/chat/<id>` are not prefixes of each other, but `startsWith`
	 * would read them that way someday (the rule of this file).
	 */
	it("matches the segment count too", () => {
		expect(mobilePrimaryDestination("/chats/archive")).toBeNull();
		expect(mobilePrimaryDestination("/creators")).toBeNull();
	});

	/** Encoded segments are decoded too; the judgment goes through the same `splitPath`. */
	it("the same answer on an encoded path", () => {
		expect(mobilePrimaryDestination("/%63hats")).toBe("chat");
	});
});

/** The runtime playthrough is a screen of the chat section, not its home, so no bottom row stands. */
describe("the bottom row on runtime playback", () => {
	it("doesn't stand", () => {
		expect(mobilePrimaryDestination("/chat/runtime/story-1")).toBeNull();
	});
});
