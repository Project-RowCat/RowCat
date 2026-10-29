import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the **wiring** of the public profile: the things the type system cannot catch.
 *
 * Every rule below compiles when broken and fails only on a device. The cache policy in particular
 * can be retyped by hand and the screen still looks like it works; the drift shows up only as
 * follower counts that differ between two screens, or a blocked creator's works remaining in one
 * list alone.
 *
 * The rules themselves are verified elsewhere: the pure decisions in `profile-state.test.ts`,
 * `profile-stories-state.test.ts` and `@rowcat/domain`'s `profile-actions.test.ts`, and the cache
 * policy in `@rowcat/query`'s tests. What is checked here is **whether those are actually called**.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const read = (path: string): string =>
	readFileSync(join(SRC, path), "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

const SCREEN = read("features/profile/creator-profile-screen.tsx");
const HEADER = read("features/profile/profile-header.tsx");
const FOLLOW = read("features/profile/follow-control.tsx");
const BLOCK = read("features/profile/use-block-creator.tsx");
const MENU = read("features/profile/use-profile-menu.tsx");
const ROUTE = read("app/creators/[creatorId].tsx");
const BYLINE = read("features/story/story-byline.tsx");
const CARD = read("features/discover/story-card.tsx");
const COMMENT = read("features/story/comments/comment-row.tsx");

describe("the route holds identity", () => {
	it("the creator route actually exists", () => {
		expect(ROUTE.length).toBeGreaterThan(0);
	});

	/**
	 * The route parameter is the source of truth. A shadow state such as `selectedCreator` would turn
	 * deep links, back navigation and stack restoration into features that each need their own fix,
	 * and once two identities diverge there is no way to decide which to trust.
	 */
	it("identity comes from the route parameter", () => {
		expect(ROUTE).toContain("useLocalSearchParams");
		expect(ROUTE).toMatch(/creatorId=\{id\}|creatorId=\{ id \}/);
		for (const shadow of [
			"selectedCreator",
			"selectedProfile",
			"currentCreator",
		])
			expect(ROUTE + SCREEN, shadow).not.toContain(shadow);
	});

	/**
	 * No query is sent with an empty id, so no 404 is received. "Not found" is what the server says
	 * after deciding; this case is one where no request can be made at all.
	 */
	it("without an id it goes back to discover", () => {
		expect(ROUTE).toMatch(/if \(!id\) return <Redirect href="\/" \/>;/);
	});

	/**
	 * The profile **object** is not carried as a parameter. Arriving by address there is no such
	 * object, and even when present it is a snapshot that does not follow follower-count changes.
	 */
	it("the profile object doesn't go through the route", () => {
		for (const source of [ROUTE, BYLINE, CARD, COMMENT])
			expect(source).not.toMatch(/params: \{[^}]*profile/);
		expect(BYLINE).toMatch(/params: \{ creatorId: creator\.id \}/);
	});
});

describe("relation writes go through the shared policy", () => {
	/**
	 * **No mobile-only optimistic logic.** `@rowcat/query` decides which cell changes and how, and the
	 * web calls the same function. Two copies would mean fixing one leaves follower counts differing
	 * between screens.
	 */
	it("follow calls followMutationOptions", () => {
		expect(FOLLOW).toContain("followMutationOptions");
		expect(FOLLOW).toContain("mutation.mutate(!following)");
	});

	it("block calls blockMutationOptions", () => {
		expect(BLOCK).toContain("blockMutationOptions");
	});

	/**
	 * No line in this folder touches the cache directly. Block in particular removes **after
	 * confirmation** (on failure, the target to roll back is not deterministic), so if the screen
	 * starts removing early, that decision collapses entirely.
	 */
	it("the screen doesn't modify the cache directly", () => {
		for (const [name, source] of [
			["screen", SCREEN],
			["header", HEADER],
			["follow", FOLLOW],
			["block", BLOCK],
			["menu", MENU],
		] as const)
			for (const forbidden of [
				"setQueryData",
				"setQueriesData",
				"removeQueries",
				"resetQueries",
				"invalidateQueries",
			])
				expect(source, `${name} — ${forbidden}`).not.toContain(forbidden);
	});

	/**
	 * **The screen does not compute follower counts.** The value is an aggregate carried on the public
	 * profile, and the write response gives the confirmed total. Once arithmetic such as `followers +
	 * 1` appears, the optimistic value and the server value move independently in two places.
	 */
	it("no arithmetic on the follower count", () => {
		for (const source of [SCREEN, HEADER, FOLLOW, BLOCK, MENU])
			expect(source).not.toMatch(/followers\s*[+-]/);
	});
});

describe("locked operations are actually locked", () => {
	/**
	 * **An `if (disabled) return;` inside a callback is not a lock.**
	 *
	 * In that shape the row looks ordinary, assistive technology reads it as a plain `menuitem`, and a
	 * finger press **closes the menu and nothing happens**. A person whose account is restricted, or
	 * who is still checking a session, has no way to learn what went wrong. Locking is done by the
	 * primitive (`MenuItem` in `@rowcat/ui-native` passes `disabled` straight through).
	 */
	it("both rows pass the computed lock to the primitive", () => {
		expect(BLOCK).toContain("const disabled = mutation.isPending");
		expect(BLOCK.match(/disabled=\{disabled\}/g)).toHaveLength(2);
	});

	/** The callback's guard stays as belt and braces: the value can change between renders. */
	it("the callback's guard remains but isn't the only guard", () => {
		expect(BLOCK).toContain("if (disabled) return;");
	});

	/**
	 * No second permission model. The decision to hide block from guests belongs to `ProfileActions`
	 * in `@rowcat/domain` (`actions.kind === "member"`), and whether a write is possible now is
	 * answered by one `viewerAction`, the **same function** as hearts and comments.
	 */
	it("this folder doesn't create its own permission decisions", () => {
		expect(HEADER).toContain('actions.kind === "member"');
		expect(BLOCK).toContain("ViewerAction");
		for (const invented of ["canBlock", "isBanned", "role ===", "suspended"])
			expect(BLOCK + HEADER, invented).not.toContain(invented);
	});
});

describe("a transient failure doesn't leak into the next attempt", () => {
	/**
	 * A failed block leaves the dialog open with its sentence. That is correct: announcing after the
	 * dialog closes would make the user leave not knowing the result. But the mutation's failure state
	 * survives closing the dialog, so without clearing it, the next person to press this item gets a
	 * confirmation carrying the old failure sentence **before trying anything**.
	 */
	it("clears the mutation state before opening a new confirmation", () => {
		expect(BLOCK).toContain("mutation.reset();");
		expect(BLOCK.indexOf("mutation.reset();")).toBeLessThan(
			BLOCK.indexOf("setConfirming(true)"),
		);
	});

	/** The unblock failure sentence is also cleared when a new action starts, so no words from a previous action remain. */
	it("the unlink failure sentence is cleared in both operations", () => {
		expect(BLOCK.match(/setUnblockFailure\(null\)/g)).toHaveLength(2);
	});

	/**
	 * Not cleared on close. That would add another path where the failure disappears with the dialog,
	 * possibly before the user has read it.
	 */
	it("cancel doesn't swallow the failure", () => {
		expect(BLOCK).toContain("onCancel={() => setConfirming(false)}");
	});

	/**
	 * **Transient UI state does not cross creator boundaries.**
	 *
	 * The confirmation dialog and failure sentence are React local state in `useBlockCreator`, and
	 * they persist unless this screen remounts. Every route into this one today is a `push` (or a
	 * `replace` from login), which creates a new screen key. But that guarantee rests on **the
	 * caller's choice of navigation verb**, so one `router.navigate` line would break it silently, and
	 * then B's profile would open holding A's block failure. Keying by the address's identity moves
	 * that guarantee into the structure.
	 */
	it("the screen keys on the address's identity", () => {
		expect(ROUTE).toContain("<CreatorProfileScreen key={id} creatorId={id} />");
	});
});

describe("a shared pure function decides", () => {
	/**
	 * The three branches `own`, `guest` and `member` are decided by `@rowcat/domain`, and the web
	 * calls the **same function**. Written per app, one side would show block only to members while
	 * the other adds a third "personalization unknown" state. The drift is visible only when the two
	 * screens are compared side by side.
	 */
	it("the screen calls resolveProfileActions", () => {
		expect(SCREEN).toContain("resolveProfileActions");
		expect(SCREEN).toContain("profileContentBlocked");
		expect(SCREEN).toContain('from "@rowcat/domain"');
	});

	it("the screen doesn't rewrite ownership or relation decisions", () => {
		for (const source of [SCREEN, HEADER])
			expect(source).not.toMatch(/viewer\??\.id === |=== viewer\??\.id/);
		expect(SCREEN + HEADER).not.toMatch(
			/\.following\.includes|\.blocked\.includes/,
		);
	});
});

describe("the server decides what is visible", () => {
	/**
	 * Private, archived, adult gate, block and operator hiding are all server predicates. If the
	 * screen re-decided them, the two decisions would diverge one day, and there would be no way to
	 * decide which was right. Block is used **only to choose copy**; it does not decide which works
	 * survive.
	 */
	it("there's no code filtering stories", () => {
		for (const forbidden of [
			/\.filter\(/,
			/visibility\s*[=!]==/,
			/isStoryDiscoverable/,
			/\.adult\s*&&/,
			/hidden/,
		])
			expect(SCREEN, String(forbidden)).not.toMatch(forbidden);
	});

	/**
	 * **Do not borrow the discover screen's return path.** A guest who presses a heart on a card in
	 * this screen must return to **this profile**, not to discover. Reusing a value with the same name
	 * would make someone who has just logged in lose the place they were.
	 */
	it("the return path is this profile", () => {
		expect(SCREEN).toContain("creatorProfilePath(creatorId)");
		expect(SCREEN).not.toContain("discoverReturnPath");
	});

	/** The query keys and cache policy also come from the shared package. */
	it("doesn't create mobile-only query keys", () => {
		expect(SCREEN).toContain("publicProfileQueryOptions");
		expect(SCREEN).toContain("creatorStoriesInfiniteQueryOptions");
		expect(SCREEN).not.toMatch(/queryKey:/);
	});

	/**
	 * **The works state's `hasData` comes from the presence of query data, not from a count.**
	 *
	 * This check exists because the reverting change looks ordinary in review. `hasData: rows.length >
	 * 0` compiles and behaves the same on most screens, but it folds a successful zero result into the
	 * same value as "never received". The moment a background refresh fails, the empty state turns
	 * into a failure message. The symptom is silent.
	 */
	it("passes the lookup data's existence to the story state as is", () => {
		expect(SCREEN).toMatch(/hasData:\s*stories\.data !== undefined/);
		expect(SCREEN).not.toMatch(/hasData:\s*rows\.length/);
		expect(SCREEN).not.toMatch(/hasData:\s*stories\.(isFetched|isSuccess)/);
		expect(SCREEN).not.toMatch(/hasData:\s*stories\.status === "success"/);
	});
});

describe("doesn't draw what isn't this slice", () => {
	/**
	 * A button is a promise. While the screen that completes the action is absent, drawing the button
	 * draws an unkeepable promise. Disabled buttons are no different: they read as "coming soon".
	 *
	 * **It matters especially that the owner's `Edit profile` is absent here.** The web sends owners to
	 * `/account`, but this app has no such screen.
	 */
	it("no dead destinations or next-slice vocabulary", () => {
		/**
		 * **`Report` dropped out of this list, because there is an API for it and the screen now
		 * exists.**
		 *
		 * The criterion for this list is whether a screen completing the action exists, not whether it
		 * has not yet been built. Reporting ends in one `POST /v2/reports`, and the receipt happens
		 * inside this app, so keeping it here would forbid a promise that can already be kept. The rest
		 * still point at screens that are absent from this app.
		 */
		const surface = SCREEN + HEADER + FOLLOW + BLOCK + MENU;
		for (const absent of [
			"Edit profile",
			"Go to Create",
			"followers list",
			"following list",
			"following count",
			"Send message",
			"block list",
			"/account",
			"/settings",
			"/create",
		])
			expect(surface, absent).not.toContain(absent);
	});

	/**
	 * Draft counts, private-work counts and hidden-work counts are not questions a public profile
	 * answers. The contract lacking those values is the first defence; this check is the second.
	 */
	it("doesn't draw metrics outside the public contract", () => {
		for (const absent of ["Drafts", "view count", "story count", "downloads"])
			expect(SCREEN + HEADER, absent).not.toContain(absent);
	});
});

describe("there's one manage menu with two inside", () => {
	/**
	 * **Does not create a second overflow.**
	 *
	 * The quickest answer for someone asked to add reporting is to put another `⋯` beside follow. That
	 * leaves two overflow triggers 20pt apart for the same person, and nobody remembers which one
	 * holds what. The two would then start behaving differently (one hidden from guests, the other
	 * not).
	 */
	it("one file builds the trigger", () => {
		expect(MENU).toContain("<DropdownMenu");
		for (const [name, source] of [
			["header", HEADER],
			["follow", FOLLOW],
			["block", BLOCK],
			["screen", SCREEN],
		] as const) {
			expect(source, `${name} — DropdownMenu`).not.toContain("<DropdownMenu");
			expect(source, `${name} — ReportMenu`).not.toContain("<ReportMenu");
		}
	});

	/**
	 * What the menu holds is **two** things. Block's rules still belong to `use-block-creator.tsx`,
	 * and what remains in this file is only the arrangement. Merging them would make the menu file
	 * know about mutations and confirmation copy.
	 */
	it("report and block each come from their own file", () => {
		expect(MENU).toContain("useReportAction");
		expect(MENU).toContain("useBlockCreator");
		expect(MENU).not.toContain("blockMutationOptions");
		expect(MENU).not.toContain("<AlertDialog");
	});

	/**
	 * **Only a single member id travels.** The contract has no slot for nickname, bio, avatar or
	 * follower count (`ReportTarget`), and the snapshot is taken by the server from the public
	 * profile.
	 */
	it("the report target is the member id alone", () => {
		expect(MENU).toContain('target: { type: "member", memberId: creatorId }');
		for (const leak of ["displayName", "bio", "avatarUrl", "followers"])
			expect(MENU, leak).not.toContain(leak);
	});

	/**
	 * **Reporting and blocking do not double as each other.** If submitting a report also blocked, a
	 * user who wanted only one could not undo the other. Block in particular cuts the follow, and
	 * unblocking does not restore it.
	 */
	it("one operation doesn't double as another", () => {
		expect(MENU).not.toMatch(/report[\s\S]{0,120}mutation\.mutate/);
		/** The block confirmation copy does not mention reporting (and the reverse holds too). */
		expect(BLOCK).not.toContain("Report");
	});

	/** Not drawn on one's own profile or for guests. The decision is still `ProfileActions`. */
	it("the menu stands only member to member", () => {
		expect(HEADER).toContain('const showsMenu = actions.kind === "member"');
		expect(HEADER.match(/showsMenu \? menu\./g)).toHaveLength(3);
	});
});

describe("the byline's branching is in one place", () => {
	/**
	 * A rule that omits links for works whose creator has been erased, written per screen, will
	 * eventually miss one place. What results then is a **dead link whose address is the erased
	 * person's id**.
	 */
	it("both screens use the same component", () => {
		expect(CARD).toContain("<StoryByline");
		expect(read("features/story/story-meta.tsx")).toContain("<StoryByline");
	});

	it("without a creator it's unpressable text", () => {
		expect(BYLINE).toMatch(/if \(!creator\)/);
		/** Navigation exists **only after** that branch. */
		expect(BYLINE.indexOf("if (!creator)")).toBeLessThan(
			BYLINE.indexOf("router.push"),
		);
	});

	/**
	 * **The author field (`author`) is free text and connects to no account.** Turning that value into
	 * a link would separate the name from the person it points to.
	 */
	it("the author credit doesn't become a profile address", () => {
		for (const source of [BYLINE, CARD, read("features/story/story-meta.tsx")])
			expect(source).not.toMatch(/creatorId: [^}]*\.author/);
		expect(BYLINE).not.toContain("story.author");
	});

	/** A comment's author also goes to the **member id**. Nicknames are not unique and cannot be an address. */
	it("comment authors go by member id", () => {
		expect(COMMENT).toMatch(/params: \{ creatorId: comment\.author\.id \}/);
		expect(COMMENT).not.toMatch(/creatorId: [^}]*nickname/);
	});
});

describe("discover card press targets don't overlap", () => {
	/**
	 * **This group guards against a regression in card layout.**
	 *
	 * When a byline became a control, the quickest answer was to put a second `Pressable` **inside**
	 * the one that opens the work. That answer was not chosen because the winner of nested press
	 * targets differs by platform, and the fact is visible only in the markup. On one platform it
	 * looks plausibly right when run.
	 */
	it("the byline is outside the area that opens the story", () => {
		/** `</Pressable>` closes **before** the byline, meaning they are siblings. */
		expect(CARD.indexOf("</Pressable>")).toBeLessThan(
			CARD.indexOf("<StoryByline"),
		);
	});

	it("the heart is outside that area too", () => {
		expect(CARD.indexOf("</Pressable>")).toBeLessThan(
			CARD.indexOf("<FavoriteControl"),
		);
	});

	/**
	 * Not solved by stopping propagation. That depends on accident rather than structure, behaves
	 * differently across platforms, and is invisible in review.
	 */
	it("doesn't stop propagation by hand", () => {
		for (const forbidden of [
			"stopPropagation",
			"onStartShouldSetResponder",
			"pointerEvents",
		])
			expect(CARD, forbidden).not.toContain(forbidden);
	});

	/**
	 * This also locks that the card has **only one** press target. With two, one card has two routes
	 * to the same work, and assistive technology reads two buttons with the same name.
	 */
	it("one area opens the story", () => {
		expect(CARD.match(/<Pressable/g)).toHaveLength(1);
	});

	/** The work button's name no longer includes the creator, because that name now has its own button. */
	it("the story button's name is the title alone", () => {
		expect(CARD).toContain("accessibilityLabel={story.title}");
		expect(CARD).not.toMatch(/accessibilityLabel=\{`\$\{story\.title\}, /);
	});
});
